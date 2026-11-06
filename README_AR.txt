MS ACCOUNTING — النسخة الأولية

الموجود في هذه النسخة:
- إضافة العملاء والبحث عنهم.
- تسجيل مبيعات بمواد متعددة، كمية، وحدة، سعر وحدة وإجمالي تلقائي.
- تسجيل دفعات جزئية أو كاملة مع طريقة الدفع: Nakit / Havale-EFT / Kredi Kartı.
- حساب الرصيد المتبقي تلقائياً.
- كشف حساب لكل عميل مع الطباعة أو الحفظ PDF من نافذة الطباعة.
- تصدير CSV لفتحه في Excel، ونسخ احتياطي/استعادة JSON.
- واجهة متجاوبة للكمبيوتر والهاتف ودعم التثبيت كتطبيق PWA.

مهم جداً بشأن السحابة:
هذه نسخة أولية تعمل محلياً على الجهاز (تخزن البيانات في متصفح الجهاز). لم يتم تفعيل المزامنة السحابية بعد، لأن ذلك يتطلب إنشاء مشروع Firebase وربطه بمفاتيح مشروعك وإعداد تسجيل دخول وقواعد أمان. لا تدخل بيانات حساسة أو تعتمد عليها كنسخة وحيدة قبل إعداد النسخ الاحتياطي والسحابة.

التشغيل:
1) فك ضغط الملف.
2) افتح index.html في متصفح حديث للتجربة.
3) للحصول على التثبيت وميزات PWA، ارفع الملفات إلى استضافة HTTPS مثل GitHub Pages.
4) البيانات لا تنتقل تلقائياً بين الأجهزة في هذه النسخة. استخدم "Yedek indir" و"Yedek yükle" لنقل البيانات مؤقتاً.

الخطوة التالية:
ربط Firebase Authentication + Firestore مع قواعد أمان لكل حساب، ثم إضافة تسجيل دخول ومزامنة بين الهاتف والكمبيوتر.

Güncelleme V1.2:
- Ayarlar > Birim yönetimi bölümünden birim ekleyebilir ve silebilirsiniz.
- Satış kaydındaki Birim listesi, kaydettiğiniz birimlerden otomatik oluşur.
- Birimi silmek eski satış kayıtlarındaki birim bilgisini silmez/değiştirmez.
- Eski yerel veriler korunur; yeni birimler mevcut tarayıcı verisine varsayılanlarla eklenir.
