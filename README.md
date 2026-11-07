# Manpower Request Portal

## خطوات التشغيل على Railway

1. فك الضغط عن الملف `manpower-portal.zip` في فولدر جديد على جهازك.
2. افتح GitHub Desktop واعمل ريبو جديد من الفولدر ده، وبعدين اعمل Publish.
3. على Railway: اعمل مشروع جديد واختار الريبو الجديد.
4. في نفس المشروع على Railway ضيف قاعدة بيانات PostgreSQL.
5. افتح خدمة الموقع، ومن تاب Variables ضيف المتغيرات دي:

| المتغير | القيمة |
|---|---|
| DATABASE_URL | اختارها من قاعدة البيانات (Reference) |
| SESSION_SECRET | أي كلام طويل عشوائي |
| ADMIN_CODE | كود حساب HR الأول |
| ADMIN_PASSWORD | باسورد حساب HR الأول |

6. من تاب Settings اعمل Generate Domain علشان يطلع لينك الموقع.

## أول استخدام

1. ادخل بحساب HR (ADMIN_CODE و ADMIN_PASSWORD).
2. افتح كارت Upload Data وارفع ملف الموظفين وبعده ملف الـ Titles.
3. في نفس الصفحة اكتب باسورد افتراضي ودوس Create manager accounts.
4. من كارت Users غيّر دور مسؤول OD BU من Manager إلى OD BU.

## شكل الملفين

ملف الموظفين:
Code, Name, Title, Department, Location, Type, Manager 1 Code, Manager 2 Code

ملف الـ Titles:
Title, Department, Manager 1 Code, Manager 2 Code

الـ Type بيتكتب FTE أو Outsource. عمود Manager 2 Code اختياري.
فيه نموذج جاهز للملفين في صفحة Upload Data.

## الأدوار

| الدور | بيعمل إيه |
|---|---|
| HR | رفع الملفات، إدارة اليوزرز، وكل صلاحيات OD BU |
| OD BU | يشوف كل الطلبات، يقفل كل مرحلة، يكتب كومنت، يكتب رقم Taleo |
| Manager | يشوف الموظفين اللي تحته، ويطلب Titles ويتابع طلباته |

## مسار الطلب

OD BU (3 أيام) ثم OD Group (3 أيام) ثم HRIS (يومين) ثم HCM (يومين) ثم Requisition open على Taleo (10 أيام).
أيام العمل من الأحد للخميس. الطلب بيتعلم Late لو المرحلة عدّت مدتها.

## اللوجو

حط اللوجو باسم `logo.png` جوه فولدر `public/assets`.
