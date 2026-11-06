import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp, updateDoc, runTransaction, increment } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const root = document.createElement('section');
root.id = 'cloudAccess';
root.style.cssText = 'max-width:1160px;margin:18px auto;padding:0 18px';
root.innerHTML = `<div class="card"><div class="row"><div><h2 style="margin:0">Müşteri portalı / Bulut hesabı</h2><small class="muted">Müşteriler kendi hesaplarını görüntüler ve ödeme talebi gönderir.</small></div><span id="cloudStatus" class="pill red">Bulut yapılandırılmadı</span></div><div id="cloudLogin" style="margin-top:12px"><div class="formgrid"><div><label>E-posta</label><input id="cloudEmail" type="email" autocomplete="username" placeholder="ornek@mail.com"></div><div><label>Şifre</label><input id="cloudPassword" type="password" autocomplete="current-password"></div></div><div class="actionsbar"><button id="cloudLoginBtn">Giriş yap</button></div><small class="muted">Müşteri hesapları yönetici tarafından Firebase Authentication üzerinden oluşturulur.</small></div><div id="cloudPortal" class="hidden" style="margin-top:14px"></div><div id="cloudError" class="muted" role="status" style="margin-top:8px"></div></div>`;
document.body.insertBefore(root, document.querySelector('main'));
const $ = id => document.getElementById(id);
const configReady = firebaseConfig && !Object.values(firebaseConfig).some(v => String(v).startsWith('YOUR_'));
if (!configReady) { $('cloudError').textContent = 'للتفعيل: انسخ firebase-config.example.js إلى firebase-config.js وأدخل إعدادات مشروع Firebase. لن تعمل المزامنة قبل ذلك.'; }
else {
  const app = initializeApp(firebaseConfig), auth = getAuth(app), store = getFirestore(app), storage = getStorage(app);
  let stopAccount = null, stopRequests = null, stopMainData = null;
  let localSyncHandler = null, applyingCloudData = false, cloudSaveTimer = null;
  $('cloudStatus').textContent = 'Firebase جاهز'; $('cloudStatus').className = 'pill';
  $('cloudLoginBtn').onclick = async () => {
    $('cloudError').textContent = '';
    try { await signInWithEmailAndPassword(auth, $('cloudEmail').value.trim(), $('cloudPassword').value); }
    catch(e) { $('cloudError').textContent = 'تعذر تسجيل الدخول: ' + e.message; }
  };
  onAuthStateChanged(auth, async user => {
    if (stopAccount) stopAccount(); if (stopRequests) stopRequests();
    if (stopMainData) { stopMainData(); stopMainData = null; }
    if (localSyncHandler) { window.removeEventListener('ms-db-updated', localSyncHandler); localSyncHandler = null; }
    if (cloudSaveTimer) { clearTimeout(cloudSaveTimer); cloudSaveTimer = null; }
    applyingCloudData = false;
    $('cloudLogin').classList.toggle('hidden', !!user); $('cloudPortal').classList.toggle('hidden', !user);
    if (!user) { $('cloudPortal').innerHTML=''; return; }
    const email = (user.email || '').toLowerCase();
    const token = await user.getIdTokenResult(); const isAdmin = token.claims.admin === true;
    $('cloudPortal').innerHTML = `<div class="row"><b>مرحباً ${email.replace(/[&<>"']/g,'')}</b><button class="secondary small" id="cloudLogout">خروج</button></div>${isAdmin?'<div class="notice">حساب الإدارة: يمكنك مزامنة بيانات البرنامج كاملة بين أجهزتك، بالإضافة إلى كشوف العملاء.</div><div id="mainCloudStatus" class="muted" style="margin:8px 0">جاري تهيئة مزامنة بيانات البرنامج...</div><button id="cloudSyncAll">مزامنة جميع حسابات العملاء الآن</button><div id="cloudSyncMsg" class="muted"></div>':''}<div id="accountSnapshot" class="notice" style="margin-top:12px">جاري تحميل كشف الحساب السحابي...</div><div id="paymentRequestList"></div>${isAdmin?'':'<h3>إرسال طلب دفع / إيصال</h3><form id="paymentRequestForm"><label>المبلغ المطلوب تسجيله (₺)</label><input name="amount" type="number" min="0.01" step="0.01" required><label>طريقة الدفع</label><select name="method"><option>Nakit</option><option>Havale / EFT</option><option>Kredi Kartı</option></select><label>ملاحظة</label><textarea name="note" placeholder="رقم التحويل أو أي تفاصيل"></textarea><label>إرفاق إيصال (صورة أو PDF، حتى 10MB)</label><input name="receipt" type="file" accept="image/*,application/pdf"><div class="actionsbar"><button>إرسال للمراجعة</button></div><small class="muted">الطلب لا يغيّر رصيدك. الإدارة تراجعه وتوافق عليه قبل تسجيل الدفعة.</small></form>'}`;
    $('cloudLogout').onclick = () => signOut(auth);

    // Full administrator database sync: customers, sales, payments and settings.
    // One Firestore document is used for this first cloud-sync release.
    if (isAdmin) {
      const mainDataRef = doc(store, 'appData', 'main');
      const statusEl = $('mainCloudStatus');
      const setStatus = message => { if (statusEl) statusEl.textContent = message; };
      try {
        const localNow = window.getLocalDB?.();
        if (!localNow) throw new Error('تعذر قراءة قاعدة البيانات المحلية');
        const initialData = await runTransaction(store, async tx => {
          const snap = await tx.get(mainDataRef);
          if (snap.exists()) return snap.data().db;
          tx.set(mainDataRef, {
            db: localNow,
            revision: 1,
            updatedAt: serverTimestamp(),
            updatedBy: email
          });
          return localNow;
        });
        if (initialData && window.replaceLocalDB) {
          applyingCloudData = true;
          window.replaceLocalDB(initialData);
          applyingCloudData = false;
        }

        stopMainData = onSnapshot(mainDataRef, snap => {
          if (!snap.exists()) return;
          const remote = snap.data().db;
          if (!remote) return;
          const local = window.getLocalDB?.();
          if (JSON.stringify(local) !== JSON.stringify(remote)) {
            applyingCloudData = true;
            try { window.replaceLocalDB(remote); }
            finally { applyingCloudData = false; }
            setStatus('تم استلام آخر التغييرات من السحابة تلقائياً.');
          } else {
            setStatus('المزامنة السحابية نشطة — هذا الجهاز متصل.');
          }
        }, error => setStatus('خطأ في استقبال التحديثات: ' + error.message));

        localSyncHandler = () => {
          if (applyingCloudData) return;
          if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
          cloudSaveTimer = setTimeout(async () => {
            try {
              const latest = window.getLocalDB?.();
              if (!latest) throw new Error('تعذر قراءة البيانات المحلية');
              await runTransaction(store, async tx => {
                const snap = await tx.get(mainDataRef);
                const revision = snap.exists() ? Number(snap.data().revision || 0) + 1 : 1;
                tx.set(mainDataRef, {
                  db: latest,
                  revision,
                  updatedAt: serverTimestamp(),
                  updatedBy: email
                });
              });
              setStatus('تم رفع التغييرات إلى السحابة بنجاح.');
            } catch (err) {
              setStatus('تعذر رفع التغييرات: ' + err.message);
            }
          }, 700);
        };
        window.addEventListener('ms-db-updated', localSyncHandler);
        setStatus('المزامنة السحابية نشطة — تتم مزامنة العملاء والمبيعات والدفعات والإعدادات تلقائياً.');
      } catch (err) {
        applyingCloudData = false;
        setStatus('تعذر تشغيل المزامنة السحابية: ' + err.message);
      }
    }
    if(isAdmin){$('cloudSyncAll').onclick=async()=>{try{const local=window.getLocalDB?.();if(!local)throw Error('تعذر قراءة بيانات البرنامج');let count=0;for(const c of local.customers){if(!c.email)continue;const sales=local.sales.filter(x=>x.customerId===c.id),payments=local.payments.filter(x=>x.customerId===c.id);const salesTotal=sales.reduce((a,x)=>a+Number(x.total||0),0),paidTotal=payments.reduce((a,x)=>a+Number(x.amount||0),0);const entries=[...sales.map(x=>({date:x.date,type:'Satış',description:(x.items||[]).map(i=>`${i.name} ${i.qty} ${i.unit}`).join(', '),amount:Number(x.total||0)})),...payments.map(x=>({date:x.date,type:'Ödeme',description:x.method||'Ödeme',amount:-Number(x.amount||0)}))].sort((a,b)=>(a.date||'').localeCompare(b.date||''));await setDoc(doc(store,'customerAccounts',c.email.toLowerCase()),{customerName:c.name,salesTotal,paidTotal,balance:salesTotal-paidTotal,entries,updatedAt:serverTimestamp()});count++}$('cloudSyncMsg').textContent=`تمت مزامنة ${count} حساب عميل. تأكد من إضافة بريد إلكتروني لكل عميل.`}catch(err){$('cloudSyncMsg').textContent='فشلت المزامنة: '+err.message}};}

    stopAccount = onSnapshot(doc(store,'customerAccounts',email), snap => {
      const d=snap.exists()?snap.data():null;
      $('accountSnapshot').innerHTML = d ? `<b>كشف الحساب · ${d.customerName||email}</b><div class="stats" style="grid-template-columns:repeat(3,1fr);margin-top:10px"><div class="stat"><small>إجمالي المبيعات</small><b>${Number(d.salesTotal||0).toLocaleString('tr-TR')} ₺</b></div><div class="stat"><small>المدفوع</small><b class="green">${Number(d.paidTotal||0).toLocaleString('tr-TR')} ₺</b></div><div class="stat"><small>المتبقي</small><b class="red">${Number(d.balance||0).toLocaleString('tr-TR')} ₺</b></div></div><div style="overflow:auto"><table><thead><tr><th>التاريخ</th><th>العملية</th><th>التفاصيل</th><th>المبلغ</th></tr></thead><tbody>${(d.entries||[]).map(x=>`<tr><td>${x.date||''}</td><td>${x.type||''}</td><td>${x.description||''}</td><td>${Number(x.amount||0).toLocaleString('tr-TR')} ₺</td></tr>`).join('')}</tbody></table></div>` : 'لم يتم ربط هذا البريد بحساب عميل بعد. تواصل مع الإدارة.';
    }, e => $('accountSnapshot').textContent='خطأ في تحميل الحساب: '+e.message);
    const rq=isAdmin?collection(store,'paymentRequests'):query(collection(store,'paymentRequests'),where('email','==',email));
    stopRequests=onSnapshot(rq,s=>{ $('paymentRequestList').innerHTML='<h3>'+(isAdmin?'طلبات الدفع الواردة':'طلبات الدفع السابقة')+'</h3>'+s.docs.map(x=>{let d=x.data();return `<div class="item"><div><b>${Number(d.amount||0).toLocaleString('tr-TR')} ₺ · ${d.method||''}</b><small>${d.email||''} · ${d.createdAt?.toDate?.().toLocaleString('tr-TR')||'حديثاً'} · ${d.status==='pending'?'قيد المراجعة':d.status==='approved'?'تمت الموافقة':'مرفوض'}</small>${d.note?`<small>${String(d.note).replace(/[&<>]/g,'')}</small>`:''}</div><div>${d.receiptUrl?`<a href="${d.receiptUrl}" target="_blank" rel="noopener">الإيصال</a>`:''}${isAdmin&&d.status==='pending'?`<button class="small" data-approve="${x.id}">تأكيد الدفع</button><button class="small danger" data-reject="${x.id}">رفض</button>`:''}</div></div>`}).join('')||'<p class="muted">لا توجد طلبات بعد.</p>';if(isAdmin){$('paymentRequestList').querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{try{const req=s.docs.find(x=>x.id===b.dataset.approve).data();const local=window.getLocalDB?.();const c=local?.customers.find(c=>(c.email||'').toLowerCase()===req.email);if(!c)throw Error('لا يوجد عميل بهذا البريد في البرنامج المحلي');local.payments.push({id:'cloud_'+b.dataset.approve,customerId:c.id,date:new Date().toISOString().slice(0,10),amount:Number(req.amount),method:req.method||'Havale / EFT',note:'تم اعتماد طلب العميل: '+(req.note||''),created:new Date().toISOString()});window.saveLocalDB?.();await updateDoc(doc(store,'paymentRequests',b.dataset.approve),{status:'approved',reviewedAt:serverTimestamp()});$('cloudSyncAll').click();}catch(err){alert('تعذر اعتماد الطلب: '+err.message)}});$('paymentRequestList').querySelectorAll('[data-reject]').forEach(b=>b.onclick=async()=>{if(confirm('رفض طلب الدفع؟'))await updateDoc(doc(store,'paymentRequests',b.dataset.reject),{status:'rejected',reviewedAt:serverTimestamp()})})}});
    if(!$('paymentRequestForm')) return;
    $('paymentRequestForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{let receiptUrl='';const file=f.get('receipt');if(file&&file.size){const path=`receipts/${email}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const uploaded=await uploadBytes(ref(storage,path),file);receiptUrl=await getDownloadURL(uploaded.ref)}await addDoc(collection(store,'paymentRequests'),{email,amount:Number(f.get('amount')),method:f.get('method'),note:f.get('note'),receiptUrl,status:'pending',createdAt:serverTimestamp()});e.target.reset();alert('تم إرسال الطلب للإدارة للمراجعة. لم يتم تعديل رصيدك.')}catch(err){$('cloudError').textContent='تعذر إرسال الطلب: '+err.message}};
  });
  // The existing local accounting database is exposed for a later controlled admin sync.
  window.msCloudReady = true;
}
