# Stabilization Plan — Project / Delivery Estimation / Proforma Invoice / Working-Time

## Context

`mezidwood` (Express + Prisma + MySQL) and `mezwoodfront` (Next.js 16 App Router) implement a
furniture-manufacturing workflow: a **Proforma Invoice** is quoted, a **Delivery Estimation**
prices the calendar promise, and an approved estimate becomes a **Project** whose stages
(DESIGN → PURCHASING → CUTTING → CNC → EDGE_BANDING → ASSEMBLY → PAINTING → FINISHING →
DELIVERY → INSTALLATION) are scheduled against per-stage daily capacity, working hours,
working days and holidays.

A full audit — every route, controller and service in these domains, plus the scheduling
engine and the Prisma schema — found the system is **not currently functional end to end**.
The defects are not cosmetic: request validation is globally inert, several core endpoints
throw on every call, invoice deletion destroys data with no transaction, the capacity ledger
drifts permanently negative, financial endpoints are publicly readable without auth, and the
entire working-time configuration is unreachable through the API.

**Goal:** make these four flows correct, safe and complete — create, read, update, delete,
estimate, schedule and reschedule — with consistent contracts the frontend can rely on.

**Decisions taken:** schema may be reshaped freely (dev/staging DB, migrations may be reset);
scope is the four named domains **plus the shared infrastructure they depend on**; response
envelopes stay as they are (fix broken pagination math and error formats only — no mass
renaming of payload keys); the corrupt capacity ledger gets a rebuild script; verification is
manual end-to-end walkthrough (no new automated test suite).

---

## Severity summary

| # | Defect | Where | Effect |
|---|---|---|---|
| 1 | `validate` calls `next()` twice | `src/middlewares/validate.js:16` | **All** request validation is inert; invalid bodies reach controllers |
| 2 | `deleteProformaInvoice` — 6 deletes, no transaction, ignores linked project | `ProformaInvoice.service.js:2751-2929` | Deletes items/images/files, then fails on FK → **irrecoverable data loss** |
| 3 | Work-log completion double-releases capacity incl. past days | `ProjectStageWorkLog.service.js:194-239` | Capacity ledger drifts negative; future projects overbook worked days |
| 4 | `PUT /api/projects/:id` queries non-existent fields | `Project.service.js:704-724` | Project update **always** 500s |
| 5 | Working-time settings dropped by controller allowlist | `SchedulingSettings.controller.js:17-23` + `settings.js:122` | Working hours/days/shift/timezone **cannot be configured at all** |
| 6 | Public financial endpoints | `Sell.route.js:81`, `ProformaInvoice.route.js:71`, `Project.route.js:27` | Payments, prices, balances readable unauthenticated |
| 7 | `errorConverter` operator precedence | `middlewares/error.js:9-13` | Every error with a `statusCode` becomes 400 |
| 8 | `deleteProject` orphans estimation + invoice status | `Project.service.js:732-825` | Estimate stuck `PROJECT_CREATED`, can never be reconverted |
| 9 | `ApiError` not imported | `DeliveryEstimation.controller.js:396,403` | `ReferenceError` → 500 instead of 400 |
| 10 | No cron; `src/lib/corn.js` is 0 bytes | `src/index.js:9,41` | Estimate expiry piggybacks on GET handlers and races |
| 11 | Server components send no auth token | `DeliveryEstimation/view-page.tsx:43` +4 | Detail pages 401 / render blank forms |
| 12 | Client re-slices an already-paginated page | `Project/listing.tsx:346` +2 | **Page 2+ of every main list is empty** |
| 13 | Estimate→project conversion modal never opened | `DeliveryEstimation/tables/cell-action.tsx:46` | The core business flow is unreachable in the UI |
| 14 | `const canEdit = true` | `features/Project/modal.tsx:211` | Stage add/edit/delete open to every user |
| 15 | `response.data.id` on a `{success, project}` response | `features/Project/form.tsx:174` | TypeError on every successful project create |

---

## Phase 0 — Shared infrastructure (blocks everything else)

These are small, high-leverage fixes. Do them first; several later phases are untestable until
they land.

**`src/middlewares/validate.js`** — add the missing `return`, and write the coerced value back
so Joi `.default()`s reach the service:
```js
const { value, error } = joi.compile(schema).prefs({ errors: { label: 'key' }, abortEarly: false }).validate(object);
if (error) return next(new ApiError(400, error.details.map((d) => d.message).join(', ')));
Object.assign(req, value);
return next();
```

**`src/middlewares/error.js`** — fix precedence (`(a || b) ? …` was intended as `a ?? (b ? … : …)`),
drop the `mongoose` import (Prisma-only project), and map Prisma error codes:
`P2002 → 409`, `P2003 → 409`, `P2025 → 404`, `P2011 → 400`, `PrismaClientValidationError → 400`.

**`src/loaders/express.js`** — use the already-computed `config.cors.allowedOrigins` instead of
the hardcoded list, and strip the trailing slash from `https://rcf.ordere.net/` (an `Origin`
header never has one, so production CORS currently fails). Add `express.urlencoded`.

**`src/config/config.js`** — env validation error is logged but not thrown; the server boots with
a missing `JWT_SECRET`. Throw in non-development.

**`src/index.js`** — `unhandledRejection → exitHandler` kills the process on any escaped promise
(e.g. the fire-and-forget reschedule at `ProformaInvoice.service.js:107`). Log and keep serving;
reserve exit for `uncaughtException`.

**Response contract — minimal-touch.** Existing payload keys stay (`project`, `invoice`,
`proformaInvoice`, `sells`, `data`, …) so no frontend call site breaks. Fix only what is
*wrong* rather than merely inconsistent:

- **Pagination totals.** `getAllProjects` (`Project.service.js:961-968`) reports
  `total: projects.length` — always ≤ `limit` — while `totalPages` in the same object uses the
  real DB count. Return the true total everywhere. Ditto the frontend's `count: invoices.length`
  (`service/ProformaInvoice.ts:69,109`).
- **One error shape.** Controllers currently early-return `{success:false, error:'…'}` (a string)
  or `{success:false, message, error}`, while the global handler emits `{error:true, code, message}`
  (a boolean) — no single field tells a client that a request failed. Make every failure path
  throw `ApiError` and let the global handler own the shape; add `success:false` to it so both
  conventions read correctly.
- **Stop returning 200 on failure.** `getAllProjects` (`:969-980`), `getAllProjectBystatus`
  (`:1050`) and `getCustomersWithFallback` (`:371`) catch everything into an empty **200** with an
  `error` field nobody reads. Let them throw.

---

## Phase 1 — Schema corrections

One migration, `fix_referential_integrity_and_money_types`. Schema reshaping was approved, so
fix the modelling defects rather than working around them.

- **Real FK between Project and DeliveryEstimation.** `DeliveryEstimation.projectId` and
  `Project.deliveryEstimationcode` are bare unindexed strings with no relation — nothing stops
  an estimation being deleted out from under a live project. Add a proper relation + index.
- **`onDelete` cascades:** `ProjectStageWorkLog.projectStage` (currently RESTRICT — makes
  `Project.service.js:2736` throw despite its "cascade will handle this" comment) and
  `ProjectStage.project`.
- **`Showroom.isMain` / `Store.isMain`** are `Boolean @default(false) @unique` — a UNIQUE index
  on a non-null boolean caps the table at **two rows**. Drop the unique; enforce single-main in
  application code.
- **Money → `Decimal @db.Decimal(12,2)`** across `ProformaInvoice.subtotal/vat/total/amountPaid/balance`,
  `ProformaInvoiceBank.amount`, `Sell.*`, `Purchase.*`. Note `Sell.balance`/`totalPaid` are `Int`
  while `grandTotal` is `Float` — cents are currently truncated or rejected.
- **Indexes:** `ProjectStage` has none at all, yet `Project.service.js:2110` runs a `count` per day
  of a range. Add `@@index([stage, startDate, endDate])`, `@@index([projectId, stage])`;
  `DailyStageCapacity @@index([date])`; `DeliveryEstimation @@index([status])`, `([piId])`.
- **`Notification`** has no `userId` column, yet `notification.service.js` writes one and queries
  it; the service also references `prisma.lease` and `prisma.maintenanceRequest`, models that do
  not exist. Either add `userId` + relation and fix the service, or delete the dead service.
- **`ProformaItemMaterial`** has a nonsensical self-relation (`materials ProformaItemMaterial[]`)
  where the comment intends `Material`.
- **`ProjectStage.endDate`** is NOT NULL but `ProjectStageWorkLog.service.js:781` writes `null` on
  revert → `P2011`. Make it nullable.

---

## Phase 2 — Working-time & scheduling engine

This is the subsystem the whole delivery promise rests on, and it is the most broken.

### 2a. Make working-time configurable at all
`SchedulingSettings.controller.js:17-23` allowlists five fields, none of which are the working-time
ones the route's own Joi schema (`project.validation.js:172-186`) accepts — `workingDays`,
`shiftStartHour`, `shiftEndHour`, `lunchStartHour`, `lunchEndHour`, `timezone` are all silently
dropped. The one field that does get through, `workingHoursPerDay`, is then deleted by
`settings.js:122`. A request returns `200 "Scheduling settings updated"` having changed nothing.
Align the allowlist with the Joi schema and stop stripping in the service.

### 2b. Timezone correctness (the root of ~12 separate bugs)
`engine.js:48` builds day keys as UTC midnight (`${dateKey}T00:00:00.000Z`) while `calendar.js:330`
formats them in the configured business timezone. These agree **only** for positive UTC offsets —
the current default `Africa/Addis_Ababa` (UTC+3) masks the bug. Every `toISOString().slice(0,10)`
in `reschedule.js` (lines 362, 1013, 1025, 1066, 1071, 1081, 1130, 1136, 1220, 1230, 1236) and
`ProjectStageWorkLog.service.js:195` has the same fault.

Fix: one shared helper pair in `calendar.js` — `businessDayKey(date)` and `dayKeyToInstant(key)` —
both timezone-aware, and replace every ad-hoc UTC slice with them. Align `loadExistingUsage`
(`engine.js:629`) to use the same boundary so today's usage is never invisible to the allocator.

### 2c. Capacity ledger integrity
- **Double release (worst offender).** `ProjectStageWorkLog.service.js:194-239` decrements *every*
  allocation on completion with no `releaseFrom` cutoff, then deletes them — then
  `reschedule.onStageCompleted` runs and finds nothing to release. `reschedule.js:210-213`
  documents the correct contract: past days stay consumed, future days are freed. Delete the
  work-log's release block and let `releaseStageCapacity` own it.
- **Clamp at zero.** `reschedule.js:229-246`, `:322-328` and the work-log path use bare
  `{ decrement }`. Guard against negative `usedCapacity`/`usedHours`.
- **`upsert` instead of check-then-create.** `engine.js:685-731` and `Project.service.js:110-138`
  both do `findUnique` → `if/else` on `@@unique([stage,date])`; concurrent first-writes collide
  with `P2002`.
- **DELIVERY orphan.** `rescheduleWholeProject` releases DELIVERY's capacity (`reschedule.js:528`)
  then `continue`s past both the update and `persistStageAllocations` (`:560`), while the commit
  run already incremented `usedCapacity` — leaving counted capacity with no allocation rows
  backing it, permanently unreleasable. Exclude DELIVERY from the release too, or re-persist.
- **Silent drops.** `persistStageAllocations` (`reschedule.js:273`) and `Project.service.js:471`
  `continue` when the daily row is missing. Upsert it instead of dropping.
- **Move the cascade inside the transaction.** `ProjectStageWorkLog.service.js:636-649` runs
  `onStageCompleted` after commit and swallows failure to `console.error`, leaving downstream
  dates permanently stale.
- **Concurrency.** `scheduleProject` reads capacity with a non-locking snapshot and writes deltas
  later; two concurrent project creations both fit into the same free slots. Serialize commits on
  a stage-level advisory lock (`SELECT … FOR UPDATE` on the `DailyStageCapacity` rows in range).

### 2d. Configurable working week
`reschedule.js:1242-1252` hardcodes Saturday as end-of-week and Sunday as the non-working day,
defeating `config.js:78-102 parseWorkingDays`. Derive from settings.

### 2e. Capacity lot config that is read but ignored
`engine.js:609-623` reads only `capacity` and `parallelSlots`; `CapacityLot.days` (required, validated,
shown in reports) and `workingHours` are dead — making `engine.js:682`'s `cfg.workingHours` fallback
unreachable. Either wire them in or remove them from the model and UI. Also: editing a lot
(`CapacityLot.service.js:172`) triggers no revalidation, so halving capacity leaves already-planned
days silently over 100%. And `CapacityLot.service.js:112-117` mass-assigns any sanitized key —
whitelist it, as `DeliveryEstimation.service.js:486-500` already does.

### 2f. Ledger rebuild script
The code fixes above stop *new* corruption; existing rows are already wrong. Add
`prisma/rebuild-capacity-ledger.js` (runnable via `npm run capacity:rebuild`) that, per
`(stage, businessDay)`, recomputes `DailyStageCapacity.usedCapacity` / `usedHours` as the sum of
its `ProjectStageCapacityAllocation` rows, deletes allocations whose `ProjectStage` no longer
exists, drops daily rows that end up with no allocations, and prints a before/after diff.
`reschedule.js:60-63` already states this invariant — the script enforces it. Keep it as a
permanent repair tool, and reuse its logic for the `POST /daily-stage-capacities/rebuild`
endpoint the frontend already calls (`service/Category.ts:158`).

### 2g. Cron
`src/lib/corn.js` is empty and both call sites are commented out (`src/index.js:9,41`), despite
`node-cron` being a dependency and `ScheduleTrigger.CRON` existing in the schema. Implement it for
(a) `expireOldEstimations` — currently piggy-backed onto GET handlers, where two concurrent list
requests race on the same `updateMany` — and (b) nightly `compactCurrentWeek`, which today has no
reachable caller. Note `compactCurrentWeek` (`reschedule.js:1273`) does an unbounded `findMany` of
every unfinished project with nested allocations inside a 30 s transaction; it needs batching before
it can be scheduled.

---

## Phase 3 — Delivery Estimation

The core algorithm (`engine.js:443-602`: phase-by-phase allocation, inclusive working-day count,
`bufferDays = ceil(days × difficulty%) + contingency`) is **correct**. The defects are around it.

- **`ApiError` is not imported** in `DeliveryEstimation.controller.js` (used at `:396`, `:403`) →
  `ReferenceError` → 500 on any request missing `deliveryEstimationCode`/`proformaInvoiceId`.
- **A quote reserves nothing.** `mode:'dryRun'` never calls `flushUsage`, so N concurrent quotes
  all promise the same date and the first project consumes it. Add a soft reservation (a
  provisional allocation released on expiry) or, at minimum, re-validate the date at conversion
  time and surface the drift to the operator before committing.
- **The estimate is frozen at quote time** — `DeliveryEstimation.service.js:378` passes no
  `startDate`, so `engine.js:757` defaults to `new Date()`. Editing a 3-week-old quote silently
  jumps the promise forward. Recompute on read (or stamp and warn when stale).
- **Conversion discards the quote.** `createProjectFromDeliveryEstimation` (`:1060-1070`) passes
  `requestedDelivery: null`, skipping `createProject`'s back-scheduling branch
  (`Project.service.js:360-374`). Pass the quoted date.
- **`ON_HOLD` with no `holdUntil`** is permitted (`project.validation.js:115`) and is then invisible
  to the expiry sweep — on hold forever. Require `holdUntil` when status is `ON_HOLD`.
- **`updateDeliveryEstimation` whitelist** (`:494-500`) omits `PURCHASING`/`INSTALLATION` (not in
  `CAPACITY_STAGES`) yet lines 529-530 write them anyway; `piId` can never be corrected.
- **Zero-quantity update** yields `estimatedDays: 0`, which trips a guard complaining about a value
  the client never sent (`:550-557`).
- **`generateUniqueCode`** (`:41-57`) orders lexicographically — `DE-260813-1000` sorts below
  `DE-260813-999`, so the 1000th quote of a day restarts the sequence and burns all 5 retries.
- **Missing `GET /api/delivery-estimations/code/:code`** — the conversion flow is keyed by `code`
  (`Project.service.js:254`) but the API only exposes lookup by `id`.
- **Permission gaps:** `PATCH /:id`, `/:id/status`, `/:id/hold`, `/:id/confirm` and
  `POST /create-project` all have `checkPermission` commented out — `DELETE` is guarded while
  *converting an estimate into a live project* is not. `POST /admin/expire-old` is labelled admin
  with the admin middleware commented out.

---

## Phase 4 — Project & Proforma Invoice CRUD

### 4a. Project — endpoints that never work
- `Project.service.js:704-724` (`updateProject`) and `:1236-1254` (`getProjectsByCustomerId`) query
  `stages.orderBy.order`, `User.firstName/lastName`, `invoice.invoiceNumber`, `invoice.totalAmount`
  — **none of these fields exist**. Correct names are `stage`, `name`, `piNumber`, `total`, and
  `Project.service.js:854` already carries the fix as a comment. Both endpoints 500 on every call.
- `Project.controller.js:151` reads `result.pagination.total` from `getAllProjects`, which returns a
  flat shape with no `pagination` — `searchProjects` always 500s.
- `getAllProjects` (`:961-968`) reports `total: projects.length` (≤ `limit`) while `totalPages` uses
  the real count — the two contradict each other in the same object, so pagination cannot work.
- `getAllProjects` (`:969-980`) catches all errors into an empty **200**; an unvalidated `sortBy`
  injected raw into `orderBy` (`:904`) silently yields an empty project list instead of an error.
  Same pattern in `getAllProjectBystatus` and `getCustomersWithFallback`.

### 4b. Project — status vocabulary
Three mutually incompatible lists exist and **none** matches the schema. `Project.service.js:606-613`
allows `PENDING/IN_PROGRESS/ON_HOLD/COMPLETED/CANCELLED/DELIVERED` — four of which are not in
`ProjectStatus` — while rejecting every real value (`DESIGN`, `CUTTING`, `INSTALLATION`, …).
`:1270-1283` uses a different list again, and `validDifficulties` (`:621`) includes `EXPERT`, absent
from `DifficultyLevel`. Delete all hand-rolled lists; validate against the Prisma enum
(`config.js:307 VALID_DIFFICULTIES` is already correct and used elsewhere).

### 4c. Project — update semantics
- **Mass assignment** (`:591-601`): everything not in `['id','createdAt','updatedAt','stages']` is
  written through, letting a client overwrite `calculatedDelivery`, `scheduleMode`, `invoiceId`,
  `createdById`. Replace with an explicit allowlist.
- **No recompute on update.** Changing `difficulty` — which drives the delivery buffer — leaves
  `calculatedDelivery` stale. Trigger `recomputeProjectDelivery` when difficulty, quantities or
  requested delivery change.
- **`deleteProject`** (`:732-825`) has no counterpart to the creation-time writes at `:436-455`:
  the estimation stays `PROJECT_CREATED` pointing at a dead `projectId` (so it can never be
  reconverted — `:263` throws `CONFLICT`) and the invoice stays `APPROVED_CREATE_PROJECT`. The
  return value even advertises this (`invoiceKept`). Reset both inside the existing transaction.

### 4d. Proforma Invoice — the data-loss bug
`ProformaInvoice.service.js:2751-2929` runs six `deleteMany` calls plus physical file deletion on
the global `prisma` client — **no transaction** — and fetches the linked `project` at `:2773` only
to never check it. Since `Project.invoiceId` is a required unique FK, deleting an invoice that has
a project destroys every line item, price, image and attachment (and the files on disk) and *then*
fails with `P2003` on the final delete. Nothing rolls back.

Fix: wrap in `prisma.$transaction` (the pattern is already correct at `Project.service.js:753`),
check the project relation up front and return **409** with a clear message, and defer file
deletion until after the transaction commits.

### 4e. Proforma Invoice — payments
- **Lost update:** `:3466-3477` reads `amountPaid` and computes the new balance *before* opening
  the transaction at `:3523`. Two concurrent payments both read the old value; one vanishes from
  the totals while its bank row survives, so ledger and invoice disagree. `addSellPayment`
  (`Sell.service.js:809-834`) has the identical race. Move the read inside the transaction and
  recompute from the payment rows.
- **Overpayment allowed**, producing a negative balance (the Sell path checks; this one doesn't).
- **Float equality without epsilon** (`newBalance <= 0`, `newTotalPaid === 0`) leaves an exactly
  settled invoice `PARTIAL` forever; the Sell path uses `<= 0.001`. Resolved by the `Decimal`
  migration in Phase 1, plus explicit comparison helpers.
- **`:3531`** `amountDate: amountDate ? new Date(amountDate) : null` — a second payment without a
  date erases the first payment's date.
- **`:3576-3609`** swallows a failed `proformaInvoiceBank.create` ("continue even if bank linking
  fails") *inside* the transaction, committing `amountPaid` against no payment record. Rethrow.
- **`updateProformaInvoiceStatus`** accepts any string into the `PIStatus` enum column (raw 500,
  not 400) and writes its audit log outside a transaction.

### 4f. Proforma Invoice — duplicate endpoints
`PUT /api/proforma-invoices/:id` and `PUT /api/proforma-invoices/secondupdate/:id` have
byte-identical 30-line controllers (`:105-204` vs `:205-304`) differing only in the service call.
Determine which the frontend's `second/[id]` page uses, merge into one endpoint with an explicit
mode flag, and keep the old path as an alias until the frontend is updated.

### 4g. Auth & permissions
- **Unauthenticated entirely:** `GET /api/sells/:sellId/payments` (full payment history, bank refs,
  balances), `GET /api/proforma-invoices/:id` (full invoice with prices and customer — while the
  neighbouring list route requires `VIEW_ALL_PROFORMA`), `GET /api/sells/:id`,
  `GET /api/sells/invoice/:invoiceNo`, `GET /api/sells/not-approved/store`,
  `GET /api/projects/By/status`, `GET /api/capacity-slots`, `GET /api/left-work`.
- **Authenticated but unauthorised (14 endpoints)**, including `DELETE /api/projects/stage/delete/specific`,
  `POST /api/proforma-invoices/:id/payments` (permission commented out), and
  `PATCH /api/sells/:id/unlock` — which exists precisely to bypass the edit/delete lock.
- **`GET /api/sells/statistics` is unreachable**, shadowed by `/api/sells/:id` registered 65 lines
  earlier (`Sell.route.js:47` vs `:112`). Move static paths above parameterised ones — audit all
  five route files for this.
- **Permission naming is inconsistent** (`VIEW_PROJECTS`/`VIEW_PROJECT`, `VIEW_ALL_SELLS`/`VIEW_SELL`,
  `VIEW_ALL_PROFORMA`/`VIEW_PROFORMA`), and commented-out lines reference `VIEW_CUSTOMER`,
  `UPDATE_DELIVERY_ESTIMATION`, `VIEW_PROFORMA_INVOICE` — names absent from
  `permissions.constants.js`. Uncommenting them as-is would lock those endpoints out for every
  role. Reconcile the constants file, the seed, and the route references together.
- **Multer runs before `checkPermission`** (`ProformaInvoice.route.js:13-48`), so a 403 still leaves
  uploaded files on disk. Reorder.
- **`checkPermission` swaps `req.user`** for a different object shape (`permission.middleware.js:53`),
  so controllers see different user objects depending on whether the route has a permission check.
  Attach permissions as a separate field instead.

---

## Phase 5 — Frontend

`npx tsc --noEmit` passes and `next build` should succeed — but only because
`/* eslint-disable @typescript-eslint/no-explicit-any */` and `any` are pervasive in exactly the
audited files. The problems are runtime, not compile-time. There is no react-query/SWR; every
list is `useState` + `useEffect`.

### 5a. Server components send no auth token
The access token lives in a Zustand `persist` store backed by `localStorage`, which is a no-op on
the server (`stores/auth.store.ts:117-127`). Every `async` server component that calls a service
therefore sends **no `Authorization` header** and 401s:
`features/DeliveryEstimation/view-page.tsx:43` (no try/catch at all → 500 error page),
`features/Project/view-page.tsx:17`, `features/ProformaInvoices/view-page.tsx:19` and
`seconviewpage.tsx:19`, `features/capacitySlots/listing.tsx:27`,
`app/dashboard/allprojectgant/page.tsx`.

Fix: convert these to client components that fetch through `axiosInstance` (matching the rest of
the app), or move the token to an httpOnly cookie readable by `cookies()` in RSC. Client
conversion is the smaller, lower-risk change and is consistent with every other listing.

Related: `features/ProformaInvoices/view-page.tsx:25` and `seconviewpage.tsx:25` call
`toast.error()` from inside a server component — the toast never fires, so the error is swallowed
and a blank "create" form renders where the record should be.

### 5b. Double pagination — page 2+ is always empty
All three main listings fetch a server page and then slice that page again:
`features/Project/listing.tsx:198` → `:346`; `features/ProformaInvoices/listing.tsx:107` → `:231`;
`features/DeliveryEstimation/listing.tsx:36` → `:97-103`. With `limit=10`, page 2 fetches records
11-20 (10 items) then slices `[10..20)` → `[]`. Drop the client-side slice and use the server's
page directly.

Same root cause: the status-pill counts (`Project/listing.tsx:314-342`,
`ProformaInvoices/listing.tsx:211-227`) are computed over the current page, so "23 Pending" means
"23 pending on this page". Get these from the backend. And
`ProformaInvoices/listing.tsx` reads `startDate`/`endDate` from the query string, puts them in the
effect deps and passes them to `<DataTable>`, but never sends them to the API — a filter that
just re-triggers an identical fetch.

### 5c. Stale lists after mutation
`router.refresh()` only re-runs server components, so after delete/status-change the stale row
stays on screen: `features/Project/tables/cell-action.tsx:50`,
`features/ProformaInvoices/tables/cell-action.tsx:43`,
`features/DeliveryEstimation/tables/cell-action.tsx:62,82,101`. Thread an `onRefresh` callback
down from the listing (the pattern already used correctly by the stage boards) or lift fetching
into a shared hook. `features/capacitySlots/*` is the one place this works, because its listing
is a genuine RSC.

### 5d. Missing UI for endpoints that exist
- **Delivery Estimation** (`features/DeliveryEstimation/tables/cell-action.tsx`): no **Edit**
  action despite `/dashboard/DeliveryEstimation/[id]` and `updateDeliveryEstimation` existing;
  `onUpdateStatus` (`:72-88`) and `onConfirmEstimation` (`:91-107`) are fully implemented and
  **never rendered**; `CreateProjectFromEstimationModal` is mounted at `:118-121` but
  `setOpenCreateProjectModal(true)` is never called — so **the entire estimate→project conversion
  flow is unreachable from the UI**. Wire all four.
- **Project** (`features/Project/tables/cell-action.tsx`): `ProjectScheduleModal` is mounted at
  `:68-73` but `setScheduleOpen(true)` is never called → auto-schedule and manual-schedule have no
  reachable UI. Edit is commented out at `:102-110` (while `detail.tsx:320` still links to it).
  `cell-action2.tsx` is exported and imported by nothing — the only caller of
  `PATCH /projects/:id/status`.
- **Capacity slots** (`features/capacitySlots/form.tsx`): the Days, Working-hours and
  Parallel-slots inputs are commented out (`:141`, `:156-168`, `:171-183`) while their state and
  validation remain, and `days: 1` is hardcoded at `:69`. Editing a slot silently writes
  `workingHours: 7.5` from a hidden default. Restore the inputs (and see 2e — decide whether
  `days`/`workingHours` should exist at all, since the engine ignores both).
- **Holidays** (`features/SchedulingSettings/holidays.tsx`): create/delete only, no edit, and
  delete at `:236` is a single unconfirmed click on a scheduler-affecting action.
- **Stage work logs**: every stage cell-action declares `hours` state (`:79`) and sends it in the
  payload (`:160`) but renders no input for it — the work-log `hours` field can never be set.

### 5e. Payload mismatches
- `features/Project/form.tsx:174` — `router.push(...${response.data.id})` but create/update return
  `{success, project}`; `response.data` is `undefined` → **TypeError on every successful project
  create**. Compiles only because the type declares `data?: any`.
- `features/Project/modal.tsx:452-478` — `customDates` sends `startDate` only; **`endDate` is
  never sent** even though the UI collects it and the service type declares it. Every stage edit
  silently drops the user's end date. Also sends an undeclared `stageId` (`:481`).
- `features/DeliveryEstimation/form.tsx:551-565` — `submissionData` omits `PURCHASING` and
  `INSTALLATION`, which are computed at `:365` and displayed, then thrown away on save.
- `features/DeliveryEstimation/form.tsx:585` — `created?.data?.estimation?.code` against a type
  declaring both `data` and `estimation` at the same level; one is wrong and the toast silently
  falls back to a generic message.

### 5f. Error handling
- `features/SchedulingSettings/form.tsx:56-60` — if the initial GET fails, the form still renders
  with **hardcoded defaults** and Save then overwrites the real server settings with them. Block
  the form on load error.
- `service/ProformaInvoice.ts` and `service/CapacityLot.ts` rethrow raw axios errors while the
  other services unwrap `error.response.data.message` — so users see *"Request failed with status
  code 400"* instead of the backend's validation message. Normalize all services.
- Capacity fetches that fail render **every stage as capacity 0** (i.e. "everything is over
  capacity"): `features/Project/calander2.tsx:541`, `StageAllocationCalendar.tsx:154`,
  `daydetail.tsx:198` all `.catch(() => ({ capacitySlots: [] }))`. Surface the failure instead.
- `features/Project/modal.tsx:236` silently swallows a failed capacity check, so an over-capacity
  stage saves with no warning.
- `features/ProformaInvoices/detail.tsx:314-336` — on payment failure the confirm dialog stays open
  (`setShowPaymentAlert(false)` is inside the `try`), allowing a double-submit.
- Service catch blocks return `{ …: [], success:false }` (`service/Project.ts:74`, `Stages.ts` ×14,
  `ProformaInvoice.ts:72,112`, `delivery-estimation.ts:82`), so callers cannot distinguish "empty"
  from "server error" — every failure renders as an innocuous empty table.

### 5g. Permissions & routing
- **No `middleware.ts`** — dashboard protection is client-only (`components/ProtectedRoute.tsx`).
- **`app/dashboard/scheduling-settings/page.tsx` has no `PermissionGuard`** — any authenticated
  user can rewrite the global delivery formula, shift window and holiday calendar. There is no
  `SCHEDULING_SETTINGS` entry in `stores/permissions.ts` either; add one (and the matching backend
  permission).
- **`features/Project/modal.tsx:211` `const canEdit = true;`** hardcodes stage add/edit/delete open
  to everyone, making three `toast.error('You do not have permission…')` branches dead code.
- Page-level view guards are missing everywhere: `PERMISSIONS.PROJECT.VIEW_ALL`,
  `PROFORMA_INVOICE.VIEW_ALL`, `DELIVERY_ESTIMATION.VIEW`, `CAPACITY_SLOT.VIEW` are defined and
  never used. All 12 stage cell-actions have zero permission checks.
- **`components/PermissionGuard.tsx:81-103`** — the entire "Access Denied" card is commented out;
  denied users get a blank white div.
- **`app/dashboard/Project/stage/[id]/page.tsx:11-26`** is a `[id]` route that reads
  `searchParams.id` instead of `params.id` → the segment form always renders "project not found".
  Only the query-string sibling works. `app/dashboard/capacityday/[id]/page.tsx:17-24` has the same
  bug, worked around by parsing `usePathname()` manually in `daydetail.tsx:224`.
- **`app/dashboard/Stage/painting/finished/page.tsx:18`** renders
  `features/Stages/PAINTING/Project/listing.tsx`, which fetches `status: 'not-finished'` — the
  "Finished Painting" page lists **unfinished** projects. The real component is `inished.tsx`
  (filename missing its `f`), imported by nothing.
- **`features/Project/form.tsx:461`** — Cancel navigates to `/dashboard/project` (lowercase);
  Next.js paths are case-sensitive, so Cancel lands on the 404 page.
- **`app/piclient/[id]`** is a "public" client-share link that fetches through the authenticated
  `axiosInstance` (`senttoclient.tsx:28`), so an unauthenticated client is redirected to `/login`.
  The Send-to-Client feature cannot work; it needs a public backend endpoint with a signed token.

### 5h. Config
- `config/apiConfig.ts` — `BASE_URL` is `string | undefined` with no fallback or assertion; a
  missing `NEXT_PUBLIC_API_URL` makes every request relative to `localhost:3030`. Assert at module
  load.
- `next.config.ts` hardcodes `hostname: 'rcf.ordere.net'` while `.env` points at `localhost:5000`
  (masked by `unoptimized: true`). Drive from env.
- `features/Campany/view.tsx:11` — fallback URL `'http:// 192.168.1.2:500'` is malformed (space
  after `http://`, truncated port). `features/ProformaInvoices/detail.tsx:111` bakes the production
  host into source.

### 5i. Naming inconsistency, not a bug
`service/Stages.ts:65` calls `/metal-work-projects` without the `/stage/` prefix its 12 siblings
use — this **matches the backend** (`stage.route.js:9`), so it works. Optionally align both sides;
low priority, and it must be changed in both repos at once.

### Cleanup (low priority, do last)
Dead modules imported by nothing (`features/Project/calander3.tsx` — 1 860 lines,
`features/Project/calander` pulled in by `capacitycalendar/page.tsx:3` and never rendered,
`cell-action2.tsx`); unused `IncomingMessage` imports from `http` in five services (Node types in
client bundles); `import Link from 'next/dist/client/link'`
(`app/dashboard/DeliveryEstimation/page.tsx:15`); leftover `console.log`s; the stray 8.5 KB `exot`
file at repo root (it is `git log` output); `window.confirm`/`window.alert` in
`calander2.tsx:945-957` and `ProformaInvoices/form.tsx:1039` where the app uses `AlertModal`;
`detail.tsx:244` formats `₦0.00` (Naira) two lines above a formatter using `ETB`; `detail.tsx:59`
returns the Tailwind class `'shrink-0'` where a duration string belongs.

---

## Verification (manual, end to end)

Backend on `:5000` (`npm start`), frontend on `:3030` (`pnpm dev`), against a freshly migrated and
seeded dev DB.

1. **Working time** — `/dashboard/scheduling-settings`: change working days to Mon–Fri, shift hours,
   lunch, contingency and difficulty percentages; reload and confirm they persisted (today this
   silently does nothing). Add a holiday and a recurring holiday.
2. **Capacity** — `/dashboard/capacitySlots`: set per-stage capacity and parallel slots. Check
   `/dashboard/capacitycalendar` and `capacityday/[id]` reflect them.
3. **Estimate** — `/dashboard/DeliveryEstimation`: create with quantities across several stages;
   confirm the promised date skips weekends and the holiday added in step 1 and includes the
   difficulty buffer. Edit quantities → date recomputes. Put on hold without `holdUntil` → rejected.
4. **Proforma** — create an invoice with items and attachments; edit it; add a partial payment
   (balance = total − paid); add a second payment without a date (first payment's date survives);
   attempt an overpayment → rejected.
5. **Convert** — create a project from the estimate; confirm the scheduled delivery matches the
   quote, the estimate flips to `PROJECT_CREATED`, and the invoice to `APPROVED_CREATE_PROJECT`.
6. **Project CRUD** — list with pagination (page 2 returns different rows, `total` is the real
   count); open detail; update difficulty → delivery date recomputes; set status to `CUTTING`
   (currently rejected); search; filter by customer.
7. **Stages & capacity ledger** — log work on a stage, complete it early, and confirm via
   `/dashboard/capacitycalendar` that **past days stay consumed** and only future days are freed.
   Query `DailyStageCapacity` directly: no row may have negative `usedCapacity`, and every row's
   `usedCapacity` must equal the sum of its `ProjectStageCapacityAllocation` rows.
8. **Delete paths** — delete an invoice that has a project → **409, nothing deleted** (verify items
   and files still present). Delete the project first, confirm the estimate returns to a
   reconvertible state and the invoice status resets, then delete the invoice → clean.
9. **Auth** — with a logged-out client, `curl` each endpoint listed in 4g and confirm 401.
10. **Concurrency** — fire two simultaneous payments on one invoice and two simultaneous project
    creations against a nearly-full capacity day; confirm no lost update and no overbooking.
11. **Frontend regressions specifically** — page 2 of Project, Proforma and Estimation lists shows
    rows (not empty); deleting a row removes it without a manual reload; project create redirects
    to the new project instead of throwing; the estimate row menu offers Edit / Status / Confirm /
    Create Project and each works; a stage edit's end date survives a round trip; Cancel on the
    project form returns to `/dashboard/Project`; `/dashboard/Stage/painting/finished` lists
    finished projects.
12. **Ledger rebuild** — run `npm run capacity:rebuild` and confirm it reports zero drift on a
    freshly exercised DB (it should find and fix drift on the current one).

**Order of execution.** Phase 0 first (validation and error handling gate every other test), then
Phase 1's single migration, then 2 → 3 → 4 → 5. Phases 3 and 4 are independent of each other and
can be interleaved; Phase 5 depends on 3 and 4 being settled, since some UI work is wiring up
endpoints those phases fix.
