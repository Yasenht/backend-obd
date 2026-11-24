# متطلبات الباك إند — سجل صحة المركبة والتشخيص التنبؤي

**المشروع:** DriveScope — تطبيق Flutter لفحص المركبات عبر BLE/OBD-II  
**الحالة:** متطلبات تصميم لعقد خادم لم يُنشر بعد  
**تاريخ الوثيقة:** 2026-11-23  
**نطاق الوثيقة:** توسعة الباك إند لدعم سجل صحة رقمي، فحوصات قراءة فقط، سلاسل زمنية للحساسات، صيانة/إصلاح، تقييمات وتنبؤات مبنية على أدلة، وتقارير.

> **تنبيه صريح:** لا توجد حالياً نقاط نهاية صحية منشورة على
> `https://backend-obd.onrender.com/api`. التطبيق يعمل بمستودع محلي دائم
> (`LocalHealthRecordRepository`) ولا يدّعي أن هذه الخدمات مكتملة. الملف
> `lib/data/remote_health_repository.dart` تنفيذ عميل جاهز للربط بعد نشر
> العقد أدناه واختباره.

---

## 1. الهدف والنطاق

### 1.1 ما يجب أن يوفره الباك إند

1. هوية مركبة قابلة للربط بين السجل المحلي وسجل الخادم.
2. حفظ جلسات الفحص وردود ECU الخام، مع مصدر كل معلومة وجودتها.
3. سجل تاريخي لأكواد الأعطال وإطارات التجميد (Freeze Frame).
4. سلاسل زمنية لقراءات الحساسات مع استعلامات زمنية وتجميع.
5. خط زمني موحّد يجمع الفحوصات والأكواد والقراءات والصيانة والتقييمات.
6. سجل صيانة/إصلاح مع تحقق قبل/بعد.
7. تقييم صحي خادمي اختياري قابل للتفسير، مع تغطية وثقة وقيود.
8. واجهات تنبؤية مستقبلية **لا تصدر تواريخ فشل** قبل التحقق من نموذج.
9. تقارير قابلة للتنزيل ورفع تقارير/ملفات خام عند الحاجة.
10. خصوصية وحذف/تصدير بيانات، وتدقيق، واحتفاظ محدود.

### 1.2 ما هو خارج النطاق الحالي

- مسح أو تعديل ذاكرة ECU، برمجة وحدات، إعادة ضبط، أو تغيير إعدادات.
- تشخيص ABS/SRS/BCM عبر OBD-II العام؛ تحتاج بروتوكولات مصنّعة.
- تقدير تاريخ فشل مكوّن بلا نموذج مُتحقَّق.
- ادعاء أن غياب كود يعني سلامة النظام.
- استخدام تعلّم آلي في التطبيق الحالي. لا توجد بيانات تدريب موثوقة بعد.

### 1.3 مبادئ إلزامية

| المبدأ | التطبيق |
| --- | --- |
| فصل المصادر | كل قيمة/حدث يحمل `source`: `ecu` أو `adapter` أو `application` أو `user` أو `backend` أو `derived`. |
| لا اختراع بيانات | الحقول الغائبة `null` أو تُدرج في `unavailable` مع سبب، لا قيم افتراضية مضللة. |
| قراءة فقط | كل جلسة فحص أولية تحمل `readOnly: true`، والخادم يرفض أي أمر تعديل ضمن مسار الفحص. |
| قابلية التفسير | كل استنتاج يحمل `evidence`, `confidence`, `methodology`, `limitations`. |
| ثقة/تغطية | لا درجة بلا تغطية معلنة، ولا ثقة بلا عينات كافية. |
| خصوصية أولاً | VIN وموقع/معرّفات الجهاز بيانات حساسة؛ تقليل الجمع والاحتفاظ. |

---

## 2. المعمارية المقترحة

```text
Flutter App (DriveScope)
  ├─ BleObdService ──► OBD adapter (ELM327/Freematics)
  ├─ AppController
  │    ├─ LocalHealthRecordRepository (افتراضي، SharedPreferences)
  │    ├─ RemoteHealthRecordRepository (HTTP، غير مربوط افتراضياً)
  │    └─ HealthAnalysisEngine (تحليل محلي حتمي)
  └─ REST/HTTPS ──► API Gateway / Auth
                       ├─ Vehicle Service
                       ├─ Health Record Service
                       ├─ Ingestion Service (scans/readings)
                       ├─ Analytics Service (rules/statistics)
                       ├─ Report Service
                       └─ Prediction Service (مستقبلي، feature-gated)

Storage
  ├─ PostgreSQL (هوية، فحوصات، أكواد، صيانة، تقييمات)
  ├─ TimescaleDB/ClickHouse (سلاسل الحساسات عالية الحجم)
  ├─ Object Storage (S3/R2) للتقارير والملفات الخام الكبيرة
  └─ Redis (rate limit، idempotency، queues)

Async
  ├─ Queue: تحليل الدفعات، توليد التقارير، التنبؤات
  └─ Worker: مهام ثقيلة مع إعادة محاولة وdead-letter
```

### 2.1 مسؤوليات الطبقات

| الطبقة | المسؤولية | لا تفعل |
| --- | --- | --- |
| التطبيق | جمع، عرض، تخزين مؤقت، تحليل محلي، حالة الواجهة | لا تفترض وجود خادم |
| API | تحقق، مصادقة، تخزين، نسخ احتياطي، تعدد الأجهزة | لا ترسل أوامر ECU |
| التحليل الخادمي | قواعد/إحصاء قابل للتفسير، تجميع، كشف تكرار | لا تنشئ تاريخاً مفقوداً |
| التنبؤ | نماذج مُتحقَّقة فقط مع بيانات كافية | لا تواريخ فشل دون تحقق |

### 2.2 تدفق البيانات (Data Flows)

#### أ) أول اتصال — فحص قراءة فقط

```text
BLE connect
  → read VIN (VIN/0902) [اختياري]
  → 0100 supported PIDs
  → 0101 MIL + I/M readiness
  → 03 ثم DTCS? عند الفشل
  → 02 Freeze Frame (اختياري)
  → 010C RPM / 0105 coolant / BATT
  → بناء DiagnosticScanSession(readOnly=true)
  → حفظ محلي فوري
  → مزامنة خادم (POST scans + POST dtcs/observations + POST sensors)
  → إعادة حساب التقييم
```

#### ب) قراءات حية

```text
Timer 5s → rpm/speed/coolant/battery
  → buffer في الذاكرة (حتى 16 قراءة أو 60 ثانية)
  → flush دفعة واحدة (محلي)
  → مزامنة دورية للخادم (batch)
  → تحديث الاتجاهات والتقييم المحلي
```

#### ج) ترقية الهوية

```text
adapter:<id> → profile:<year_make_model> → vin:<VIN> → vehicle:<server_id>
```

لا يحدث تراجع إلى هوية أقل تحديداً. الترقية تستدعي
`POST /health/vehicles/{toVehicleId}/migrate` ثم تحذف المفاتيح القديمة.

#### د) التحقق من إصلاح

```text
MaintenanceRecord(scoreBefore, dtcCodesBefore)
  → فحص لاحق
  → مقارنة الدرجة والأكواد
  → RepairVerification(outcome, resolvedCodes, persistingCodes, newCodes)
```

---

## 3. هوية المركبة والملف الشخصي

### 3.1 مفاتيح الهوية المحلية

| الأولوية | الصيغة | مثال | متى تُستخدم |
| --- | --- | --- | --- |
| 4 | `vehicle:<server_id>` | `vehicle:6b02ee4d...` | مركبة مسجّلة/مختارة من الخادم |
| 3 | `vin:<VIN>` | `vin:1HGCM82633A004352` | VIN مقروء من الجهاز أو مُدخل |
| 2 | `profile:<year_make_model>` | `profile:2015_Toyota_Corolla` | اختيار يدوي بلا VIN |
| 1 | `adapter:<device_id>` | `adapter:AA:BB:CC:DD:EE:FF` | اتصال بلا هوية مركبة |
| 0 | `profile:unregistered` | — | قبل أي هوية |

- يُسمح بالترقية فقط (`rank` أعلى)، ولا يُسمح بالتراجع.
- عند الترقية تُرحّل الجلسات والأكواد والقراءات والصيانة إلى المفتاح الجديد.
- المفتاح يُرسل في المسار بترميز URL؛ الخادم يعامله كمعرّف غامض
  (opaque) ويربطه داخلياً بـ `vehicle_id` وكانوني.

### 3.2 كائن الملف الصحي

```json
{
  "id": "vehicle:6b02ee4d2e55d25879378b67",
  "displayName": "2015 Toyota Corolla",
  "vin": "1HGCM82633A004352",
  "make": "Toyota",
  "model": "Corolla",
  "year": 2015,
  "createdAt": "2026-11-20T10:00:00.000Z",
  "updatedAt": "2026-11-23T09:15:00.000Z",
  "firstScanAt": "2026-11-20T10:02:11.000Z",
  "lastScanAt": "2026-11-23T09:14:02.000Z",
  "notes": ""
}
```

**قواعد:**

- `vin` إن وُجد يجب أن يكون 17 محرفاً بعد التطبيع (بدون I/O/Q).
- `displayName` نص عرض فقط، وليس معرّفاً.
- `firstScanAt`/`lastScanAt` من جلسات هذا التطبيق، وليسا تاريخ المركبة.
- لا يُستنتج `make/model/year` من VIN على الخادم ما لم تُستخدم خدمة فك VIN
  مرخّصة ومعلنة للمستخدم.

---

## 4. اصطلاحات API

### 4.1 الأساس والمصادقة

| العنصر | القيمة |
| --- | --- |
| Base URL | `https://backend-obd.onrender.com/api` |
| النقل | HTTPS فقط (TLS 1.2+) |
| التنسيق | `application/json; charset=utf-8` |
| المصادقة | `Authorization: Bearer <access_token>` |
| رموز الوصول | JWT قصير العمر (15–30 دقيقة) + refresh token دوّار |
| تعدد المستخدمين | كل سجل مرتبط بـ `account_id`؛ لا وصول عبر تخمين `vehicleId` |
| الإصدار | مسار `/api/` الحالي؛ التغييرات الكاسرة عبر `/api/v2/` |
| CORS | للعملاء الرسميين فقط، بلا `*` في الإنتاج |
| Rate limits | مقترح: 60 طلب/دقيقة/مستخدم، 10 دفعات كتابة/دقيقة |

### 4.2 غلاف الاستجابة

النجاح:

```json
{
  "status": true,
  "data": {},
  "metrics": {
    "handledInMs": 4,
    "respondInMs": 6
  }
}
```

الفشل:

```json
{
  "status": false,
  "messages": [
    {
      "code": "INVALID_VIN",
      "message": "رقم الهيكل غير صالح.",
      "field": "vin"
    }
  ],
  "requestId": "req_01J8Z3K4"
}
```

يقبل العميل أيضاً `data` مباشرة أو مصفوفة عارية كخيار احتياطي، لكن العقد
الرسمي هو الغلاف أعلاه.

### 4.3 رموز الحالة

| الحالة | الاستخدام |
| --- | --- |
| `200` | قراءة/تحديث ناجح |
| `201` | إنشاء سجل/جلسة |
| `202` | مهمة تحليل/تقرير غير متزامنة |
| `204` | حذف ناجح بلا محتوى |
| `400` | تحقق فاشل |
| `401` | رمز مفقود/منتهٍ |
| `403` | لا صلاحية على السجل |
| `404` | سجل غير موجود |
| `409` | تعارض إصدار/تكرار |
| `413` | دفعة كبيرة جداً |
| `422` | بيانات صالحة شكلاً لكن غير منطقية (مثل زمن مستقبلي) |
| `429` | تجاوز الحد |
| `500/503` | خطأ خادم/خدمة غير متاحة مع `requestId` |

### 4.4 الزمن والترقيم والصفحات

- كل الأزمنة ISO-8601 UTC: `2026-11-23T09:14:02.000Z`.
- الخادم يرفض الأزمنة المستقبلية بأكثر من 5 دقائق (`422`).
- المعرّفات نصوص مستقرة (ULID/UUID/Mongo ObjectId)؛ لا تُعاد صياغتها.
- الصفحات: `?limit=50&offset=0` أو cursor: `?cursor=...&limit=100`.
- الحد الأقصى المقترح: 500 عنصر/طلب، 5,000 قراءة/دفعة.
- الحقول غير المعروفة تُتجاهل بأمان (forward compatibility).

### 4.5 Idempotency

- الكتابات الدفعية تقبل `Idempotency-Key` (UUID) في الترويسة.
- إعادة الإرسال بنفس المفتاح لا تكرر السجل، وتعيد نفس النتيجة.
- مناسب لضعف الشبكة في BLE/الهاتف.

---

## 5. نقاط النهاية

> جميع المسارات أدناه نسبية إلى `/api`. كل مسار مركبة يقبل مفتاح الهوية
> (`vehicle:...` أو `vin:...` أو `profile:...`) بعد ترميز URL، أو
> `vehicle_id` كانوني من الخادم بعد الربط.

### 5.1 المصادقة والحساب (مطلوبة للإنتاج)

#### `POST /auth/register`

```json
{
  "email": "owner@example.com",
  "password": "strong-password",
  "displayName": "مالك المركبة",
  "consent": {
    "termsVersion": "2026-11-01",
    "privacyVersion": "2026-11-01",
    "acceptedAt": "2026-11-23T09:00:00.000Z",
    "analyticsOptIn": false
  }
}
```

#### `POST /auth/login`

```json
{ "email": "owner@example.com", "password": "strong-password" }
```

استجابة (`200`):

```json
{
  "status": true,
  "data": {
    "accessToken": "eyJ...",
    "accessExpiresIn": 1800,
    "refreshToken": "rt_...",
    "account": { "id": "acc_01J8", "email": "owner@example.com" }
  }
}
```

#### `POST /auth/refresh` و`POST /auth/logout`

- Refresh دوّار، ويُبطَل عند الاشتباه.
- لا تُخزَّن كلمات المرور إلا بتجزئة Argon2id/bcrypt.
- لا تُسجَّل الرموز أو كلمات المرور في logs.

---

### 5.2 ملفات المركبات

#### `GET /health/vehicles/profiles?limit=50&offset=0`

```json
{
  "status": true,
  "data": {
    "totalCount": 2,
    "results": [
      {
        "id": "vehicle:6b02ee4d2e55d25879378b67",
        "displayName": "2015 Toyota Corolla",
        "vin": "1HGCM82633A004352",
        "make": "Toyota",
        "model": "Corolla",
        "year": 2015,
        "createdAt": "2026-11-20T10:00:00.000Z",
        "updatedAt": "2026-11-23T09:15:00.000Z",
        "firstScanAt": "2026-11-20T10:02:11.000Z",
        "lastScanAt": "2026-11-23T09:14:02.000Z",
        "notes": ""
      }
    ]
  }
}
```

#### `GET /health/vehicles/{vehicleId}/profile`

- `200` مع الملف، أو `404` إن لم يوجد.
- العميل يتعامل مع `404` كـ «لا ملف بعد» لا كخطأ اتصال.

#### `PUT /health/vehicles/{vehicleId}/profile`

جسم الطلب = كائن الملف (بلا `id` متعارض). الاستجابة `200`.

#### `POST /health/vehicles/{toVehicleId}/migrate`

يرحّل سجلات هوية قديمة إلى الهوية الأكثر تحديداً.

```json
{
  "fromVehicleId": "vin:1HGCM82633A004352",
  "targetProfile": {
    "id": "vehicle:6b02ee4d2e55d25879378b67",
    "displayName": "2015 Toyota Corolla",
    "vin": "1HGCM82633A004352",
    "createdAt": "2026-11-20T10:00:00.000Z",
    "updatedAt": "2026-11-23T09:15:00.000Z"
  }
}
```

**سلوك إلزامي:**

- نقل الجلسات/الأكواد/القراءات/الصيانة إلى الهدف.
- دمج أكواد مكررة دون مضاعفة `occurrenceCount` مرتين لنفس الفحص
  (استخدم `scanId` كمفتاح منع تكرار).
- حذف مفاتيح المصدر بعد النجاح أو تعليمها `migrated_to`.
- العملية ذرّية أو قابلة لإعادة المحاولة بأمان.

#### `DELETE /health/vehicles/{vehicleId}`

- `204` بعد حذف السجل وكل البيانات المرتبطة.
- `404` تُقبل كنجاح من العميل (الحذف مطلوب أصلاً).
- يجب أن يشمل الحذف: الملف، الجلسات، الأكواد، القراءات، الصيانة،
  التقييمات، والملفات المرتبطة. تُبقي فقط سجلات تدقيق مجهولة الهوية.

---

### 5.3 جلسات الفحص والوحدات

#### `POST /health/vehicles/{vehicleId}/scans`

```json
{
  "id": "scan-01J8Z4M9",
  "vehicleId": "vehicle:6b02ee4d2e55d25879378b67",
  "mode": "firstConnection",
  "startedAt": "2026-11-23T09:13:40.000Z",
  "completedAt": "2026-11-23T09:14:02.000Z",
  "status": "completed",
  "readOnly": true,
  "protocol": "",
  "adapterName": "Freematics OBD",
  "vin": "1HGCM82633A004352",
  "modules": [
    {
      "id": "engine",
      "name": "وحدة التحكم بالمحرك (ECM)",
      "address": "",
      "protocol": "",
      "reachable": true,
      "softwareVersion": null,
      "notes": "MIL: مطفأ، أكواد معلنة: 0"
    },
    {
      "id": "abs",
      "name": "وحدة الفرامل ABS",
      "address": "",
      "protocol": "",
      "reachable": false,
      "softwareVersion": null,
      "notes": "لا تُقرأ عبر OBD-II العام"
    }
  ],
  "rawRecords": [
    {
      "id": "raw-01J8Z4M9-03",
      "command": "03",
      "rawResponse": "43 00",
      "decodedSummary": "لا أكواد",
      "recordedAt": "2026-11-23T09:13:58.000Z",
      "source": "ecu",
      "quality": "good",
      "error": null
    }
  ],
  "dtcCodes": [],
  "freezeFrameCodes": [],
  "milOn": false,
  "dtcCount": 0,
  "readinessIncomplete": ["Catalyst"],
  "unavailable": [
    {
      "feature": "وحدة الوسائد الهوائية SRS",
      "reason": "غير متاحة عبر OBD-II العام في هذه النسخة.",
      "source": "application"
    }
  ],
  "dataCoverage": 0.75,
  "notes": "فحص أول عند الاتصال — قراءة فقط، بلا مسح أو برمجة."
}
```

**قواعد التحقق:**

| الحقل | القاعدة |
| --- | --- |
| `id` | فريد لكل مركبة؛ إعادة الإرسال تستبدل/تتجاهل بأمان |
| `status` | `completed` / `partial` / `failed` |
| `readOnly` | يجب أن يكون `true` لكل `firstConnection` و`dtcScan` و`freezeFrame` |
| `rawResponse` | يُحفظ كما ورد (مقصوصاً)، حد أقصى مقترح 64KB/سجل |
| `dataCoverage` | `0..1`، مشتقة من عدد الإشارات المتاحة لا من جودة التشخيص |
| `modules` | `reachable=false` مع سبب، لا حذف بصمت |
| `unavailable` | كل ميزة تعذّرت مع سبب واضح |

الخادم يرفض `400` إذا كان `readOnly` غير `true` في وضع فحص أولي، أو إذا
احتوى `rawRecords` أمراً تعديلياً (`DTCCLR`, `04`, برمجة، `AT` إعداد) في
مسار «فحص».

#### `GET /health/vehicles/{vehicleId}/scans?limit=100&offset=0&mode=&from=&to=`

- ترتيب افتراضي: `completedAt` تنازلياً.
- `rawRecords` قد تُختصر في القائمة؛ تُعاد كاملة عبر
  `GET /health/vehicles/{vehicleId}/scans/{scanId}`.

#### `GET /health/vehicles/{vehicleId}/scans/{scanId}`

- `200` مع الجلسة كاملة وكل الردود الخام، أو `404`.
- مناسب لعرض «لماذا صدر هذا الاستنتاج؟».

---

### 5.4 أكواد الأعطال وإطار التجميد

#### `POST /health/vehicles/{vehicleId}/dtcs/observations`

```json
{
  "scanId": "scan-01J8Z4M9",
  "codes": ["P0300", "P0420"],
  "observedAt": "2026-11-23T09:13:58.000Z",
  "source": "ecu",
  "ecu": "ECM",
  "protocol": "",
  "raw": "43 02 03 00 04 20",
  "freezeFrameCodes": ["P0300"],
  "state": "stored"
}
```

الاستجابة: قائمة السجل المحدث بالأكواد.

```json
{
  "status": true,
  "data": [
    {
      "code": "P0300",
      "status": "stored",
      "firstSeenAt": "2026-11-20T10:02:11.000Z",
      "lastSeenAt": "2026-11-23T09:13:58.000Z",
      "lastNotReportedAt": null,
      "occurrenceCount": 2,
      "scanCount": 2,
      "activeInLatestScan": true,
      "source": "ecu",
      "ecu": "ECM",
      "protocol": "",
      "raw": "43 02 03 00 04 20",
      "freezeFrame": true,
      "description": ""
    },
    {
      "code": "P0420",
      "status": "historical",
      "firstSeenAt": "2026-11-20T10:02:11.000Z",
      "lastSeenAt": "2026-11-20T10:02:11.000Z",
      "lastNotReportedAt": "2026-11-23T09:13:58.000Z",
      "occurrenceCount": 1,
      "scanCount": 1,
      "activeInLatestScan": false,
      "source": "ecu",
      "ecu": "ECM",
      "protocol": "",
      "raw": "",
      "freezeFrame": false,
      "description": ""
    }
  ]
}
```

**قواعد الدمج (إلزامية):**

1. مفتاح منع التكرار: `(vehicleId, scanId, code)`.
2. الكود الظاهر في الفحص: `activeInLatestScan=true`، `lastSeenAt=observedAt`،
   `occurrenceCount += 1`، `scanCount += 1`.
3. الكود الغائب عن فحص ناجح: `activeInLatestScan=false`،
   `lastNotReportedAt=observedAt`، ولا يُحذف.
4. `historical` تعني «لم يُبلَّغ في آخر فحص ناجح»، وليست حكماً بأن ECU
   نسي الكود أو أن العطل انتهى.
5. لا يُنشأ تاريخ أول مشاهدة قبل أول فحص فعلي.
6. `freezeFrame=true` إذا ظهر ضمن `freezeFrameCodes`.
7. فحص فاشل لا يغيّر حالة الأكواد النشطة.

#### `GET /health/vehicles/{vehicleId}/dtcs?active=true&state=&from=&to=`

- يرتب النشط أولاً ثم `lastSeenAt` تنازلياً.

#### `GET /health/vehicles/{vehicleId}/dtcs/{code}/history?limit=100`

```json
{
  "status": true,
  "data": {
    "code": "P0300",
    "observations": [
      {
        "scanId": "scan-01J8Z4M9",
        "observedAt": "2026-11-23T09:13:58.000Z",
        "source": "ecu",
        "state": "stored",
        "freezeFrame": true,
        "raw": "43 02 03 00 04 20"
      }
    ]
  }
}
```

#### إطار التجميد

يُحفظ داخل `DiagnosticScanSession.freezeFrameCodes` والردود الخام. يمكن
إضافة endpoint مخصص عند توفر بيانات PID إطار التجميد الفعلية:

`GET /health/vehicles/{vehicleId}/scans/{scanId}/freeze-frame`

**لا يُخترع إطار تجميد** إذا لم يرد به الجهاز؛ تُسجَّل الميزة في
`unavailable` مع السبب.

---

### 5.5 سلاسل زمنية للحساسات

#### `POST /health/vehicles/{vehicleId}/sensors`

```json
{
  "readings": [
    {
      "id": "read-01J8Z5A1",
      "key": "rpm",
      "label": "دورات المحرك",
      "value": 812,
      "unit": "RPM",
      "recordedAt": "2026-11-23T09:20:05.000Z",
      "source": "ecu",
      "pid": 12,
      "quality": "good",
      "scanId": null,
      "raw": "41 0C 1F 40"
    },
    {
      "id": "read-01J8Z5A2",
      "key": "battery_v",
      "label": "جهد البطارية",
      "value": 12.41,
      "unit": "V",
      "recordedAt": "2026-11-23T09:20:05.000Z",
      "source": "adapter",
      "pid": null,
      "quality": "good",
      "scanId": null,
      "raw": "12.41"
    }
  ]
}
```

**المفاتيح المعتمدة حالياً:**

`rpm`, `speed_kph`, `coolant_c`, `battery_v`, `stft_pct`, `ltft_pct`,
`throttle_pct`, `intake_air_c`, `maf_gps`, `fuel_level_pct`,
`engine_load_pct`, `control_voltage_v`, `oil_temp_c`.

**قواعد:**

- `value` رقم منتهٍ (`finite`)؛ لا NaN/Infinity.
- `source` يميّز قراءة ECU عن جهد جسر BATT.
- `quality`: `good` / `partial` / `unavailable` / `unknown`.
- الحد الأقصى 5,000 قراءة/دفعة، و512KB/طلب.
- الخادم يرفض القراءات المستقبلية أو الأقدم من سنة (`422`) إلا بعلامة
  استيراد صريحة.

#### `GET /health/vehicles/{vehicleId}/sensors`

| المعامل | الوصف |
| --- | --- |
| `key` | مفتاح واحد أو عدة مفاتيح مفصولة بفاصلة |
| `since`, `until` | ISO-8601 UTC |
| `limit` | حد أقصى 10,000 (افتراضي 2,000) |
| `order` | `asc` (افتراضي للسلاسل) أو `desc` |
| `bucket` | تجميع: `1m`, `5m`, `1h`, `1d` |
| `agg` | `avg`, `min`, `max`, `last` (افتراضي `avg`) |

مثال استجابة مجمّعة:

```json
{
  "status": true,
  "data": {
    "key": "coolant_c",
    "unit": "°C",
    "bucket": "1h",
    "agg": "avg",
    "points": [
      { "at": "2026-11-23T08:00:00.000Z", "value": 88.4, "count": 720 },
      { "at": "2026-11-23T09:00:00.000Z", "value": 90.1, "count": 700 }
    ]
  }
}
```

- التجميع لا يستوفي الفجوات ولا يخترع نقاطاً.
- `count` يوضح عدد القراءات الأصلية في الدلو.
- عند غياب بيانات كافية تُعاد `points: []` مع `unavailable` أو `null`.

#### `GET /health/vehicles/{vehicleId}/sensors/{key}/summary?days=30`

```json
{
  "status": true,
  "data": {
    "key": "battery_v",
    "unit": "V",
    "sampleCount": 240,
    "firstAt": "2026-10-24T09:00:00.000Z",
    "lastAt": "2026-11-23T09:00:00.000Z",
    "latest": 12.41,
    "min": 11.92,
    "max": 14.42,
    "mean": 12.63,
    "median": 12.58,
    "std": 0.42,
    "trend": {
      "slopePerDay": -0.021,
      "r2": 0.44,
      "spanDays": 30,
      "sampleCount": 240,
      "interpretation": "ميل هبوطي ضعيف — يحتاج تأكيداً باختبار حمل."
    }
  }
}
```

> `trend` إحصائي وصفي، وليس تنبؤاً بتاريخ فشل.

---

### 5.6 الخط الزمني الموحّد

#### `GET /health/vehicles/{vehicleId}/timeline?from=&to=&types=scan,dtc,reading,maintenance,assessment&limit=100`

```json
{
  "status": true,
  "data": {
    "events": [
      {
        "id": "evt-scan-01J8Z4M9",
        "type": "scan",
        "at": "2026-11-23T09:14:02.000Z",
        "title": "فحص الاتصال الأول",
        "summary": "3 ردود ECU، لا أكواد، MIL مطفأ",
        "source": "ecu",
        "refId": "scan-01J8Z4M9",
        "severity": "info"
      },
      {
        "id": "evt-maint-01J8Z6",
        "type": "maintenance",
        "at": "2026-11-22T18:00:00.000Z",
        "title": "استبدال حساس الأكسجين",
        "summary": "بانتظار التحقق بفحص لاحق",
        "source": "user",
        "refId": "maint-01J8Z6",
        "severity": "info"
      }
    ],
    "nextCursor": null
  }
}
```

- الخط الزمني للعرض، وليس مصدر حقيقة جديداً.
- كل حدث يشير إلى سجله الأصلي عبر `refId`.
- لا تُدرج أحداث لم تُسجَّل فعلاً.

---

### 5.7 الصيانة والإصلاح

#### `GET /health/vehicles/{vehicleId}/maintenance?limit=100`

#### `PUT /health/vehicles/{vehicleId}/maintenance/{recordId}`

```json
{
  "id": "maint-01J8Z6",
  "vehicleId": "vehicle:6b02ee4d2e55d25879378b67",
  "type": "repair",
  "title": "استبدال حساس الأكسجين",
  "description": "تم استبدال الحساس الأمامي بعد كود P0134.",
  "performedAt": "2026-11-22T18:00:00.000Z",
  "createdAt": "2026-11-22T18:05:00.000Z",
  "odometerKm": 84500,
  "partsReplaced": ["حساس أكسجين أمامي"],
  "workshop": "ورشة الاختبار",
  "notes": "",
  "scoreBefore": 72,
  "confidenceBefore": 0.54,
  "dtcCodesBefore": ["P0134"],
  "scanIdBefore": "scan-01J8Z3",
  "verification": null
}
```

- `type`: `repair` / `maintenance` / `inspection` / `partReplacement`.
- `dtcCodesBefore` تُلتقط من آخر فحص فعلي، أو `[]` مع توضيح.
- `scoreBefore` لا يُخترع؛ `null` إذا لم يكن هناك تقييم.

#### `DELETE /health/vehicles/{vehicleId}/maintenance/{recordId}`

- `204` أو `404`.

#### `POST /health/vehicles/{vehicleId}/maintenance/{recordId}/verify`

```json
{
  "scanId": "scan-01J8Z9",
  "verifiedAt": "2026-11-23T09:14:02.000Z"
}
```

الخادم يقارن الحالة الحالية بلقطة «قبل» ويعيد:

```json
{
  "status": true,
  "data": {
    "verifiedAt": "2026-11-23T09:14:02.000Z",
    "outcome": "improved",
    "scanId": "scan-01J8Z9",
    "scoreBefore": 72,
    "scoreAfter": 88,
    "confidenceAfter": 0.66,
    "resolvedCodes": ["P0134"],
    "persistingCodes": [],
    "newCodes": [],
    "notes": "التحقق يعتمد على بيانات هذا الجهاز وقد يتأثر بمسح الأكواد أو دورة القيادة."
  }
}
```

**`outcome`:**

| القيمة | الشرط |
| --- | --- |
| `improved` | اختفاء كود أو ارتفاع الدرجة > 1 |
| `unchanged` | لا تغيير جوهري |
| `worse` | كود جديد أو انخفاض الدرجة > 1 |
| `insufficientData` | لا تتوفر درجة/فحص قبل أو بعد |

التحقق لا يثبت السبب الجذري، ويجب أن يظل `notes` صريحاً بذلك.

---

### 5.8 التقييم الصحي (خادمي اختياري)

التطبيق يحسب التقييم محلياً حالياً. هذا القسم يحدد عقداً اختيارياً
للتحليل الخادمي عند الحاجة إلى مقارنة بين أجهزة/مركبات.

#### `POST /health/vehicles/{vehicleId}/assessments`

```json
{
  "generatedAt": "2026-11-23T09:15:00.000Z",
  "windowDays": 30,
  "includeMaintenance": true
}
```

الاستجابة (`201` أو `202` إن كانت غير متزامنة):

```json
{
  "status": true,
  "data": {
    "vehicleId": "vehicle:6b02ee4d2e55d25879378b67",
    "generatedAt": "2026-11-23T09:15:00.000Z",
    "overallScore": 84,
    "overallStatus": "attention",
    "overallConfidence": 0.58,
    "dataCoverage": 0.47,
    "scanCount": 4,
    "dtcCount": 1,
    "readingCount": 320,
    "machineLearningUsed": false,
    "methodology": "درجات قواعدية/إحصائية مع تغطية وثقة معلنة...",
    "limitations": [
      "غياب الكود لا يثبت سلامة الأنظمة غير المقروءة.",
      "لا تُقدَّر تواريخ فشل المكوّنات."
    ],
    "systems": [
      {
        "system": "engine",
        "score": 78,
        "status": "attention",
        "confidence": 0.62,
        "coverage": 0.55,
        "sampleCount": 120,
        "methodology": "أكواد المحرك النشطة + تعديل الوقود + RPM/الحمل.",
        "findings": [
          {
            "id": "dtc-active-P0300",
            "system": "engine",
            "kind": "rule",
            "severity": "high",
            "title": "كود عطل نشط: P0300",
            "explanation": "أبلغت وحدة التحكم عن الكود في آخر فحص ناجح.",
            "confidence": 0.96,
            "evidence": ["الكود: P0300", "المصدر: ECU (رد مباشر)"],
            "recommendedTests": ["فحص البوجيهات/ملفات الإشعال."],
            "relatedCodes": ["P0300"],
            "ruleId": "dtc-active"
          }
        ],
        "limitations": ["لا تُقاس قوة الاحتراق عبر OBD-II العام."]
      }
    ]
  }
}
```

**قواعد التقييم:**

- `overallScore` = `null` إن لم يوجد أي نظام قابل للتقييم.
- `dataCoverage` = نسبة الإشارات المتاحة من المتوقعة، وليست جودة السيارة.
- `confidence` = دالة تغطية/حجم عينة/حداثة، وليست احتمال عطل.
- الكود التاريخي لا يُخصم من الدرجة.
- `machineLearningUsed=false` حتى يُنشر نموذج مُتحقَّق.
- كل `finding` يحمل `evidence` و`ruleId`، وكل توصية تُصاغ كاختبار تأكيد.

#### `GET /health/vehicles/{vehicleId}/assessments/latest`

- يعيد آخر تقييم محفوظ، أو `404`.

---

### 5.9 واجهات تنبؤية (مستقبلية — feature-gated)

#### `GET /health/models`

```json
{
  "status": true,
  "data": [
    {
      "id": "battery_decline_v1",
      "version": "1.0.0",
      "status": "shadow",
      "target": "battery_decline_risk",
      "trainedAt": "2026-12-01T00:00:00.000Z",
      "trainingSamples": 12000,
      "vehicles": 1800,
      "metrics": {
        "auc": 0.81,
        "precision": 0.74,
        "recall": 0.69,
        "calibrationError": 0.05
      },
      "validatedFailDateEstimation": false,
      "limitations": [
        "لا يقدّر تاريخ فشل.",
        "أداء أقل على المركبات القديمة/البيانات المتقطعة."
      ]
    }
  ]
}
```

#### `POST /health/vehicles/{vehicleId}/predictions`

```json
{
  "modelId": "battery_decline_v1",
  "horizonDays": 60,
  "featuresWindowDays": 90
}
```

استجابة مسموحة فقط لنموذج `status=production` ومُتحقَّق:

```json
{
  "status": true,
  "data": {
    "modelId": "battery_decline_v1",
    "modelVersion": "1.0.0",
    "generatedAt": "2026-11-23T09:15:00.000Z",
    "risk": 0.23,
    "riskBand": "low",
    "confidence": 0.71,
    "explanation": "انخفاض تدريجي في جهد البطارية مع ثبات ظروف التشغيل.",
    "evidence": [
      "ميل -0.02 V/يوم خلال 30 يوماً (R²=0.44)",
      "8 قراءات جهد دون 12.3V أثناء التشغيل"
    ],
    "validatedFailureDate": null,
    "limitations": [
      "لا يمثل ضماناً؛ يلزم اختبار حمل.",
      "النموذج لم يُتحقق لتقدير تاريخ الفشل."
    ]
  }
}
```

**محظورات:**

- إرجاع `failureDate` أو `remainingLifeKm` دون نموذج مُتحقَّق ومعلن.
- استخدام بيانات مركبات أخرى دون إطار موافقة/إخفاء هوية.
- إخفاء الثقة أو التغطية أو القيود.
- تشغيل نموذج `shadow` كنتيجة نهائية للمستخدم.

#### `POST /health/predictions/{predictionId}/feedback`

```json
{
  "outcome": "confirmed",
  "observedAt": "2027-01-10T00:00:00.000Z",
  "notes": "تم استبدال البطارية بعد اختبار حمل فاشل."
}
```

- `confirmed` / `not_observed` / `unknown`.
- يُستخدم للتحقق المستقبلي، ولا يعدّل نتيجة سابقة.

---

### 5.10 التقارير والملفات الخام

#### `POST /health/vehicles/{vehicleId}/reports`

```json
{
  "type": "diagnostic",
  "format": "pdf",
  "from": "2026-10-01T00:00:00.000Z",
  "to": "2026-11-23T23:59:59.000Z",
  "includeRaw": false,
  "includeMaintenance": true
}
```

استجابة `202`:

```json
{
  "status": true,
  "data": {
    "reportId": "rep_01J8ZB",
    "status": "processing"
  }
}
```

#### `GET /health/reports/{reportId}`

```json
{
  "status": true,
  "data": {
    "reportId": "rep_01J8ZB",
    "status": "ready",
    "downloadUrl": "https://.../signed?expires=900",
    "expiresAt": "2026-11-23T09:30:00.000Z",
    "sha256": "9f2c...",
    "sizeBytes": 183442
  }
}
```

- روابط موقّعة قصيرة العمر، وليست عامة.
- التقرير لا يدّعي تشخيصاً نهائياً؛ يعرض المصادر والقيود.
- التقارير الكبيرة/الخام تُخزَّن في Object Storage.

#### `POST /health/vehicles/{vehicleId}/raw-uploads`

مخصص لملفات تشخيص كبيرة (logs BLE، لقطات مصنّعة) عند الحاجة:

```json
{
  "fileName": "adapter-log-2026-11-23.txt",
  "contentType": "text/plain",
  "sizeBytes": 48210,
  "sha256": "d1a2...",
  "containsVin": true
}
```

الاستجابة: `uploadUrl` موقّع + `uploadId`. بعد الرفع:

`POST /health/raw-uploads/{uploadId}/complete`

- تحقق من `sha256` والحجم.
- امسح/أخفِ VIN إن طُلب `redact=true`.
- اربط الملف بالجلسة/التقرير، ولا تعرضه علناً.

---

### 5.11 المزامنة والتشخيص

#### `GET /health/sync?since=2026-11-20T00:00:00.000Z`

يعيد تغييرات السجلات (profiles/scans/dtcs/readings/maintenance) بعد
الزمن المحدد مع `nextSince` و`deleted[]` — للمزامنة التدريجية.

#### `GET /health/healthz` (أو `/healthz` خارج `/api`)

```json
{
  "status": true,
  "data": {
    "service": "health-record",
    "version": "1.0.0",
    "database": "ok",
    "queue": "ok",
    "time": "2026-11-23T09:00:00.000Z"
  }
}
```

#### `GET /health/version`

يعيد `apiVersion` و`minSupportedAppVersion` و`features` (مثل
`serverAssessment`, `predictions`, `reports`) حتى يعرف العميل ما هو متاح.

---

## 6. عقد التحليل الخادمي (إن فُعّل)

### 6.1 المدخلات

- جلسات الفحص (مع `readOnly` و`dataCoverage`).
- سجل DTC مع تواريخ المشاهدة (لا تواريخ ECU).
- سلاسل الحساسات مع المصدر والجودة.
- سجل الصيانة والتحقق.
- ملف المركبة (اختياري، مع موافقة).

### 6.2 القواعد الدنيا

| النظام | إشارات مقبولة | ممنوع |
| --- | --- | --- |
| المحرك | أكواد P النشطة، STFT/LTFT، RPM، الحمل/MAF | استنتاج ضغط أسطوانات |
| البطارية/الكهرباء | جهد BATT/Control، أكواد U | ادعاء سعة البطارية بلا اختبار حمل |
| التبريد | حرارة التبريد/الزيت، أكواد P0128/P0217... | ادعاء انسداد رديتر يقيناً |
| الانبعاثات | MIL، I/M readiness، أكواد P04/P2A | اعتبار اختبار غير مكتمل عطلاً |
| الفرامل | أكواد C فقط | تقييم ABS بلا وحدة ABS |
| ناقل الحركة | أكواد TCM/P07... | تقييم انزلاق بلا بيانات مصنّعة |
| الهيكل | أكواد B فقط | تقييم SRS/BCM |

### 6.3 قواعد الثقة والتغطية

- كل نظام يعلن `expectedSignals` و`availableSignals`.
- `100%` تغطية مستحيلة عبر OBD-II العام؛ لا تعرض 100%.
- عند عينة أقل من 8 قراءات مستقرة لا يُصدر حكم شذوذ.
- الشذوذ يتطلب تكراراً (آخر 3 قراءات على الأقل)، لا قراءة واحدة.
- الاتجاه يتطلب `n ≥ 6` و`spanDays ≥ 2` و`R²` معلوماً.
- `confidence` ليست احتمال وجود عطل؛ تُسمّى «ثقة التقييم» وتُفسَّر.
- أي استنتاج آلي يحمل `ruleId` ثابتاً للإصدار والتدقيق.

---

## 7. الأمان والخصوصية والاحتفاظ

### 7.1 الأمان

| البند | المتطلب |
| --- | --- |
| النقل | HTTPS/TLS 1.2+، HSTS، رفض HTTP |
| التخزين | تشفير at-rest (KMS)، نسخ احتياطي مشفّر |
| المصادقة | OAuth2/OIDC أو JWT، MFA اختياري للمالك |
| الصلاحيات | RBAC: owner/viewer/workshop، عزل مستأجرين |
| الأسرار | Secret manager، تدوير دوري، لا أسرار في الكود |
| الحقول الحساسة | VIN/email/device id: تشفير أو tokenization |
| السجلات | لا VIN كامل ولا رموز/كلمات مرور؛ `requestId` للتدقيق |
| الحقن | ORM/استعلامات parameterized، تحقق schema |
| المعدل | Rate limit + quota لكل حساب/IP |
| الملفات | فحص نوع/حجم/hash، روابط موقّعة، منع تنفيذ |
| Webhooks | توقيع HMAC + replay protection (إن وجدت) |

### 7.2 الخصوصية

- موافقة صريحة على رفع VIN/بيانات التشخيص والتقارير.
- `analyticsOptIn` منفصل عن تشغيل الخدمة الأساسية.
- عدم بيع البيانات أو مشاركتها مع أطراف ثالثة بلا إفصاح.
- تقليل الجمع: لا GPS/موقع إلا إذا طلبه المستخدم لميزة محددة.
- إمكانية التصدير (JSON/CSV) والحذف الكامل.
- إخفاء VIN في التقارير المشتركة (آخر 4 محارف فقط) افتراضياً.

### 7.3 الاحتفاظ المقترح (قابل للتهيئة)

| البيانات | افتراضي | ملاحظات |
| --- | --- | --- |
| ملف المركبة | حتى الحذف | يُحذف مع الحساب/المركبة |
| جلسات الفحص + raw | 24 شهراً | raw الطويل 6 أشهر ثم ملخص |
| أكواد DTC | 36 شهراً | تاريخ المشاهدة فقط |
| قراءات الحساسات (خام) | 90 يوماً | ثم تجميع 5 دقائق/ساعة |
| قراءات مجمّعة | 5 سنوات | للاتجاهات |
| الصيانة | حتى الحذف | بيانات مستخدم |
| التقييمات | 24 شهراً | قابلة لإعادة الحساب |
| التنبؤات/التغذية الراجعة | 36 شهراً | للتحقق من النماذج |
| سجلات التدقيق | 12 شهراً | مجهولة الهوية حيث أمكن |
| نسخ احتياطي | 30 يوماً | حذف خلال دورة النسخ |

- الحذف النهائي يشمل الفهارس والنسخ حسب سياسة معلنة.
- التجميع لا يجب أن يسمح بإعادة تعريف مركبة/شخص.

---

## 8. البيئة والنشر

### 8.1 متغيرات البيئة

```env
NODE_ENV=production
PORT=8080
PUBLIC_BASE_URL=https://backend-obd.onrender.com/api

DATABASE_URL=postgres://...
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20
TIMESERIES_URL=postgres://...   # TimescaleDB أو ClickHouse
REDIS_URL=redis://...

JWT_ISSUER=https://backend-obd.onrender.com
JWT_AUDIENCE=drive_scope
JWT_ACCESS_TTL=1800
JWT_REFRESH_TTL=2592000
JWT_SECRET=<secret-manager>

STORAGE_ENDPOINT=https://...
STORAGE_BUCKET=drive-scope-reports
STORAGE_ACCESS_KEY=<secret>
STORAGE_SECRET_KEY=<secret>
STORAGE_SIGNED_TTL=900

CORS_ORIGINS=https://app.example
RATE_LIMIT_PER_MINUTE=60
MAX_BATCH_READINGS=5000
MAX_RAW_RECORD_BYTES=65536

FEATURE_SERVER_ASSESSMENT=false
FEATURE_PREDICTIONS=false
FEATURE_REPORTS=true
PREDICTION_MODEL_ALLOWLIST=
SENTRY_DSN=
LOG_LEVEL=info
```

### 8.2 الفهارس الموصى بها

```sql
-- ملفات
CREATE UNIQUE INDEX ux_vehicle_profile ON vehicle_profiles(account_id, vehicle_key);
CREATE INDEX ix_vehicle_profile_vin ON vehicle_profiles(account_id, vin) WHERE vin IS NOT NULL;

-- جلسات
CREATE UNIQUE INDEX ux_scan ON scans(vehicle_key, scan_id);
CREATE INDEX ix_scan_time ON scans(vehicle_key, completed_at DESC);

-- أكواد
CREATE UNIQUE INDEX ux_dtc ON dtc_records(vehicle_key, code);
CREATE UNIQUE INDEX ux_dtc_observation ON dtc_observations(vehicle_key, scan_id, code);
CREATE INDEX ix_dtc_active ON dtc_records(vehicle_key, active_in_latest_scan, last_seen_at DESC);

-- قراءات (Timescale hypertable)
CREATE INDEX ix_reading_series ON sensor_readings(vehicle_key, sensor_key, recorded_at DESC);
CREATE UNIQUE INDEX ux_reading_id ON sensor_readings(vehicle_key, reading_id);

-- صيانة/تقييم
CREATE INDEX ix_maintenance_time ON maintenance_records(vehicle_key, performed_at DESC);
CREATE INDEX ix_assessment_time ON assessments(vehicle_key, generated_at DESC);
```

### 8.3 التشغيل والمراقبة

- Health/readiness probes منفصلة.
- Structured logs + `requestId` + `accountId` مجهول.
- مقاييس: معدل الطلبات، p95/p99، أخطاء 5xx، حجم الدفعات، تأخر الطابور،
  نسبة التقييمات بلا درجة، نسبة التنبؤات المرفوضة.
- تنبيهات: فشل قاعدة البيانات، تراكم dead-letter، انخفاض نسبة نجاح
  المزامنة، شذوذ في الحجم/المعدل.
- نسخ احتياطي يومي + اختبار استعادة دوري.
- migrations آلية مع تراجع، ونشر canary للتحليلات.
- حدود أجهزة الهاتف: دعم إعادة المحاولة، backoff، مزامنة عند Wi-Fi فقط
  (اختياري للمستخدم).

---

## 9. قائمة التحقق قبل الربط (Pre-Integration Checklist)

### 9.1 العقد

- [ ] نشر `/api/health/*` مع غلاف `{status,data,messages}`.
- [ ] مطابقة أسماء الحقول والقيم العددية في `lib/models/vehicle_health.dart`.
- [ ] اختبار `GET profile` مع `404` كـ «غير موجود» لا خطأ.
- [ ] اختبار `POST scans` بقيمة `readOnly=false` → `400`.
- [ ] اختبار دمج DTC عبر إعادة إرسال نفس `scanId` (idempotent).
- [ ] اختبار `migrate` مع دمج بلا تكرار عدّادات.
- [ ] اختبار `DELETE vehicle` يعيد `204`/`404` ويحذف كل السجلات.
- [ ] اختبار دفعات `sensors` (حد أقصى، تحقق، ترتيب زمني).
- [ ] اختبار الاستجابة البطيئة/المنقطعة وإعادة المحاولة.
- [ ] اختبار رسائل الخطأ العربية/الإنجليزية و`code` ثابت.

### 9.2 الأمان

- [ ] HTTPS فقط، شهادة صالحة، HSTS.
- [ ] JWT صالح/منتهٍ/مزيّف → 401.
- [ ] عزل الحسابات: مستخدم لا يقرأ `vehicleId` آخر → 403/404.
- [ ] لا VIN/رموز في logs.
- [ ] Rate limit وحد أقصى للحجم يعملان.
- [ ] روابط التقرير موقّعة وتنتهي.
- [ ] حذف/تصدير البيانات يعملان وموثقان.
- [ ] سياسة احتفاظ مطبقة فعلياً (job).

### 9.3 التطبيق

- [ ] تفعيل `RemoteHealthRecordRepository` بحقن في `AppController`
      (لا تغيير في الواجهة أو محرك التحليل).
- [ ] تخزين الرمز بشكل آمن (`flutter_secure_storage` مطلوب قبل الإنتاج).
- [ ] مزامنة تدريجية مع `since` و`nextSince`.
- [ ] فصل التعارض: نسخة الخادم مقابل المحلية مع حل واضح.
- [ ] إظهار حالة «غير متصل» وعدم حجب العمل المحلي.
- [ ] إضافة مفاتيح i18n للرسائل الجديدة (العربية أولاً).
- [ ] تشغيل `flutter analyze` و`flutter test` بلا أخطاء.
- [ ] اختبار يدوي على جهاز حقيقي مع محول OBD.

### 9.4 التحليلات والتنبؤ

- [ ] نشر `assessments` مع `methodology` و`limitations` إلزامية.
- [ ] منع `failureDate` قبل `validatedFailDateEstimation=true`.
- [ ] تسجيل `modelId`/`modelVersion`/`ruleId` لكل نتيجة.
- [ ] جمع feedback للتحقق، وعدم تعديل النتائج السابقة بأثر رجعي.
- [ ] تقييم انحياز البيانات (طراز/سنة/مناخ/نمط قيادة).

---

## 10. الخدمات الخارجية والتراخيص

### 10.1 التطبيق الحالي

| الحزمة | الاستخدام | الترخيص |
| --- | --- | --- |
| Flutter SDK | إطار التطبيق | BSD-3-Clause |
| `flutter_blue_plus` 2.3.12 | BLE | BSD-3-Clause (راجع الحزمة) |
| `shared_preferences` 2.5.3 | تخزين محلي | BSD-3-Clause |
| `http` ^1.2.0 | HTTP | BSD-3-Clause |
| `intl` 0.20.2 | تنسيق التواريخ/الأرقام | BSD-3-Clause |
| `permission_handler` ^12.0.1 | أذونات | MIT |
| `pdf` ^3.13.1 | توليد PDF | Apache-2.0 |
| `printing` ^5.15.1 | معاينة/طباعة | Apache-2.0 |
| `cupertino_icons` 1.0.8 | أيقونات | MIT |
| خطوط `assets/fonts/` | عرض عربي | راجع ترخيص كل خط قبل التوزيع |

> يجب مراجعة ملفات `LICENSE` المرفقة بكل حزمة قبل النشر التجاري،
> وإضافة إشعارات الترخيص إلى شاشة «حول التطبيق».



## 11. القيود المعلنة والمخاطر المتبقية

| القيد | الأثر | التخفيف |
| --- | --- | --- |
| نقاط `/api/health/*` غير منشورة | التطبيق محلي فقط | مستودع محلي افتراضي + عميل HTTP جاهز |
| لا توجد بيانات تدريب | لا ML ولا تواريخ فشل | قواعد/إحصاء فقط، `machineLearningUsed=false` |
| OBD-II عام محدود | ABS/SRS/BCM/TPMS غير مقروءة | `unavailable` مع سبب، لا ادعاء سلامة |
| Mode 03 لا يميّز Pending/Confirmed | حالة `stored` فقط | توضيح في الجلسة/الواجهة |
| أول مشاهدة = أول فحص للتطبيق | ليست تاريخ العطل الحقيقي | تسمية صريحة في السجل والتقرير |
| جهد BATT من الجسر | قد لا يكون قراءة ECU | `source=adapter` |
| القراءة المفردة قد تكون ضجيجاً | إنذارات كاذبة | كشف تكرار، عتبات، توصيات تأكيد |
| تكلفة تخزين السلاسل | نمو كبير | تجميع/احتفاظ/ضغط |
| VIN بيانات شخصية محتملة | خصوصية | تقليل/تشفير/إخفاء في المشاركة |
| الاعتماد على Render/شبكة | انقطاع | إعادة محاولة، عمل محلي، مزامنة لاحقة |

---

## 12. ملحق: أمثلة أخطاء

### 12.1 طلب فحص غير قراءة فقط

```json
{
  "status": false,
  "messages": [
    {
      "code": "READ_ONLY_VIOLATION",
      "message": "جلسات الفحص الأولي يجب أن تكون readOnly=true.",
      "field": "readOnly"
    }
  ],
  "requestId": "req_01J8ZC"
}
```

### 12.2 قراءة غير صالحة

```json
{
  "status": false,
  "messages": [
    {
      "code": "INVALID_READING",
      "message": "قيمة الحساس يجب أن تكون رقماً منتهياً.",
      "field": "readings[3].value"
    }
  ]
}
```

### 12.3 تعارض إصدار

```json
{
  "status": false,
  "messages": [
    {
      "code": "VERSION_CONFLICT",
      "message": "عُدّل السجل على جهاز آخر. أعد المزامنة قبل الحفظ.",
      "field": "updatedAt"
    }
  ]
}
```

---

## 13. ملخص التسليم

- **هذه الوثيقة عقد تصميم، وليست إثبات تنفيذ خادم.**
- التطبيق يطبّق السجل الصحي محلياً بشكل كامل ودائم، ويحسب التقييم
  بقواعد/إحصاء قابل للتفسير.
- `RemoteHealthRecordRepository` يطابق المسارات الأساسية أعلاه، لكنه
  **غير مربوط افتراضياً** حتى تُنشر الخدمة وتُختبر.
- لا تعلن أي واجهة أو تقرير أن التنبؤات أو التعلّم الآلي مطبّقان؛
  `machineLearningUsed=false` و`validatedFailureDate=null` حتى يوجد
  نموذج مُتحقَّق.
