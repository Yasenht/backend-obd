# متطلبات الباك إند: نتائج تشخيص الأعطال وتخزينها

هذا العقد مبني على مراجعة الكود الحالي، لا على افتراض وجود خدمات: التطبيق
يستخدم حالياً `POST /api/vehicles/` و`GET /api/vehicles/search/` لتسجيل/اختيار
المركبة، و`POST /api/analyze/dtc` لتحليل الأكواد. توجد طبقة عميل جاهزة
للسجل الصحي في `lib/data/remote_health_repository.dart`، لكن التطبيق يعمل
بالمستودع المحلي `LocalHealthRecordRepository` لأن نقاط نهاية الصحة ليست
منشورة أو موثقة كعاملة بعد. لذلك يلزم تنفيذ هذا العقد لتصبح النتيجة مخزنة
فعلياً في قاعدة البيانات المركزية.

## ما يرسله التطبيق فعلياً

1. لا يبدأ فحص DTC أو Freeze Frame قبل اختيار مركبة مسجّلة لها `id` وVIN.
2. قراءة الأكواد العادية تستخدم `03`، ثم `DTCS?` كبديل لجهاز Freematics
   المرقّع. قراءة إطار التجميد تستخدم `02`؛ الرد المتوقع يبدأ بـ`42`.
3. يفك التطبيق الرد محلياً إلى مصفوفة فريدة من الأكواد (`P/C/B/U`، مثل
   `P0108`, `P0109`) قبل إرسالها إلى الخدمة. لا يرسل البايتات الخام `42` أو
   `43` كأكواد.
4. يطلب الشرح عبر `POST /api/analyze/dtc` ثم يحفظ لقطة الاستجابة كاملة في
   حقل `dtcAnalysis` في جلسة الفحص. تشمل اللقطة السبب/الشرح/الخطوات والحلول.
5. يحفظ التقرير PDF محلياً/بنافذة مشاركة النظام؛ لا توجد خدمة رفع تقارير
   مفعلة حالياً.

### قاعدة صحة البيانات في العميل

- لا يستبدل العميل قراءة ECU مفقودة بـ `0` أو قيمة افتراضية. الحقل الغائب
  يبقى `null` أو يعرض «غير متاح» مع سبب.
- وقت التقرير هو وقت اكتمال الفحص فقط؛ لا يُستبدل بوقت إنشاء التقرير.
- `dtcCount` يُخزن فقط إذا ورد من PID `0101` (MIL). عدد الأكواد المفكوكة
  لا يُكتب مكانه لأنه ليس القياس نفسه.
- لا تُحفظ قراءة حساس أو جلسة تحت معرف اصطناعي مثل `unknown`؛ يلزم معرف
  المركبة المختارة. القيم المشتقة (مثل التغطية أو تقييم الصحة) يجب أن تحمل
  منهجيتها وتغطيتها ولا تُعرض كقراءات ECU.

## واجهات موجودة يجب تثبيتها

### المركبات

`POST /api/vehicles/`

```json
{ "vin": "1HGCM82633A004352", "vehicle_name": "كامري العائلة" }
```

يرجع `201` مع كائن فيه على الأقل `id`, `vin`, `vehicle_name`, `createdAt`.
يجب جعل `(account_id, normalized_vin)` فريداً وإرجاع `409` ببيان المركبة
الموجودة أو آلية آمنة لاختيارها.

`GET /api/vehicles/search/?vin=...` أو `?search=...` يعيد صفحة:

```json
{ "count": 1, "results": [{ "id": "veh_123", "vin": "...", "vehicle_name": "...", "createdAt": "..." }] }
```

يجب أن تكون نتائج البحث ضمن حساب المستخدم فقط.

### تحليل الأكواد

`POST /api/analyze/dtc`

```json
{ "codes": ["P0108", "P0109"] }
```

الرد المقبول مباشرة أو داخل `data`:

```json
{
  "success": true,
  "status": "faults_found",
  "title": "تم العثور على أعطال",
  "description": "...",
  "totalFaults": 2,
  "codes": ["P0108", "P0109"],
  "faults": [{
    "code": "P0108",
    "success": true,
    "title": "...",
    "description": "...",
    "meaning": "...",
    "possibleCauses": ["..."],
    "possibleSymptoms": ["..."],
    "diagnosticSteps": ["..."],
    "solutions": ["..."],
    "severity": "high",
    "severityPercentage": 80,
    "severityExplanation": "...",
    "confidence": 0.9
  }]
}
```

لكود لا يمكن تحليله، يعيد العنصر `{ "code": "...", "success": false,
"error": "..." }` ولا يفشل الدفعة كلها. حد التطبيق 100 كود فريد في الطلب.

## واجهات التخزين المطلوب نشرها

كل المسارات أدناه تحت `/api/health/vehicles/{vehicleId}`، حيث `vehicleId`
هو معرّف المركبة الخادمي (`veh_123`) وليس VIN. يجب التحقق من أن المركبة تخص
المستخدم صاحب رمز Bearer.

| العملية | المسار | الجسم/النتيجة |
| --- | --- | --- |
| حفظ أو تحديث جلسة | `PUT /scans/{scanId}` | كائن `DiagnosticScanSession` أدناه؛ عملية idempotent |
| قراءة الجلسات | `GET /scans?limit=100` | مصفوفة جلسات، الأحدث أولاً |
| دمج تاريخ DTC | `POST /dtcs/observations` | ملاحظة الأكواد أدناه؛ يعيد سجلات DTC المحدثة |
| قراءة تاريخ DTC | `GET /dtcs` | مصفوفة سجلات DTC |
| ترحيل هوية محلية قديمة | `POST /migrate` | `{fromVehicleId,targetProfile}` |

للتوافق مع العميل الموجود حالياً، يمكن للخادم قبول `POST /scans` أيضاً، لكن
يجب أن يكون `id` مفتاح upsert؛ وإلا سيؤدي إلحاق `dtcAnalysis` بعد وصوله من
خدمة التحليل إلى إنشاء جلسة مكررة. يوصى بتحديث العميل لاحقاً إلى `PUT` أعلاه.

### بنية جلسة الفحص

```json
{
  "id": "scan-1732540000000000",
  "vehicleId": "veh_123",
  "mode": "freezeFrame",
  "startedAt": "2026-11-25T10:00:00.000Z",
  "completedAt": "2026-11-25T10:00:02.000Z",
  "status": "completed",
  "readOnly": true,
  "vin": "1HGCM82633A004352",
  "adapterName": "Freematics",
  "dtcCodes": ["P0108", "P0109"],
  "freezeFrameCodes": ["P0108", "P0109"],
  "rawRecords": [{
    "id": "raw-...-dtc",
    "command": "02",
    "rawResponse": "42 02 01 08 01 09",
    "decodedSummary": "P0108، P0109",
    "recordedAt": "2026-11-25T10:00:02.000Z",
    "source": "ecu",
    "quality": "good"
  }],
  "dtcAnalysis": { "success": true, "faults": [] }
}
```

`dtcAnalysis` هو نسخة الاستجابة كاملة من `/analyze/dtc`؛ تخزن في JSONB أو
في جداول فرعية مطبّعة حسب احتياجات البحث. لا تعِد توليد شرح قديم تلقائياً
عند تغير قاعدة المعرفة؛ أضف `analysisVersion` و`analyzedAt` إن أُعيد التحليل.

جسم `POST /dtcs/observations`:

```json
{
  "scanId": "scan-...",
  "codes": ["P0108", "P0109"],
  "freezeFrameCodes": ["P0108", "P0109"],
  "observedAt": "2026-11-25T10:00:02.000Z",
  "source": "ecu",
  "raw": "42 02 01 08 01 09",
  "state": "stored"
}
```

## قاعدة البيانات والضمانات

- `vehicles(id, account_id, vin_normalized, vehicle_name, created_at)` مع
  فهرس فريد على `(account_id, vin_normalized)`.
- `diagnostic_scans(id, vehicle_id, mode, started_at, completed_at, status,
  raw_records_jsonb, dtc_codes_jsonb, freeze_frame_codes_jsonb,
  dtc_analysis_jsonb, ...)`؛ فهرس `(vehicle_id, completed_at DESC)`.
- جدول `dtc_observations(scan_id, vehicle_id, code, is_freeze_frame,
  observed_at, raw_response)`، وجدول/عرض ملخص `vehicle_dtcs` لتاريخ أول/آخر
  ظهور وعدد مرات المشاهدة.
- استخدم معاملة واحدة عند upsert الجلسة وتسجيل ملاحظات DTC، ومفتاح idempotency
  أو `scan.id` لمنع التكرار بعد إعادة المحاولة.
- شفر VIN والرد الخام في التخزين والنسخ الاحتياطي، طبّق صلاحيات الحساب، وسجل
  تدقيقاً للوصول. لا تحفظ أي أوامر مسح ECU ضمن هذه المسارات.

## التقارير

التطبيق يولد PDF محلياً بعد انتظار التحليل، ويضم اسم المركبة وVIN ووقت الفحص
والأكواد وإطار التجميد وحالة MIL والشرح والحلول. إذا طُلبت أرشفة خادمية لاحقاً:
`POST /api/health/vehicles/{vehicleId}/reports` يستقبل `scanId` ويولد PDF من
الجلسة المخزنة فقط، ثم يعيد رابطاً قصير العمر. لا يقبل HTML/PDF خاماً من
العميل من دون فحص حجم/محتوى.

## أخطاء وعقد استجابة

استخدم JSON وHTTPS فقط، ورمز `Authorization: Bearer`. يدعم العميل غلاف
`{ "data": ... }` أو البيانات المباشرة؛ ثبّت الغلاف الرسمي إلى
`{ "status": true, "data": ... }`. أعد `400` للتحقق، `401/403` للهوية،
`404` لمركبة غير موجودة، `409` للتعارض، و`422` لحمولة جلسة غير صالحة. لا
تعرض VIN أو الرد الخام في رسائل الخطأ أو السجلات العامة.
