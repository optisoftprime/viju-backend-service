# Frontend Guide — Regional Admin Parity: Broadcasts, Users & Product Flyers

**Answers:** `BACKEND_REQUEST_REGIONAL_ADMIN_PARITY.md` (spec 40)
**Backend branch:** `dev`
**Date:** 26 Aug 2026
**Scope:** RB-1, RB-2, RB-3, RU-1, RU-2, RU-3, RF-1 — plus the two open questions.

> **All seven are done**, and both open questions are answered: **RF-1 is
> reading (a)** (§8) and **RA-O1 is "yes, accepted and ignored"** (§9).
>
> Your covering note asked for "round 2 only" — that split belongs to the
> spec 35/38 request. This document has no rounds, so everything in it is
> implemented.
>
> **No migration.** Authorisation and scoping only; no schema change, so
> `prisma migrate deploy` has nothing new to apply.

---

## 0. Summary

| # | Outcome | What to change on the frontend |
|---|---|---|
| **RB-1** | **Done.** History scoped server-side, region from token, search confined to it. | Nothing — keep sending no `region`. |
| **RB-2** | **Done.** Own region only; another region or a multi-region send is `403 REGION_NOT_ALLOWED`. | Nothing. |
| **RB-3** | **Done.** Own-region recipients only, **whole call rejected** on any outsider — your preference. | Nothing. |
| **RU-1** | **Done.** `managed=true` now returns `OFFICER` + `LOADING_OFFICER`, own region, never admins. | Nothing — the default view stops under-reporting. |
| **RU-2** | **Done.** Creates the two field roles only; region **derived from the token**. | Nothing. |
| **RU-3** | **Done.** Edits the two field roles in-region only; `region` in the body refused. | Nothing — you already omit it. |
| **RF-1** | **Done, reading (a).** Flyers stay global and reachable. | Nothing — the page is unchanged. |
| **RA-O1** | **Answered: yes.** `region` is accepted and ignored on `GET /admin/officers`. | Keep sending it or drop it; both work. |

**Interaction Audits** — agreed, nothing was needed and nothing was touched.

---

## 1. RB-1 — broadcast history

```http
GET /api/v1/admin/broadcasts/history?search=depot&page=1&pageSize=10
```

`REGIONAL_ADMIN` is now authorised and **scoped server-side**. The envelope is
byte-identical to the admin response.

The rule is the one the audit routes use (RA-T2): **the region comes from the
token and OVERRIDES anything sent.** You never have to know whether the
parameter is honoured or refused — keep sending none, and a hand-built request
naming another region simply gets their own data back.

**In scope means** either:
- a `REGIONAL` broadcast whose `targetRegions` contains their region, or
- an `INDIVIDUAL` broadcast to a customer in it.

### Search is confined to the scope

Verified live on the deployment database, with a probe broadcast sent to a
WESTERN customer:

| Caller | `?search=ZZPROBE` | Total history |
|---|---|---|
| ADMIN | **1** | 13 |
| LAGOS regional admin | **0** | 9 |

And `?region=WESTERN` sent by the LAGOS regional admin returned **0**, not the
WESTERN set — the parameter is overridden, never honoured. `meta.total` counts
the scoped set, so paging stays arithmetically correct.

> **Implementation note, because it is the kind of thing that silently leaks:**
> the scope filter and the B-1 search filter are combined with `AND`, not
> merged into one object. Two bare `OR` keys would have overwritten each other
> and returned the whole history.

---

## 2. RB-2 — sending a regional broadcast

`REGIONAL_ADMIN` may send to their **own region only**. Anything else is
refused outright, never silently narrowed:

```json
{
  "message": "You can only broadcast to your own region.",
  "code": "REGION_NOT_ALLOWED",
  "statusCode": 403
}
```

Both cases verified live:

| Body | Result |
|---|---|
| `{"regions":["NORTH"]}` | **403** `REGION_NOT_ALLOWED` |
| `{"regions":["LAGOS","NORTH"]}` | **403** `REGION_NOT_ALLOWED` |
| `{"regions":["LAGOS"]}` from a LAGOS admin | ✅ sends |

A multi-region send is refused **even when it includes their own region** —
that is deliberate, and it is the case your note was about: an admin who
believes they reached three regions and reached one has been misled.

An `ADMIN` is completely unchanged and may still target any combination.

---

## 3. RB-3 — sending an individual broadcast

`REGIONAL_ADMIN` may message distributors in their own region only, on **both**
the single `customerId` and the `customerIds[]` batch form.

**We took your preference: the whole call is rejected, and nothing is sent.**

```json
{
  "message": "1 of 2 recipients are outside your region — nothing was sent.",
  "code": "REGION_NOT_ALLOWED",
  "statusCode": 403
}
```

Your reasoning was right and it is why this differs from O-2 and C-2: a
broadcast is not idempotent, and a half-sent announcement that the sender then
retries double-messages everyone who did receive it. Every recipient's region
is checked **before** anything is written, so a refusal means zero broadcasts,
zero notifications and zero wallet credits. Pinned by a test that asserts the
per-recipient send is never reached.

The message names the count so you can distinguish "none of these are mine"
from "one of twelve slipped in" — but the outcome is the same either way.

---

## 4. RU-1 — the Users list

`managed=true` now means something for a `REGIONAL_ADMIN`. It returns the two
roles they actually manage, scoped to their region.

Verified live as a LAGOS regional admin:

```
GET /admin/officers?managed=true&pageSize=100

total   = 5
roles   = { OFFICER: 3, LOADING_OFFICER: 2 }
regions = { LAGOS: 5 }
```

- **Both** field roles — loading officers are no longer missing from the
  default view.
- **Never** an `ADMIN` or a fellow `REGIONAL_ADMIN`. It is an explicit role
  set, not the full managed list, so those cannot appear.
- **Region is token-derived and applies to the search too** — the region and
  the search predicate are `AND`ed in one query, so a search can only ever
  match rows already inside their region. Spec 40's "including the search
  result" is satisfied.

---

## 5. RU-2 — creating a user

`REGIONAL_ADMIN` may create **`OFFICER` and `LOADING_OFFICER` only**.

```json
{
  "message": "A regional admin cannot create an administrator.",
  "code": "ROLE_NOT_ALLOWED",
  "statusCode": 403
}
```

**Region is derived from the token and overrides whatever is sent** — the
audit rule, as you preferred. Verified live: a regional admin posting
`"region": "NORTH"` got back

```json
{ "id": "f9fe9f93…", "name": "ZZ Probe Officer", "role": "OFFICER", "region": "LAGOS", "emailSent": true }
```

So your hidden region picker and its own-region payload are a no-op in
practice, and a hand-built request cannot place a user elsewhere.

The role check runs **before** the region rules, so attempting to mint an admin
returns `ROLE_NOT_ALLOWED` rather than a confusing region error.

Everything else on the route is unchanged: the same validation, the same
duplicate-email/phone handling, and the welcome email still goes out
(`emailSent`).

---

## 6. RU-3 — editing and deactivating a user

`REGIONAL_ADMIN` is allowed on **both** bodies — `{ isActive }` and the O-1
profile fields — for `OFFICER` and `LOADING_OFFICER` records in their own
region. All four refusals verified live:

| Attempt | Response |
|---|---|
| Edit an `ADMIN` | `403 ROLE_NOT_ALLOWED` — "A regional admin cannot edit an administrator." |
| Edit a fellow `REGIONAL_ADMIN` | `403 ROLE_NOT_ALLOWED` |
| Edit an officer in another region | `403 REGION_NOT_ALLOWED` — "You can only manage users in your own region." |
| Send `region` in the body | `403 REGION_NOT_ALLOWED` — "A regional admin cannot change a user's region." |
| Edit their own in-region officer | ✅ `{ "changed": true }` |

`region` is refused rather than ignored, for the reason you gave: moving a user
out is a transfer into someone else's scope that the receiving region's admin
has not agreed to. You already omit the field, so this only ever fires on a
hand-built request.

**Every existing 409 guard applies unchanged** — `OFFICER_HAS_CUSTOMERS`,
`LAST_ACTIVE_ADMIN`, `SELF_DEACTIVATION` — and so does O-1's `changed: false`
idempotency. The region and role gates run first, so a regional admin never
reaches, say, `LAST_ACTIVE_ADMIN` for an account they could not touch anyway.

### Still ADMIN-only

`DELETE /admin/officers/{id}` and `PATCH /admin/officers/{id}/reassign-customers`,
plus the two bulk routes (`officers/bulk-region`, `customers/bulk-reassign`),
remain organisation-wide operations. Hide them for this role.

---

## 7. RF-1 — product flyers

All four routes now allow `REGIONAL_ADMIN`. `GET`, `POST`, `PATCH` and
`DELETE` verified live (200 on create, edit and delete).

`PATCH /admin/product-flyers/reorder` is included too — reordering is part of
managing them, and leaving it out would have made the list read-only in
practice.

---

## 8. RF-1 — the question you asked us to decide

**We picked (a): flyers stay global, and a regional admin may edit any of
them.** The page is unchanged and simply reachable, exactly as you built it.
No `region` column, no change to the distributor app's carousel contract.

Why: (b) would change the carousel contract as well, and — as you said — that
is not something to infer. It is also a bigger question than it looks. A
nullable `region` needs an answer for "what does a regional admin see in the
list: only their own, or theirs plus the global ones?", and a rule for what
happens to a global flyer's `sortOrder` when regions interleave. None of that
is in spec 40.

**The consequence to be aware of, and worth telling the client:** a regional
admin deleting or deactivating a flyer removes it from **every** distributor's
carousel, nationwide — not just their region's. Under (a) that is
organisation-wide authority handed to a regional role. If that is not what the
client intends, (b) is the answer and we should scope it properly rather than
half-way. Say the word and we will.

---

## 9. RA-O1 — answered

> *May a `REGIONAL_ADMIN` send `region` on `GET /admin/officers`?*

**Yes. It is accepted and ignored.** The region always comes from the token.

So the Officers screen can keep sending it, and the Users screen can send it
too — both are safe, and neither can widen scope. If you would rather drop it,
that is equally fine; the response is identical either way.

Note this **deliberately differs** from `GET /admin/customers`, where a
`region` from a regional admin is a hard `403 REGION_NOT_ALLOWED`. The
inconsistency is pre-existing (the officer picker has always tolerated the
parameter) and we have not changed either, because changing the customers route
would break a working screen and changing this one would break yours. Nothing
leaks either way — scope is read from the token on both.

---

## 10. Error shapes

The three codes from your §3.3, all live:

```json
{ "message": "You can only broadcast to your own region.",        "code": "REGION_NOT_ALLOWED", "statusCode": 403 }
{ "message": "A regional admin cannot create an administrator.",  "code": "ROLE_NOT_ALLOWED",   "statusCode": 403 }
{ "message": "No region is set on your account. Contact an administrator.", "code": "REGION_NOT_SET", "statusCode": 403 }
```

`REGION_NOT_SET` is raised on **every** route in this release when a regional
admin's staff record carries no region — broadcasts, users and history alike —
so `isRegionNotSetError` keeps working everywhere. An unconfigured account is
refused rather than being handed every region, which is the failure mode that
would otherwise look like "it works".

Messages are phrased for the action being refused; branch on `code`.

---

## 11. What did NOT change

For your regression pass:

- **No migration, no schema change.**
- **No route added, removed or renamed.** Authorisation and scoping only.
- **An ADMIN sees no difference anywhere.** Every scope check is skipped
  entirely when the caller is an admin — same history, same totals, same
  create/edit rules, same flyer behaviour.
- **`POST /admin/broadcasts/individual` single-`customerId` form** still
  returns the identical single object.
- **Interaction Audits untouched**, as agreed.
- **The O-1 / B-1 / B-2 behaviour from the last release is unchanged**, and
  still applies per-recipient for a regional admin.

### Test coverage

| Item | Spec file |
|---|---|
| Route authorisation (all seven) | `src/modules/admin/admin.authorization.spec.ts` (updated, 35 tests) |
| RB-2, RB-3, RU-2, RU-3 limits | `src/modules/admin/admin-regional-parity.spec.ts` (12 tests) |

The parity spec pins the **limits**, not the widening — above all that a
regional admin cannot mint or edit an `ADMIN`, which is the one path that would
let them escalate out of their own region.

Two assertions in the existing authorisation spec had to be inverted, since
they encoded the old ADMIN-only rule that RU-2 and RU-3 deliberately change.
They now assert the replacement guarantees instead, so the escalation guard is
still pinned rather than simply deleted.

Full suite: **368 passing, 26 suites.** RB-1, RB-2, RB-3, RU-1, RU-2, RU-3 and
RF-1 were additionally exercised live against the deployment database as a real
LAGOS regional admin, with every probe removed afterwards.
