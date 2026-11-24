import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp, updateDoc, runTransaction, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const root = document.createElement('section');
root.id = 'cloudAccess';
root.style.cssText = 'max-width:1160px;margin:18px auto;padding:0 18px';
root.innerHTML = `<div class="card"><div class="row"><div><h2 style="margin:0">Müşteri portalı / Bulut hesabı</h2><small class="muted">Yönetim hesabı: tüm program verileri cihazlar arasında eşitlenir.</small></div><span id="cloudStatus" class="pill red">Bulut hazırlanıyor</span></div><div id="cloudLogin" style="margin-top:12px"><div class="formgrid"><div><label>E-posta</label><input id="cloudEmail" type="email" autocomplete="username" placeholder="ornek@mail.com"></div><div><label>Şifre</label><input id="cloudPassword" type="password" autocomplete="current-password"></div></div><div class="actionsbar"><button id="cloudLoginBtn">Giriş yap</button></div><small class="muted">Müşteri hesapları yönetici tarafından Firebase Authentication üzerinden oluşturulur.</small></div><div id="cloudPortal" class="hidden" style="margin-top:14px"></div><div id="cloudError" class="muted" role="status" style="margin-top:8px"></div></div>`;
document.body.insertBefore(root, document.querySelector('main'));
const $ = id => document.getElementById(id);
const configReady = firebaseConfig && !Object.values(firebaseConfig).some(v => String(v).startsWith('YOUR_'));

if (!configReady) {
  $('cloudError').textContent = 'Firebase ayarları eksik. firebase-config.js dosyasını kontrol edin.';
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const store = getFirestore(app);
  const storage = getStorage(app);
  const mainDataRef = doc(store, 'appData', 'main_v2');
  let stopAccount = null, stopRequests = null, stopDb = null;
  let lastRevision = null, syncActive = false, applyingRemote = false, syncBusy = false, initializing = false, adminUser = false;
  let currentUser = null, initialCloudDB = null;
  const deviceId = (() => { let id = localStorage.getItem('ms_accounting_device_id'); if (!id) { id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2); localStorage.setItem('ms_accounting_device_id', id); } return id; })();

  $('cloudStatus').textContent = 'Firebase bağlı';
  $('cloudStatus').className = 'pill';

  $('cloudLoginBtn').onclick = async () => {
    $('cloudError').textContent = '';
    try { await signInWithEmailAndPassword(auth, $('cloudEmail').value.trim(), $('cloudPassword').value); }
    catch(e) { $('cloudError').textContent = 'تعذر تسجيل الدخول: ' + e.message; }
  };

  function syncPanel() {
    const panel = $('cloudDbSync');
    if (!panel) return;
    panel.innerHTML = `<div class="notice"><b>مزامنة بيانات المحاسبة كاملة</b><br>تُحفظ كل عملية على هذا الجهاز فوراً، ثم تُرسل للسحابة تلقائياً عند عودة الإنترنت. تُدمج التغييرات على مستوى السجل حتى لا يمحو تعديل جهاز تغييرات سجلات أخرى.</div><div id="dbSyncState" class="muted">جاري فحص قاعدة السحابة...</div><div class="actionsbar"><button id="dbSyncStart" class="hidden">إنشاء قاعدة السحابة من هذا الجهاز</button><button id="dbSyncMerge" class="secondary hidden">دمج تغييرات هذا الجهاز مع السحابة</button><button id="dbSyncReload" class="secondary hidden">تحميل بيانات السحابة على هذا الجهاز</button></div>`;
    $('dbSyncStart').onclick = startFirstSync;
    $('dbSyncMerge').onclick = mergeLocalIntoCloud;
    $('dbSyncReload').onclick = reloadFromCloud;
  }

  function showSyncState(message, mode = 'normal') {
    const el = $('dbSyncState');
    if (el) el.textContent = message;
    const status = $('cloudStatus');
    if (status) {
      status.textContent = mode === 'error' ? 'مزامنة تحتاج مراجعة' : mode === 'ok' ? 'المزامنة فعالة' : 'Firebase متصل';
      status.className = mode === 'error' ? 'pill red' : 'pill';
    }
  }

  function validDB(value) {
    return !!value && Array.isArray(value.customers) && Array.isArray(value.sales)
      && Array.isArray(value.payments) && value.settings && typeof value.settings === 'object';
  }

  function dbSize(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  function applyCloudDB(value) {
    if (!validDB(value)) throw new Error('بيانات السحابة ليست بصيغة قاعدة MS Accounting الصحيحة.');
    if (typeof window.replaceLocalDB !== 'function') throw new Error('نسخة البرنامج المحلية لا تدعم استلام بيانات السحابة.');
    applyingRemote = true;
    try { window.replaceLocalDB(value); }
    finally { applyingRemote = false; }
  }

  function stableJSON(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }

  function emptyDB(value) {
    return validDB(value) && value.customers.length === 0 && value.sales.length === 0 && value.payments.length === 0;
  }

  function applyChange(value, change) {
    const next = JSON.parse(JSON.stringify(value));
    if (change.entity === 'settings') {
      if (change.action === 'upsert') next.settings = change.record || {};
      return next;
    }
    if (!['customers','sales','payments'].includes(change.entity)) return next;
    const rows = next[change.entity] || [];
    const index = rows.findIndex(x => String(x.id) === String(change.recordId));
    if (change.action === 'delete') { if (index >= 0) rows.splice(index, 1); }
    else if (change.action === 'upsert' && change.record) {
      if (index >= 0) rows[index] = change.record;
      else rows.push(change.record);
    }
    next[change.entity] = rows;
    return next;
  }

  async function startFirstSync() {
    const local = window.getLocalDB?.();
    if (!validDB(local)) return showSyncState('تعذر قراءة قاعدة بيانات هذا الجهاز.', 'error');
    if (dbSize(local) > 900000) return showSyncState('حجم البيانات كبير جداً لمستند Firestore واحد. لم يتم رفع شيء.', 'error');
    if (!confirm('سيتم إنشاء قاعدة السحابة لأول مرة باستخدام بيانات هذا الجهاز. هل هذا هو الجهاز الذي يحتوي البيانات الصحيحة؟')) return;
    $('dbSyncStart').disabled = true;
    try {
      await runTransaction(store, async tx => {
        const existing = await tx.get(mainDataRef);
        if (existing.exists()) throw new Error('تم إنشاء قاعدة السحابة من جهاز آخر. أعد فحص المزامنة.');
        tx.set(mainDataRef, { schemaVersion: 3, revision: 1, db: local, updatedAt: serverTimestamp(), updatedBy: currentUser.uid });
      });
      window.clearPendingChanges?.();
      lastRevision = 1; syncActive = true;
      showSyncState('تم إنشاء قاعدة السحابة. هذا الجهاز أصبح المصدر الأول للبيانات.', 'ok');
      $('dbSyncStart').classList.add('hidden');
      watchCloudDB();
    } catch (e) {
      showSyncState('لم تبدأ المزامنة: ' + e.message, 'error');
      $('dbSyncStart').disabled = false;
    }
  }

  async function mergeLocalIntoCloud() {
    if (!initialCloudDB) return;
    try {
      const count = window.queueDBDiff?.(initialCloudDB);
      const pending = window.getPendingChanges?.() || [];
      window.applySyncedDB(initialCloudDB, pending);
      syncActive = true; initialCloudDB = null;
      $('dbSyncMerge').classList.add('hidden'); $('dbSyncReload').classList.add('hidden');
      showSyncState(`تم تجهيز ${count || 0} تغيير محلي للدمج الآمن. جاري رفعها دون استبدال بقية السجلات...`);
      watchCloudDB(); flushOutbox();
    } catch (e) { showSyncState('تعذر تجهيز الدمج: ' + e.message, 'error'); }
  }

  async function reloadFromCloud() {
    if (!initialCloudDB) return;
    if (!navigator.onLine) return showSyncState('اتصل بالإنترنت أولاً حتى نتأكد من أحدث نسخة سحابية قبل استبدال بيانات هذا الجهاز.', 'error');
    if (!confirm('سيتم استبدال بيانات هذا الجهاز ببيانات السحابة. تأكد أنك لا تحتاج أي اختلافات محلية. هل تريد المتابعة؟')) return;
    try {
      const fresh = await getDoc(mainDataRef);
      if (!fresh.exists() || !validDB(fresh.data().db)) throw new Error('تعذر التحقق من النسخة السحابية الحالية.');
      initialCloudDB = fresh.data().db;
      window.clearPendingChanges?.();
      window.applySyncedDB(initialCloudDB, []);
      lastRevision = Number(fresh.data().revision || 0);
      initialCloudDB = null; syncActive = true;
      $('dbSyncMerge').classList.add('hidden'); $('dbSyncReload').classList.add('hidden');
      showSyncState('تم تحميل أحدث بيانات السحابة على هذا الجهاز.', 'ok');
      watchCloudDB();
    } catch (e) { showSyncState('تعذر تحميل بيانات السحابة: ' + e.message, 'error'); }
  }

  function watchCloudDB() {
    if (stopDb) stopDb();
    stopDb = onSnapshot(mainDataRef, snap => {
      if (!snap.exists()) { showSyncState('لم تعد قاعدة السحابة موجودة. لم نغيّر البيانات المحلية.', 'error'); return; }
      const payload = snap.data();
      const revision = Number(payload.revision || 0);
      if (revision <= Number(lastRevision ?? -1)) return;
      try {
        const pending = window.getPendingChanges?.() || [];
        window.applySyncedDB(payload.db, pending);
        lastRevision = revision;
        showSyncState(`تم استلام تغييرات السحابة ودمجها مع ${pending.length} تعديل محلي معلّق. المراجعة ${revision}.`, 'ok');
        if (pending.length && navigator.onLine) flushOutbox();
      } catch (e) { showSyncState(e.message, 'error'); }
    }, e => showSyncState('تعذر قراءة بيانات السحابة: ' + e.message + ' — ستُعاد المحاولة عند عودة الاتصال.', 'error'));
  }

  async function flushOutbox() {
    if (!syncActive || syncBusy || !currentUser || !navigator.onLine) return;
    syncBusy = true;
    try {
      while (navigator.onLine) {
        const pending = window.getPendingChanges?.() || [];
        if (!pending.length) break;
        const change = pending[0];
        let committedRevision = lastRevision || 0;
        await runTransaction(store, async tx => {
          const markerRef = doc(store, 'appData', 'change_' + change.id);
          const marker = await tx.get(markerRef);
          const mainSnap = await tx.get(mainDataRef);
          if (!mainSnap.exists()) throw new Error('قاعدة السحابة غير موجودة؛ احتفظنا بالتعديلات المحلية.');
          const cloud = mainSnap.data();
          if (marker.exists()) { committedRevision = Number(marker.data().revision || cloud.revision || 0); return; }
          if (!validDB(cloud.db)) throw new Error('قاعدة السحابة ليست بصيغة صحيحة.');
          const nextDB = applyChange(cloud.db, change);
          if (dbSize(nextDB) > 900000) throw new Error('حجم قاعدة البيانات تجاوز الحد الآمن؛ بقي التعديل محفوظاً على هذا الجهاز.');
          committedRevision = Number(cloud.revision || 0) + 1;
          tx.update(mainDataRef, { db: nextDB, revision: committedRevision, schemaVersion: 3, updatedAt: serverTimestamp(), updatedBy: currentUser.uid });
          tx.set(markerRef, { kind: 'syncChangeMarker', changeId: change.id, entity: change.entity, recordId: change.recordId, revision: committedRevision, deviceId: deviceId, createdAt: serverTimestamp() });
        });
        // Remove the customer's separate portal statement after the main record deletion commits.
        // Keep the outbox item pending until this cleanup succeeds, so a failed delete can retry.
        if (change.entity === 'customers' && change.action === 'delete') {
          const email = String(change.record?.email || '').trim().toLowerCase();
          if (email) await deleteDoc(doc(store, 'customerAccounts', email));
        }
        window.ackPendingChanges?.([change.id]);
        lastRevision = Math.max(Number(lastRevision || 0), committedRevision);
      }
      const remaining = (window.getPendingChanges?.() || []).length;
      if (!remaining) showSyncState('كل التعديلات محفوظة في السحابة ومتزامنة مع الأجهزة.', 'ok');
      else showSyncState(`تم رفع بعض التعديلات، وبقي ${remaining} بانتظار الاتصال.`, 'error');
    } catch (e) {
      showSyncState('التعديل محفوظ على هذا الجهاز، وتعذّر رفعه الآن: ' + e.message + ' — ستتم إعادة المحاولة تلقائياً.', 'error');
    } finally { syncBusy = false; }
  }

  async function initializeAdminSync() {
    if (!adminUser || !currentUser || initializing) return;
    if (syncActive) { watchCloudDB(); flushOutbox(); return; }
    initializing = true;
    try {
      const snap = await getDoc(mainDataRef);
      if (!snap.exists()) {
        showSyncState('لا توجد قاعدة محاسبة في السحابة بعد. أنشئها من الجهاز الذي يحتوي البيانات الصحيحة.');
        $('dbSyncStart')?.classList.remove('hidden');
        return;
      }
      const payload = snap.data();
      if (!validDB(payload.db)) throw new Error('بيانات السحابة ليست بصيغة قاعدة MS Accounting الصحيحة.');
      const local = window.getLocalDB?.();
      const pending = window.getPendingChanges?.() || [];
      lastRevision = Number(payload.revision || 0);
      if (pending.length) {
        window.applySyncedDB(payload.db, pending);
        syncActive = true; watchCloudDB(); flushOutbox();
        showSyncState(`وجدنا ${pending.length} تعديلات محلية غير مرفوعة؛ دمجناها مع السحابة دون حذفها.`, 'ok');
      } else if (emptyDB(local) || stableJSON(local) === stableJSON(payload.db)) {
        window.applySyncedDB(payload.db, []);
        syncActive = true; watchCloudDB();
        showSyncState('تم تحميل بيانات السحابة. الحفظ المحلي والمزامنة التلقائية جاهزان.', 'ok');
      } else {
        initialCloudDB = payload.db;
        showSyncState('توجد اختلافات بين بيانات هذا الجهاز والسحابة. لم نستبدل أياً منهما. اختر الدمج للحفاظ على تغييرات هذا الجهاز، أو التحميل لاعتماد نسخة السحابة.', 'error');
        $('dbSyncMerge')?.classList.remove('hidden'); $('dbSyncReload')?.classList.remove('hidden');
      }
    } catch (e) { showSyncState('تعذر تهيئة المزامنة: ' + e.message + ' — سيُعاد الفحص عند عودة الإنترنت.', 'error'); }
    finally { initializing = false; }
  }

  window.addEventListener('ms-db-updated', () => {
    if (!syncActive || applyingRemote) return;
    if (!navigator.onLine) { showSyncState('تم حفظ العملية على هذا الجهاز. ستُرفع تلقائياً عند عودة الإنترنت.'); return; }
    flushOutbox();
  });
  window.addEventListener('online', () => { if (adminUser) initializeAdminSync(); });
  window.addEventListener('offline', () => { if (adminUser) showSyncState('انقطع الإنترنت. كل عملية جديدة تُحفظ محلياً، وستُرفع تلقائياً عند عودة الاتصال.', 'error'); });

  onAuthStateChanged(auth, async user => {
    if (stopAccount) stopAccount();
    if (stopRequests) stopRequests();
    if (stopDb) stopDb();
    syncActive = false; lastRevision = null; initialCloudDB = null; currentUser = user || null; adminUser = false;
    $('cloudLogin').classList.toggle('hidden', !!user);
    $('cloudPortal').classList.toggle('hidden', !user);
    if (!user) { $('cloudPortal').innerHTML = ''; $('cloudStatus').textContent = 'Firebase bağlı'; return; }

    const email = (user.email || '').toLowerCase();
    const token = await user.getIdTokenResult();
    const isAdmin = token.claims.admin === true;
    adminUser = isAdmin;
    $('cloudPortal').innerHTML = `<div class="row"><b>مرحباً ${email.replace(/[&<>"']/g,'')}</b><button class="secondary small" id="cloudLogout">خروج</button></div>${isAdmin ? '<div id="cloudDbSync" style="margin-top:14px"></div><div class="notice">حساب الإدارة: يمكنك مزامنة كشوف العملاء المسجلين ببريد إلكتروني في بياناتهم.</div><button id="cloudSyncAll">مزامنة جميع حسابات العملاء الآن</button><div id="cloudSyncMsg" class="muted"></div>' : ''}<div id="accountSnapshot" class="notice" style="margin-top:12px">جاري تحميل كشف الحساب السحابي...</div><div id="paymentRequestList"></div>${isAdmin ? '' : '<h3>إرسال طلب دفع / إيصال</h3><form id="paymentRequestForm"><label>المبلغ المطلوب تسجيله (₺)</label><input name="amount" type="number" min="0.01" step="0.01" required><label>طريقة الدفع</label><select name="method"><option>Nakit</option><option>Havale / EFT</option><option>Kredi Kartı</option></select><label>ملاحظة</label><textarea name="note" placeholder="رقم التحويل أو أي تفاصيل"></textarea><label>إرفاق إيصال (صورة أو PDF، حتى 10MB)</label><input name="receipt" type="file" accept="image/*,application/pdf"><div class="actionsbar"><button>إرسال للمراجعة</button></div><small class="muted">الطلب لا يغيّر رصيدك. الإدارة تراجعه وتوافق عليه قبل تسجيل الدفعة.</small></form>'}`;
    $('cloudLogout').onclick = () => signOut(auth);

    if (isAdmin) {
      syncPanel();
      await initializeAdminSync();

      $('cloudSyncAll').onclick = async () => {
        try {
          const local = window.getLocalDB?.();
          if (!local) throw Error('تعذر قراءة بيانات البرنامج');
          let count = 0;
          for (const c of local.customers) {
            if (!c.email) continue;
            const sales = local.sales.filter(x => x.customerId === c.id);
            const payments = local.payments.filter(x => x.customerId === c.id);
            const salesTotal = sales.reduce((a,x) => a + Number(x.total || 0), 0);
            const paidTotal = payments.reduce((a,x) => a + Number(x.amount || 0), 0);
            const entries = [...sales.map(x => ({date:x.date,type:'Satış',description:(x.items||[]).map(i => `${i.name} ${i.qty} ${i.unit}`).join(', '),amount:Number(x.total||0)})), ...payments.map(x => ({date:x.date,type:'Ödeme',description:x.method||'Ödeme',amount:-Number(x.amount||0)}))].sort((a,b) => (a.date||'').localeCompare(b.date||''));
            await setDoc(doc(store,'customerAccounts',c.email.toLowerCase()), {customerName:c.name,salesTotal,paidTotal,balance:salesTotal-paidTotal,entries,updatedAt:serverTimestamp()});
            count++;
          }
          $('cloudSyncMsg').textContent = `تمت مزامنة ${count} حساب عميل. تأكد من إضافة بريد إلكتروني لكل عميل.`;
        } catch(err) { $('cloudSyncMsg').textContent = 'فشلت المزامنة: ' + err.message; }
      };
    }

    stopAccount = onSnapshot(doc(store,'customerAccounts',email), snap => {
      const d = snap.exists() ? snap.data() : null;
      $('accountSnapshot').innerHTML = d ? `<b>كشف الحساب · ${d.customerName||email}</b><div class="stats" style="grid-template-columns:repeat(3,1fr);margin-top:10px"><div class="stat"><small>إجمالي المبيعات</small><b>${Number(d.salesTotal||0).toLocaleString('tr-TR')} ₺</b></div><div class="stat"><small>المدفوع</small><b class="green">${Number(d.paidTotal||0).toLocaleString('tr-TR')} ₺</b></div><div class="stat"><small>المتبقي</small><b class="red">${Number(d.balance||0).toLocaleString('tr-TR')} ₺</b></div></div><div style="overflow:auto"><table><thead><tr><th>التاريخ</th><th>العملية</th><th>التفاصيل</th><th>المبلغ</th></tr></thead><tbody>${(d.entries||[]).map(x => `<tr><td>${x.date||''}</td><td>${x.type||''}</td><td>${x.description||''}</td><td>${Number(x.amount||0).toLocaleString('tr-TR')} ₺</td></tr>`).join('')}</tbody></table></div>` : 'لم يتم ربط هذا البريد بحساب عميل بعد. تواصل مع الإدارة.';
    }, e => $('accountSnapshot').textContent = 'خطأ في تحميل الحساب: ' + e.message);

    const rq = isAdmin ? collection(store,'paymentRequests') : query(collection(store,'paymentRequests'),where('email','==',email));
    stopRequests = onSnapshot(rq, s => {
      $('paymentRequestList').innerHTML = '<h3>' + (isAdmin ? 'طلبات الدفع الواردة' : 'طلبات الدفع السابقة') + '</h3>' + s.docs.map(x => {
        const d=x.data();
        return `<div class="item"><div><b>${Number(d.amount||0).toLocaleString('tr-TR')} ₺ · ${d.method||''}</b><small>${d.email||''} · ${d.createdAt?.toDate?.().toLocaleString('tr-TR')||'حديثاً'} · ${d.status==='pending'?'قيد المراجعة':d.status==='approved'?'تمت الموافقة':'مرفوض'}</small>${d.note?`<small>${String(d.note).replace(/[&<>]/g,'')}</small>`:''}</div><div>${d.receiptUrl?`<a href="${d.receiptUrl}" target="_blank" rel="noopener">الإيصال</a>`:''}${isAdmin&&d.status==='pending'?`<button class="small" data-approve="${x.id}">تأكيد الدفع</button><button class="small danger" data-reject="${x.id}">رفض</button>`:''}</div></div>`;
      }).join('') || '<p class="muted">لا توجد طلبات بعد.</p>';
      if (isAdmin) {
        $('paymentRequestList').querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
          try {
            const req=s.docs.find(x=>x.id===b.dataset.approve).data();
            const local=window.getLocalDB?.();
            const c=local?.customers.find(c=>(c.email||'').toLowerCase()===req.email);
            if(!c) throw Error('لا يوجد عميل بهذا البريد في البرنامج المحلي');
            local.payments.push({id:'cloud_'+b.dataset.approve,customerId:c.id,date:new Date().toISOString().slice(0,10),amount:Number(req.amount),method:req.method||'Havale / EFT',note:'تم اعتماد طلب العميل: '+(req.note||''),created:new Date().toISOString()});
            window.saveLocalDB?.();
            await updateDoc(doc(store,'paymentRequests',b.dataset.approve),{status:'approved',reviewedAt:serverTimestamp()});
            $('cloudSyncAll').click();
          } catch(err) { alert('تعذر اعتماد الطلب: '+err.message); }
        });
        $('paymentRequestList').querySelectorAll('[data-reject]').forEach(b => b.onclick = async () => {
          if (confirm('رفض طلب الدفع؟')) await updateDoc(doc(store,'paymentRequests',b.dataset.reject),{status:'rejected',reviewedAt:serverTimestamp()});
        });
      }
    });

    if (!$('paymentRequestForm')) return;
    $('paymentRequestForm').onsubmit = async e => {
      e.preventDefault(); const f=new FormData(e.target);
      try {
        let receiptUrl=''; const file=f.get('receipt');
        if(file&&file.size){const path=`receipts/${email}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const uploaded=await uploadBytes(ref(storage,path),file);receiptUrl=await getDownloadURL(uploaded.ref);}
        await addDoc(collection(store,'paymentRequests'),{email,amount:Number(f.get('amount')),method:f.get('method'),note:f.get('note'),receiptUrl,status:'pending',createdAt:serverTimestamp()});
        e.target.reset(); alert('تم إرسال الطلب للإدارة للمراجعة. لم يتم تعديل رصيدك.');
      } catch(err) { $('cloudError').textContent='تعذر إرسال الطلب: '+err.message; }
    };
  });
  window.msCloudReady = true;
}
