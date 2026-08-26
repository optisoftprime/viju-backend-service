# Frontend Guide — Sixth Region, User Editing, Bulk Actions & the Loading Flow

**Answers:** `BACKEND_REQUEST_REGION_EDITING_AND_LOADING_FLOW.md` (spec 39)
**Backend branch:** `dev`
**Date:** 26 Aug 2026
**Scope:** all eleven items — R-1, A-1, A-2, L-1, L-2, O-1, O-2, C-1, C-2, B-1, B-2.

> **All eleven are done**, including the four you marked blocking and the two
> you listed as "not blocking, just wasteful". Every fallback described in your
> request can now be deleted.
>
> Your covering note asked for "round 2 only" — that split belongs to the
> previous request (spec 35/38). This document has no rounds: everything in it
> was OPEN, so everything in it is implemented and covered below.

⚠️ **This release needs `prisma migrate deploy`.** See **§13** — there is a
PostgreSQL-version detail worth reading before you ship.

---

## 0. Summary

| # | Outcome | What to delete / change on the frontend |
|---|---|---|
| **R-1** | **Done.** `OTHERS` is the sixth region, accepted everywhere the other five are. | Nothing — it already works as a real value. |
| **A-1** | **Done.** Three officer-scoped routes, identical envelope to the regional ones. | Nothing — `loadingScopeForRole` starts working. |
| **A-2** | **Done.** `OFFICER` may now call `GET /admin/officers`, pinned to `role=LOADING_OFFICER` + own region. | Delete the "could not load officers" fallback. |
| **L-1** | **Done.** Two `/cancel` routes + `CANCELLED` on the status route. | Wire the cancel buttons; they hit real routes now. |
| **L-2** | **Done.** `description` on every loading row + its own PATCH route. | Delete the `-` placeholder; Save works. |
| **O-1** | **Done.** `PATCH /admin/officers/{id}` accepts `name`/`phone`/`region`/`password`. | Nothing — the edit modal starts working. |
| **O-2** | **Done.** `PATCH /admin/officers/bulk-region`, per-officer results. | Replace the sequential fan-out with one call. |
| **C-1** | **Confirmed — both filters were already applied.** Plus the answer to your region question. | Nothing. See **§8** — your fix was right. |
| **C-2** | **Done.** `PATCH /admin/customers/bulk-reassign`, per-customer results. | Replace the 80-request fan-out with one call. |
| **B-1** | **Done.** `?search=` on broadcast history. | Delete the 200-row client-side window. |
| **B-2** | **Done.** `customerIds[]` accepted. **Allowance is per recipient** — your form's wording is correct. | Replace the loop with one call. |

---

## 1. R-1 — the `OTHERS` region

`OTHERS` is now the sixth member of the `Region` enum, accepted anywhere the
other five are: `?region=` filters, `region` on user create and update, and
inside `targetRegions` on a regional broadcast.

```json
{ "id": "…", "name": "Acme Ltd", "region": "OTHERS", … }
```

**Ordering.** It comes **last**, after the five BP_CLUSTER_CODE-ordered
regions:

```
LAGOS, EASTERN, SOUTH_SOUTH, WESTERN, NORTH, OTHERS
```

Render tab strips and dropdowns in that order and you match every server-side
list.

### `OTHERS` is BP_CLUSTER_CODE 9

It maps to the ERP's own "other customers" bucket:

```
BP_CLUSTER_CODE 9  ->  OTHERS
```

The ERP names that cluster **其他客户** — literally "other customers" — so this
is its own classification being honoured, not a portal invention. **58
customers** are in it today. Note the gap: 6, 7 and 8 are not codes the feed
uses.

So `OTHERS` behaves like any other region: an ERP customer in cluster 9
projects into it automatically, `?region=OTHERS` filters to it, and it appears
in the unprojected list.

### Two codes are deliberately NOT mapped

The feed also carries `GZ001` (泷迪客户编码) and `GZ020` (广州拓燊客户编码).
These are **customer-coding schemes for other group entities**, not Nigerian
territories — and `GZ020` alone covers **1,832 customers**, more than all five
Nigerian regions combined (1,851).

They stay unmapped on purpose. Filing another company's customers under a Viju
territory would be wrong, and it would quietly double the apparent size of the
distributor base. They surface in the admin dashboard's `unmappedRegionCount`
instead, where a person can see and question them.

**So `GET /admin/erp/unmapped-customers` shrinks by 58, not by 1,896.** If those
GZ rows should not be in this feed at all, that is a conversation for the ERP
team rather than something to give a region to.

---

## 2. A-1 — the account officer's loading requests

Three routes, mirroring the regional ones exactly — same query params, same row
shape, same `meta`, same request bodies. They are served by the **same service
methods**, so the two portals cannot drift.

```http
GET   /api/v1/officers/loading-requests?page=1&pageSize=20&search=&status=
PATCH /api/v1/officers/loading-requests/{id}/assign
PATCH /api/v1/officers/loading-requests/{id}/cancel
```

**Only the scope differs**, exactly as you asked: a regional admin sees their
whole region; an account officer sees the loading requests of the customers
assigned to them, resolved from their own staff record. There is no `officerId`
parameter — one officer cannot read another's work.

"Assigned to them" means **primary or secondary** (`assignedOfficerId` OR a
`CustomerOfficer` row), the same set `GET /officers/customers` returns, so a
reassignment never hides a load from the officer who now owns it.

An `ADMIN` calling these routes is deliberately **not** narrowed to a
portfolio — they have cross-region visibility everywhere else in that
controller.

### Response (verified live)

```json
{
  "data": [
    {
      "id": "481fddb8-17e2-4ec2-9736-43f13f462125",
      "waybill": "WB-004212",
      "reference": "ORD-0099",
      "distributorName": "ISEA INTEGRATED",
      "orderId": "1c898862-42b4-4241-a74a-87bb09628a08",
      "truckPlateNumber": "LAG-168-XY",
      "driverName": "Emeka Obi",
      "driverPhone": "+2348056789012",
      "quantityCartons": 55,
      "loadingDate": "2026-05-15T08:00:00.000Z",
      "submittedAt": "2026-08-22T13:11:56.240Z",
      "region": "LAGOS",
      "status": "COMPLETED",
      "assignedOfficer": { "id": "0a17cdfd…", "name": "Ifeanyi Okonkwo" },
      "description": null,
      "cancelledAt": null,
      "cancelReason": null
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 37, "totalPages": 2, "hasNextPage": true, "hasPreviousPage": false }
}
```

`description`, `cancelledAt` and `cancelReason` are on **every** loading row —
here, on `GET /regional/loading-requests`, and on the loading officer's own
`GET /loading/queue` — so the DESCRIPTION column and the cancelled state render
from the list without a call per row.

---

## 3. A-2 — reading the loading-officer list

You offered two options; we took the first, because it needs **no frontend
change at all**:

```http
GET /api/v1/admin/officers?role=LOADING_OFFICER&isActive=true&region=LAGOS
```

`OFFICER` is now authorised on this route. Delete the "could not load officers"
fallback.

**It is narrowly widened, deliberately:**

- An account officer is **pinned to `role=LOADING_OFFICER`** whatever the query
  string says, so this cannot become a way to enumerate their peers.
- They are **pinned to their own region**, read from the token. A `region`
  param from an officer is ignored, not honoured.
- They are **not** on `GET /admin/officers/{id}` and **not** on any management
  route. Only the list.

Verified live as `officer.lagos1@viju.local`: returns the two LAGOS loading
officers and nothing else.

---

## 4. L-1 — cancelling a load

Three doors, one rule set.

| Role | Route |
|---|---|
| Regional admin | `PATCH /api/v1/regional/loading-requests/{id}/cancel` |
| Account officer | `PATCH /api/v1/officers/loading-requests/{id}/cancel` |
| Loading officer | `PATCH /api/v1/loading/queue/{id}/status` with `{"status":"CANCELLED"}` |

Body for the two `/cancel` routes:

```json
{ "reason": "distributor rescheduled" }
```

`reason` is optional, max 500. **Omit it entirely** rather than sending `""` —
the backend stores a reason only when one was given, so "no reason recorded"
and "the reason was blank" stay distinguishable. The status route accepts the
same optional `reason` alongside `"status": "CANCELLED"`.

### Legality — exactly as you specified

Legal from `PENDING`, `ASSIGNED` and `IN_PROGRESS`. A `COMPLETED` load is
final:

```json
{
  "message": "A completed load cannot be reopened.",
  "code": "INVALID_STATUS_TRANSITION",
  "statusCode": 409
}
```

Verified live: cancelling a PENDING load succeeded, cancelling a COMPLETED one
returned that exact 409. The API is the control, as you asked — the hidden
button is belt-and-braces.

### Response

```json
{
  "id": "c675a746-7cc1-4231-a0d5-455d5c451008",
  "waybill": "SEED-WB-10110017-02",
  "distributorName": "ISEA INTEGRATED",
  "status": "CANCELLED",
  "cancelledAt": "2026-08-26T11:34:41.751Z",
  "cancelReason": "distributor rescheduled",
  "assignedOfficer": null,
  "description": null
}
```

### Notifications

Both the **distributor** and the **assigned loading officer** are notified, as
they are on assignment — the officer may already be at the depot, and a silent
cancellation would send them to load a truck that is not coming. A load with no
officer yet (PENDING) notifies only the distributor.

One asymmetry worth knowing: when the **loading officer cancels their own load**
through the status route, only the distributor is notified — telling officers
about their own action is noise.

---

## 5. L-2 — the loading note

```http
PATCH /api/v1/loading/queue/{id}/description
```

```json
{ "description": "customer loading 800 cartons on 26/08/2026, remaining a balance of 200 cartons" }
```

- **Assigned loading officer only.** Anyone else gets 403 — the same gate the
  status and waybill routes use.
- **Max 500 characters**, enforced (`400` naming `description` past that).
- **`""` is a valid save** and clears the note back to `null`, exactly as you
  asked. A whitespace-only string clears it too.
- **Its own route, deliberately.** Saving the note never moves the status, and
  saving the status never touches the note.

Responds with the **full assignment detail** so the screen re-renders from one
body:

```json
{
  "id": "f6559538-0e59-48cd-a1ae-b9bba22a606a",
  "waybill": "SEED-WB-10110003-01",
  "orderId": "ORD-0099",
  "distributorName": "ADLAK",
  "truckPlateNumber": "LAG-234-XY",
  "driverName": "John Dare",
  "quantityCartons": 320,
  "loadingDate": "2026-08-26T09:00:00.000Z",
  "submittedAt": "2026-08-25T16:41:02.000Z",
  "region": "LAGOS",
  "status": "COMPLETED",
  "description": "customer loading 800 cartons on 26/08/2026, remaining a balance of 200 cartons",
  "attachmentUrl": null,
  "updatedAt": "2026-08-26T11:41:12.004Z"
}
```

All three behaviours verified live: set, clear-with-`""`, and the 500-char
rejection.

---

## 6. O-1 — editing a user

`PATCH /api/v1/admin/officers/{id}` now accepts the profile fields **alongside**
the `isActive` it already took. Every field optional; only what is **present**
is applied — so keep sending only what changed, and an unchanged password is
never rotated.

```json
{ "name": "Ada Obi", "region": "OTHERS" }
```

```json
{
  "id": "88494ec9-efe1-40fe-9624-81c4a73addb1",
  "name": "Ada Obi",
  "email": "officer.eastern2@viju.local",
  "phone": "+2349010000016",
  "region": "OTHERS",
  "role": "OFFICER",
  "isActive": true,
  "changed": true
}
```

- **Validation matches `POST /admin/officers` exactly**: name 2–120, the same
  phone pattern, password 8–72. Same failure shape, so errors land on the right
  input.
- **`region` on an `ADMIN` is a 400** with `code: "REGION_NOT_ALLOWED"` and
  `field: "region"` — verified live.
- **A password change is not emailed.** The admin passes it on, as you asked.
- **`changed: false`** when nothing actually differed — re-sending the same
  values is a safe no-op (verified).
- **`isActive` is now optional.** Sending it alone behaves exactly as before, so
  the existing deactivate/reactivate flow is untouched.

If you send a profile edit **and** `isActive: false` in one body, the profile
edit is applied first. That matters because deactivation can fail with 409
(officer still holds customers) — this way the edit is not silently lost when
it does. An empty body is a 400 `EMPTY_UPDATE`.

---

## 7. O-2 — bulk officer region

```http
PATCH /api/v1/admin/officers/bulk-region
```

```json
{ "officerIds": ["…", "…"], "region": "OTHERS" }
```

```json
{
  "succeeded": ["5dc92a38-c76e-4d3e-9288-aff59fe12c30"],
  "failed": [
    {
      "officerId": "e58d4bf7-7dd0-4098-84f7-92fb74da523b",
      "code": "REGION_NOT_ALLOWED",
      "message": "An ADMIN is organisation-wide and cannot be scoped to a region."
    }
  ]
}
```

**Per-officer results, never all-or-nothing** — exactly as you asked. Nine moved
and one failed leaves nine moved. There is deliberately no surrounding
transaction. Verified live with a mixed selection.

Each move applies the same rules as the single route, so `code` is the same
value you already branch on there. Duplicates are collapsed; max 500 per call.

---

## 8. C-1 — your two questions, answered

### "Are `region` and `isActive` applied on `GET /admin/officers`?"

**Yes, both — and they always were.** In `AdminService.getOfficers`:

```ts
...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
...(filter.region ? { region: filter.region } : {}),
```

So your fix is correct and complete: sending
`?isActive=true&region=<customer's region>` genuinely narrows the picker to
valid candidates. The original bug was the picker offering everyone, not the
API ignoring you.

One caveat you should know: for a **REGIONAL_ADMIN** the `region` param is
**accepted and ignored** — they are always pinned to their own token's region.
That is pre-existing and deliberate (it never 403s, unlike
`GET /admin/customers`). For an **ADMIN** your `region` is honoured as sent.

### "Is `region` on reassign compared against the customer's or the officer's?"

**The customer's.** The officer must be in the region the *customer* is in:

```ts
const officer = await this.prisma.staff.findFirst({
  where: { id: dto.newOfficerId, role: 'OFFICER', isActive: true,
           region: customer.region },
});
```

So the UI assumption you built on — that the two must match — is right. Send
the **customer's** region to the picker, which is what you are doing.

---

## 9. C-2 — bulk customer reassignment

```http
PATCH /api/v1/admin/customers/bulk-reassign
```

```json
{ "customerIds": ["…", "…"], "newOfficerId": "…" }
```

```json
{
  "succeeded": ["843812d6-…", "f4065cfe-…"],
  "failed": [
    {
      "customerId": "8ed16679-…",
      "code": "OFFICER_NOT_FOUND",
      "message": "Officer not found or inactive"
    }
  ]
}
```

Per-customer results, same reasoning as O-2. Each move goes through the single
route's logic, so the region rule, the `CustomerOfficer` bookkeeping (chat and
tickets follow) and the `ASSIGNMENT` notification to the incoming officer are
all unchanged.

**`ALREADY_ASSIGNED` counts as a SUCCESS**, exactly as you asked — the customer
ends up holding the officer that was asked for. Verified live: re-running the
same batch returned all ids in `succeeded` with `failed: []`, so re-running a
half-finished batch does not look broken.

The single route still **refuses** `ALREADY_ASSIGNED` with 409, so an operator
acting on one customer is still told why nothing changed.

---

## 10. B-1 — searching broadcast history

```http
GET /api/v1/admin/broadcasts/history?search=depot&page=1&pageSize=10
```

Matches, case-insensitive and partial, on all three things you asked for:

| Field | Example |
|---|---|
| `reference` | `BR-202559` |
| `message` | `depot` |
| Recipient name | `ADLAK` (individual broadcasts, via `targetCustomer.name`) |

Applied **server-side**, so it searches the whole history and `meta.total` is
the size of the filtered set. Delete the 200-row window and the client-side
match — the silent failure at 201 broadcasts is gone.

All three dimensions verified live (2 by message, 2 by recipient, 1 by
reference, 0 for a non-match). Response envelope is unchanged.

---

## 11. B-2 — multi-recipient individual broadcast

```http
POST /api/v1/admin/broadcasts/individual
```

```json
{
  "customerIds": ["…", "…"],
  "message": "Depot audit notice",
  "deliveryAllowance": 1000
}
```

The original single `customerId` form still works and returns the **identical
single object** it always did — so nothing breaks while you migrate. Send
`customerIds` for several; you get an **array**, one Broadcast row per
recipient:

```json
[
  { "id": "…", "reference": "BR-202559-Individual", "type": "INDIVIDUAL", "deliveryAllowance": 1000, "deliveredCount": 1, … },
  { "id": "…", "reference": "BR-204188-Individual", "type": "INDIVIDUAL", "deliveryAllowance": 1000, "deliveredCount": 1, … }
]
```

### The allowance question — your form is right

**The allowance is credited PER RECIPIENT, not split between them.** Twelve
recipients at ₦1,000 credit ₦12,000 in total. That is what your form states
before anything is sent, and it is what the batch form does — no divergence, no
copy change needed.

Each recipient gets their own Broadcast row, so history stays per-recipient and
`deliveredCount` keeps meaning "how many people this record reached". Sends run
**in sequence** server-side, for the same reason your loop did — each can credit
a wallet.

Everything from the previous release still holds per recipient: the amount is
read back from the Payment actually written, a failed credit sends no
notification, and the credit lands before the push.

Duplicate ids are collapsed; max 200 per call.

---

## 12. Status vocabulary — nothing renamed

Recorded, and acted on: **`IN_PROGRESS` remains the wire value** on `/loading/*`
and `/regional/loading-requests`. `LOADING_IN_PROGRESS` remains a separate enum
(`CustomerWaybillStatus`) on `/officers/customers/{id}/waybills`. The two are
still deliberately not shared, and nothing was reconciled by renaming either.

`PENDING` also remains — it is the state before a loading officer is assigned,
and it is now one of the states a load can be cancelled from.

For the notification copy only, statuses render as prose: `Pending Assignment`,
`Assigned`, `Loading in Progress`, `Completed`, `Cancelled`. That is push text,
never a wire value.

---

## 13. Deploy note — read this one

**`prisma migrate deploy` is required.** One migration covers all three schema
changes: `20260826000000_others_region_and_loading_flow`.

### The PostgreSQL-10 problem, and why the migration looks the way it does

The obvious way to add `OTHERS` is:

```sql
ALTER TYPE "Region" ADD VALUE 'OTHERS';
```

**That would have failed your deploy.** This database is **PostgreSQL 10.22**,
where `ADD VALUE` cannot run inside a transaction block — and Prisma wraps every
migration in one:

```
ERROR: ALTER TYPE ... ADD cannot run inside a transaction block
```

(PostgreSQL 12 relaxed this.) So the migration rebuilds the type and swaps it,
the same pattern `20260818000000_region_bp_cluster_code` already used, moving
all four columns that carry it (`Customer.region`, `Staff.region`,
`LoadingRequest.region`, `Broadcast.targetRegions`). Every existing value keeps
its exact spelling.

**It has already been applied to the dev database** and verified: the enum reads
`LAGOS, EASTERN, SOUTH_SOUTH, WESTERN, NORTH, OTHERS`, the four new
`LoadingRequest` columns exist, and no customer changed region. Your deploy will
see it as already applied there and will apply it fresh anywhere else.

**Flagging this because you flagged it:** you noted the migrate step was missed
once already on the spec-36 `description` column. It is the same step here, and
`docker-entrypoint.sh` runs it automatically on container start — so a normal
deploy covers it.

---

## 14. What did NOT change

For your regression pass:

- **No route removed or renamed.** Everything new is additive.
- **`POST /admin/broadcasts/individual` with a single `customerId` returns the
  identical single object** it always did.
- **`PATCH /admin/officers/{id}` with only `isActive`** behaves exactly as
  before, including every 409 guard (`OFFICER_HAS_CUSTOMERS`,
  `LAST_ACTIVE_ADMIN`, `SELF_DEACTIVATION`) and `changed: false` idempotency.
- **`GET /regional/loading-requests` keeps its shape** — it only gains
  `description`, `cancelledAt` and `cancelReason`.
- **`GET /admin/officers` is unchanged for ADMIN and REGIONAL_ADMIN.** Only
  `OFFICER` was added, narrowly.
- **The five existing regions are untouched** — same spelling, same order, same
  BP_CLUSTER_CODE mapping. `OTHERS` is appended.
- **Existing statuses and transitions are unchanged.** `CANCELLED` was already
  in the enum; only the transitions into it are new.

### Test coverage

| Item | Spec file |
|---|---|
| R-1 | `src/common/region/region.constants.spec.ts` (updated) |
| L-1, L-2 | `src/modules/loading/loading-cancel-description.spec.ts` (10 tests) |
| O-2, C-2 | `src/modules/admin/admin-bulk.spec.ts` (6 tests) |
| A-2 | `src/modules/admin/admin.authorization.spec.ts` (updated) |

Full suite: **345 passing, 25 suites.** A-1, A-2, L-1, L-2, O-1, O-2, C-2, B-1
and B-2 were additionally smoke-tested live against the dev database through the
running API, with every test mutation reversed afterwards.
