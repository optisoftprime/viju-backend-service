# Frontend Guide — Who Cancelled a Load, and Bulk Actions for a Regional Admin

**Answers:** `BACKEND_REQUEST_CANCELLED_BY_AND_REGIONAL_BULK.md` (spec 43)
**Backend branch:** `dev`
**Date:** 28 Aug 2026
**Scope:** CB-1, BA-1, BA-2.

> **Two of three implemented. BA-1 is refused, and you were right to flag it.**
>
> - **CB-1 — done.** `cancelledBy: { id, name, role }` on every loading-request row.
> - **BA-2 — done.** `REGIONAL_ADMIN` allowed, scoped to their own region on both sides.
> - **BA-1 — NOT implemented.** `bulk-region` stays ADMIN-only. §2 is the reasoning you asked for.
>
> **No migration.** CB-1 is a lookup, not a column.
>
> Your covering note asked for "round 2 only" — that split belongs to the
> spec 35/38 request. This document has no rounds.

---

## 1. CB-1 — who cancelled the load

`cancelledBy` is on every loading-request row: `GET /loading/queue`,
`GET /loading/queue/{id}`, `GET /regional/loading-requests`,
`GET /officers/loading-requests`, both `/cancel` responses, and the loading
officer's `PATCH /loading/queue/{id}/status` (which is how *they* cancel).

```json
{
  "status": "CANCELLED",
  "cancelledAt": "2026-08-28T11:34:41.751Z",
  "cancelReason": "distributor rescheduled",
  "cancelledBy": {
    "id": "1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081",
    "name": "Ada Obi",
    "role": "REGIONAL_ADMIN"
  }
}
```

`role` is the **wire enum** — `ADMIN`, `REGIONAL_ADMIN`, `OFFICER`,
`LOADING_OFFICER` — never display text. Render it through `formatRole()`.

Live, against the real cancelled loads on the deployment:

```
WB-135307             OFFICER         - Funmi Adelaja
SEED-WB-10110017-08   REGIONAL_ADMIN  - Ngozi Okafor
SEED-WB-10110004-08   LOADING_OFFICER - Ifeanyi Okonkwo
SEED-WB-10110017-07   null
SEED-WB-10110004-07   null
SEED-WB-10110003-07   null
```

All three cancelling roles appear in real data — which is exactly the case the
column exists for. A load cancelled by the assigned loading officer and one
overruled by the regional admin are indistinguishable without it.

### ⚠️ One correction to your assumption

You wrote that rows cancelled before this lands *"should keep `cancelledBy: null`
rather than being back-filled with a guess."*

**No guess is needed for most of them.** The actor has been recorded since L-1
shipped, so of the 7 cancelled loads on the deployment, **4 carry a real
actor** and **3 are genuinely `null`** — those predate L-1 and have nobody
recorded.

So you get the real name where we have it and `null` where we don't. That is
strictly better than nulling all 7, and it is still not a guess. Your fallback
render for `null` is right and still needed for the 3.

### No migration, deliberately

`cancelledBy` is resolved with a batched lookup on the existing
`cancelledById` column — one extra query per page, and only when a page
actually contains cancelled rows. Adding a Prisma relation would have meant a
migration to create a foreign key on a table that already holds data, for a
field read on a minority of rows.

If an id ever stops resolving, the row renders `null` rather than erroring.

---

## 2. BA-1 — not implemented, and why

**`PATCH /admin/officers/bulk-region` stays ADMIN-only.** A regional admin
calling it gets the standard `403`.

You asked for pushback rather than silent agreement. Here it is: **RU-3's
reasoning still holds, and it holds harder in bulk.**

Your own framing was right. The two readings you identified are the only two,
and both fail:

- **(a) Source-scoped** — move officers who are in *my* region, to any region.
  This is RU-3's refusal at scale. A regional admin could empty their own
  region of staff into a region whose admin never agreed to receive them.
  Nothing about doing it to ten officers instead of one makes it safer.
- **(b) Confined** — move officers within my own region. A no-op, as you said.

There is no third reading. "A regional admin may move officers to any region"
and "a regional admin is confined to their own region" cannot both be true, and
the second is the premise the rest of the regional-admin work rests on.

**One more reason, which is not hypothetical.** Two officers are *already*
sitting outside their customers' region on the live database:

```
6 LAGOS customers   → officer.lagos1@viju.local   (region SOUTH_SOUTH)
2 WESTERN customers → officer.western1@viju.local (region LAGOS)
```

That is the §8 finding from the last round, still unresolved. It happened one
officer at a time through the single-officer region edit. Those 8 customers now
hold an officer that `PATCH /admin/customers/{id}/reassign` would refuse to
assign, because that route requires the officer to be in the **customer's**
region — so the state is not reachable through the assign flow, only through
the region edit.

BA-1 would let a regional admin create that state in batches of 500. You made
the same point in your §4; we agree, and it is the deciding one.

### What we would rather do

Take it back to the client, as you offered. If what they actually want is
"a regional admin can bulk-manage their own officers", there are safe versions
of that — bulk deactivate, bulk reassign a portfolio — that do not involve
giving staff away. If they genuinely want cross-region transfer, it should
probably be an ADMIN action with the regional admin *requesting* it, not
performing it.

**And the stranded-officer problem should be settled first**, exactly as you
said. Our suggestion: moving an officer who holds customers refuses with `409
OFFICER_HAS_CUSTOMERS`, the way deactivation already does. That is a small,
contained change to the single-officer route. Say the word and we will make it
— but it is a behaviour change to a shipped feature, so we are not doing it
unasked.

Your UI is fine as built: the control is visible and the 403 surfaces. Nothing
to change until this is decided.

---

## 3. BA-2 — implemented

**`REGIONAL_ADMIN` is allowed on `PATCH /admin/customers/bulk-reassign`**,
scoped to their own region on both sides. We agree with your reading: moving
customers between officers *inside* a region is squarely a regional admin's
job, and it involves giving nothing away.

### The receiving officer — checked once, whole call refused

The officer is the same value for every item, so naming a wrong one means the
call is wrong, not that eighty items each failed identically:

```json
{
  "message": "You can only assign customers to an officer in your own region.",
  "code": "REGION_NOT_ALLOWED",
  "statusCode": 403
}
```

Nothing is assigned. Verified live: a LAGOS regional admin naming an EASTERN
officer got this, with no partial writes.

### The customers — checked per item, envelope unchanged

A partly-valid selection still moves what it can, which is what the `failed[]`
envelope is for. Verified live with two LAGOS customers and one WESTERN:

```json
{
  "succeeded": ["f4065cfe-…", "5019af97-…"],
  "failed": [
    {
      "customerId": "8ed16679-…",
      "code": "REGION_NOT_ALLOWED",
      "message": "That distributor is not in your region."
    }
  ]
}
```

Same shape as before. `ALREADY_ASSIGNED` still counts as a success.

**An ADMIN is completely unscoped** — same behaviour as before this change.

### Note on the error code

An out-of-region **customer** returns `REGION_NOT_ALLOWED`, not
`OFFICER_NOT_FOUND` as your example row suggested. `OFFICER_NOT_FOUND` is what
an ADMIN still gets in that situation, because for them the failure genuinely
is "this officer is not valid for this customer". For a regional admin the
failure is "that distributor is not yours", which is a different thing and
worth saying differently. Branch on both.

---

## 4. Your two smaller notes

**`driverPhone`** — confirmed, it has always been on the wire. Nothing changed.

**The stranded officers** — still stranded, and covered in §2. We have not
touched the data; it may be deliberate testing on your side.

---

## 5. What did NOT change

- **No migration, no schema change.**
- **No route added or removed.** CB-1 adds a field; BA-2 widens one role.
- **Every existing loading-request field is unchanged** — `cancelledAt`,
  `cancelReason`, `description`, `descriptionUpdatedAt`, `status`,
  `assignedOfficer` all behave exactly as before.
- **`bulk-reassign` for an ADMIN is byte-identical** to before.
- **`bulk-region` is unchanged for everyone**, including ADMIN.
- **The LC-1 cancellation window still stands** — `PENDING` and `ASSIGNED`
  only.

### Test coverage

| Item | Spec file |
|---|---|
| CB-1 | `src/modules/loading/loading-cancel-description.spec.ts` (4 new tests) |
| BA-2 | `src/modules/admin/admin-regional-parity.spec.ts` (3 new tests) |
| BA-1 stays ADMIN-only | `src/modules/admin/admin.authorization.spec.ts` (updated) |

The authorisation spec now pins `bulkOfficerRegion` as ADMIN-only **with the
reason in a comment**, so the BA-1 decision cannot be reversed by accident
without someone reading why it was made.

Full suite: **408 passing, 28 suites.** CB-1, BA-2 and the BA-1 refusal were
all exercised live against the deployment database, with every assignment
restored afterwards.
