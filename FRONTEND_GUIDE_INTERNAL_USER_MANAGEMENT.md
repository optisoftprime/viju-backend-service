# Frontend guide — internally managed users (Admin, Regional Admin, Account Officer, Loading Officer)

**For:** Viju Customer Portal — **Web** (Admin Portal, Regional Portal, Officer Portal)
**Implements:** PRD "Change in User Source"
**Status:** shipped on the backend
**Date:** 21 Aug 2026

---

## 1. What changed, in one paragraph

Four staff roles — **ADMIN**, **REGIONAL_ADMIN**, **OFFICER** (account officer) and
**LOADING_OFFICER** — are no longer sourced from the ERP. An **ADMIN** now creates,
deactivates and reactivates them, and the service database is the source of truth for
their name, role, region and account status. The ERP can no longer create one, resurrect
one an admin deactivated, or overwrite a role or region. Every other ERP sync (customers,
balances, purchases, payments, stock, order status, default-officer assignment) is
untouched.

Two things you must action:

1. **The staff login form is now Email + Password** for these four roles, not ERP
   username + code (§3). The endpoint and payload keys are unchanged.
2. **The create-officer screen becomes create-user** — it grows a role picker and a
   region rule (§5).

Everything else in this guide is additive: new optional query params and new response
fields. **No existing request or response field was removed or renamed.**

---

## 2. Role vocabulary — read this first

The PRD says *Account Officer*. The API has always called it **`OFFICER`** and still does.

| PRD name | API value | Notes |
|---|---|---|
| Admin | `ADMIN` | Organisation-wide. **Never** carries a region. |
| Regional Admin | `REGIONAL_ADMIN` | Region-scoped. |
| Account Officer | `OFFICER` | Region-scoped. **This is the value you send and receive.** |
| Loading Officer | `LOADING_OFFICER` | Region-scoped. |
| — | `WAREHOUSE_OFFICER` | **Still ERP-managed.** Not creatable, not deactivatable here. |

`ACCOUNT_OFFICER` is accepted as an input alias **on `POST /admin/officers` only**. It is
stored and returned as `OFFICER`. Sending `role=ACCOUNT_OFFICER` to the *list* endpoint is
a `400` — use `OFFICER` there.

> **Don't hardcode the label from the value.** Keep a display map:
> `OFFICER → "Account Officer"`, `REGIONAL_ADMIN → "Regional Admin"`, etc.

Base path for everything below: **`/api/v1`**. All admin routes need
`Authorization: Bearer <jwt>`.

---

## 3. Login — the one breaking UX change

### 3.1 What to change

`POST /auth/staff/web-login` still takes `{ "username": "...", "code": "..." }`. **The
payload keys did not change.** What changed is what belongs in them:

| User | `username` | `code` |
|---|---|---|
| ADMIN, REGIONAL_ADMIN, OFFICER, LOADING_OFFICER | their **email address** | their **password** |
| WAREHOUSE_OFFICER | ERP username (unchanged) | ERP code (unchanged) |

So: **relabel the two login fields to "Email" and "Password"**, set
`type="email"` / `type="password"`, and keep posting them as `username` / `code`. One form
still serves both populations — the backend decides which path to take from the account it
finds.

`POST /auth/staff/login` with `{ "email", "password" }` also works for these users if you
prefer a dedicated route. Both return the identical token payload.

### 3.2 Login responses to handle

```jsonc
// 200
{
  "access_token": "…",
  "refresh_token": "…",
  "expires_in": 3600,
  "refresh_expires_in": 2592000,
  "user": { "id": "…", "name": "…", "role": "OFFICER", "email": "…", "region": "LAGOS" }
}
```

| Status | `message` | What it means | What to show |
|---|---|---|---|
| `401` | `Invalid username or code.` | Wrong email or password. | "Incorrect email or password." |
| `401` | `No account exists for these credentials. Ask an administrator to create one.` | ERP credentials were presented for one of the four managed roles, and no local account exists. The ERP no longer provisions these. | Render the message verbatim. |
| `401` | `This account has no password yet. Use "Forgot password" to set one, or contact an administrator.` | A pre-existing account that used to authenticate straight against the ERP. | Render verbatim **and** surface the "Forgot password" link prominently. |
| `403` | `This account has been deactivated. Contact an administrator.` | Admin deactivated them. | Render verbatim. Do not retry. |

> **Migration note — flag this to ops before go-live.** Staff who exist today but have
> never had a local password will hit the third row above. The recovery path is the
> existing 3-step reset flow (`/auth/staff/password-reset/request` →
> `/verify-otp` → `/reset`), which works off their email or phone. Nothing in that
> flow changed.

### 3.3 A wrong password never falls through to the ERP

Previously a failed local check could still be tried against the ERP. It cannot any more —
for a managed account, the local password is the only credential that works. If your login
screen has any "try again as ERP user" affordance, remove it.

---

## 4. Who can do what

| Action | ADMIN | REGIONAL_ADMIN | OFFICER | LOADING_OFFICER |
|---|:--:|:--:|:--:|:--:|
| Create a managed user | ✅ | ❌ | ❌ | ❌ |
| Deactivate / reactivate | ✅ | ❌ | ❌ | ❌ |
| List `OFFICER` / `LOADING_OFFICER` | ✅ | ✅ *(own region)* | ❌ | ❌ |
| List `ADMIN` / `REGIONAL_ADMIN` | ✅ | ❌ | ❌ | ❌ |
| Open a user's detail | ✅ | ✅ *(own region, `OFFICER` / `LOADING_OFFICER` only)* | ❌ | ❌ |

Every one of these is enforced server-side. Hiding a button is a UX nicety, not a control —
a non-admin hitting the route gets:

```jsonc
// 403
{ "message": "You do not have permission to perform this action.", "statusCode": 403 }
```

**Read the caller's role from `GET /users/me` or from `user.role` in the login response —
never from anything you can set locally.** A `role` in a request body is ignored for
authorization purposes; it only ever selects which role to *provision* in §5.

**Regional Portal, note:** `GET /admin/officers` silently clamps a `REGIONAL_ADMIN` to
their own token region and to `role=OFFICER` / `role=LOADING_OFFICER`. Sending
`region=NORTH&role=ADMIN&managed=true` as a regional admin does not error — it returns
their own region's officers. Don't build a UI that implies otherwise.

---

## 5. Create a managed user

### `POST /api/v1/admin/officers` → `201`

Same route the create-officer screen already calls. It now takes an optional `role`.

```jsonc
{
  "name": "Ifeanyi Okon",
  "email": "i.okon@viju.com",
  "phone": "+2348012345678",
  "role": "LOADING_OFFICER",   // optional — omit for OFFICER
  "region": "LAGOS",           // see the region rule below
  "password": "TempPass123"
}
```

| Field | Required | Rules |
|---|---|---|
| `name` | yes | Trimmed. 2–120 chars. Whitespace-only is rejected. |
| `email` | yes | Valid email, ≤ 255 chars. **Lower-cased server-side** — render `response.email`, not what was typed. |
| `phone` | yes | `^\+?[0-9][0-9\s-]{6,19}$` — optional leading `+`, then 7–20 characters that must start with a digit and may contain digits, spaces and hyphens. No parentheses. Note separators eat into the 20, so strip them client-side. |
| `role` | no | `ADMIN` \| `REGIONAL_ADMIN` \| `OFFICER` \| `ACCOUNT_OFFICER` \| `LOADING_OFFICER`. Defaults to `OFFICER`. |
| `region` | conditional | **Required** for `REGIONAL_ADMIN`, `OFFICER`, `LOADING_OFFICER`. **Must be omitted** for `ADMIN`. |
| `password` | yes | 8–72 chars. Emailed to the user verbatim — treat as one-time. |

> **Send nothing else.** The API rejects any property it does not declare. `id`,
> `isActive`, `erpCode`, `createdById`, `username` and friends are **not** settable by the
> client; including one fails the whole request with a `400`. If your form serialises a
> whole model object, strip it to exactly the six keys above.

Make the region field react to the role picker: enabled and required for the three
region-scoped roles, hidden/disabled and **not sent** when `ADMIN` is selected.

### Response

```jsonc
// 201
{
  "id": "e3f1…",
  "name": "Ifeanyi Okon",
  "email": "i.okon@viju.com",
  "phone": "+2348012345678",
  "region": "LAGOS",
  "role": "LOADING_OFFICER",
  "isActive": true,
  "createdAt": "2026-08-21T10:00:00.000Z",
  "createdById": "admin-uuid-1",
  "emailSent": true
}
```

`emailSent` is unchanged in meaning: the account is created either way. When it's `false`,
soften the toast — *"User created. The credentials email could not be sent; pass the
password on directly."*

### Errors

Two shapes. Field-validation failures come from the pipe and carry a **`message` array**;
business rules carry a **`message` string plus a `code`**.

```jsonc
// 400 — validation
{ "message": ["email must be a valid email address", "password is required"],
  "error": "Bad Request", "statusCode": 400 }

// 400 — business rule
{ "message": "Email already in use", "code": "EMAIL_IN_USE", "field": "email", "statusCode": 400 }
```

Handle `Array.isArray(body.message)` before rendering.

| `code` | Message | Cause |
|---|---|---|
| `EMAIL_IN_USE` | `Email already in use` | Duplicate email (case-insensitive). Attach to the email field. |
| `PHONE_IN_USE` | `Phone number already in use` | Duplicate phone. Attach to the phone field. |
| `ROLE_NOT_SUPPORTED` | `role must be one of: …` | An unsupported role, including `WAREHOUSE_OFFICER`. |
| `REGION_REQUIRED` | `region is required for OFFICER.` | Region-scoped role with no region. |
| `REGION_NOT_ALLOWED` | `An ADMIN is organisation-wide and cannot be scoped to a region.` | Region sent with `ADMIN`. |

`EMAIL_IN_USE` / `PHONE_IN_USE` also arrive when two admins submit the same address at the
same moment — the duplicate is caught by the database constraint, not just the pre-check.
Treat it as a normal field error, not a race to retry.

`field` tells you which input to highlight. The `message` wording for the duplicate cases
is byte-identical to before, so existing string handling keeps working.

---

## 6. List and view managed users

### `GET /api/v1/admin/officers`

Same route, same default behaviour. New optional params:

| Param | Type | Notes |
|---|---|---|
| `role` | `StaffRole` | Defaults to `OFFICER`. Now also accepts `ADMIN` / `REGIONAL_ADMIN` for an ADMIN caller. `ACCOUNT_OFFICER` is **not** valid here. |
| `managed` | `true` \| `false` | **New.** `true` returns all four managed roles in one page, overriding `role`. ADMIN only — ignored for a regional admin. |
| `isActive` | `true` \| `false` | **New.** Filter by status. Omit for both — that is the unchanged default. |
| `region`, `search`, `sortBy`, `sortOrder`, `page`, `pageSize` | | Unchanged. |

Booleans accept `true` / `false` / `1` / `0`; anything else is a `400`.

Each row gains three fields — **existing fields are unchanged**:

```jsonc
{
  "data": [{
    "id": "…", "name": "…", "email": "…", "phone": "…",
    "region": "LAGOS",
    "role": "OFFICER",                 // ← new: needed once `managed=true` mixes roles
    "isActive": true,
    "createdAt": "…",
    "lastLoginAt": null,
    "deactivatedAt": null,             // ← new
    "reactivatedAt": null,             // ← new
    "_count": { "customers": 12, "supportTickets": 3 }
  }],
  "meta": { "total": 40, "page": 1, "pageSize": 20, "totalPages": 2,
            "hasNextPage": true, "hasPreviousPage": false }
}
```

A **Users** screen is `?managed=true&page=1&pageSize=20` with a role column and a status
filter. The existing **Officers** screen needs no change at all.

### `GET /api/v1/admin/officers/{id}`

Everything it returned before, plus the audit block:

```jsonc
{
  "id": "…", "name": "…", "email": "…", "phone": "…",
  "region": "LAGOS", "role": "OFFICER", "isActive": false,
  "lastLoginAt": "2026-08-18T09:13:00.000Z",
  "createdAt": "2026-01-12T08:00:00.000Z",

  "isManaged": true,                                     // ← new
  "createdBy":     { "id": "…", "name": "Grace Adeyemi", "email": "grace@viju.com" },
  "deactivatedAt": "2026-08-20T14:02:00.000Z",
  "deactivatedBy": { "id": "…", "name": "Grace Adeyemi", "email": "grace@viju.com" },
  "reactivatedAt": null,
  "reactivatedBy": null,

  "_count": { "customers": 0, "supportTickets": 0, "chatThreads": 4 },
  "customers": [ /* … */ ],
  "distributors": 0, "openTickets": 0
}
```

**`isManaged` is the flag to gate your UI on.** Render the Deactivate / Reactivate controls
only when `isManaged === true`; a `WAREHOUSE_OFFICER` is `false` and the backend will
refuse the call. Every `*By` object is nullable — accounts that predate this change have
`createdBy: null`, and an admin whose own record was removed leaves `null` behind. Fall
back to "—", never to "Unknown admin".

---

## 7. Deactivate and reactivate

### `PATCH /api/v1/admin/officers/{id}` → `200`

```jsonc
{ "isActive": false }   // deactivate
{ "isActive": true }    // reactivate
```

Same route and body as today. `isActive` must be a real boolean — `"false"` as a string is
a `400`.

```jsonc
// 200
{
  "id": "…", "name": "…", "email": "…", "phone": "…",
  "region": "LAGOS", "role": "OFFICER",
  "isActive": false,
  "changed": true,                                // ← new
  "deactivatedAt": "2026-08-21T10:30:00.000Z",    // ← new
  "deactivatedById": "admin-uuid-1",              // ← new
  "reactivatedAt": null,                          // ← new
  "reactivatedById": null,                        // ← new
  "updatedAt": "2026-08-21T10:30:00.000Z"
}
```

### `changed` — the idempotency flag

Sending a status the user already has is **not an error**. You get `200` with
`changed: false`, and no audit stamp is written.

```js
if (res.changed) toast(res.isActive ? 'User reactivated.' : 'User deactivated.');
else             toast(res.isActive ? 'User is already active.' : 'User is already inactive.');
```

This is what makes a double-click, a retry after a flaky connection, and two admins
clicking at once all safe. **Do not** pre-check the current status and skip the call — just
send it and read `changed`. Still disable the button while the request is in flight, for
the usual reasons.

### Errors

| Status | `code` | When | Suggested UI |
|---|---|---|---|
| `404` | — (`message: "Officer not found"`) | Unknown or deleted id. | "That user no longer exists." Refresh the list. |
| `400` | `ROLE_NOT_MANAGED` | Target is `WAREHOUSE_OFFICER`. | Shouldn't happen if you gate on `isManaged`. Render the message. |
| `400` | `SELF_DEACTIVATION` | An admin tried to deactivate themselves. | Disable the control on your own row too. |
| `409` | `OFFICER_HAS_CUSTOMERS` | An account officer still holds customers. | See below — unchanged behaviour. |
| `409` | `LAST_ACTIVE_ADMIN` | Deactivating the only remaining active admin. Defensive — `SELF_DEACTIVATION` fires first in practice, so you are unlikely to see it. Handle it generically. | Render the message. |
| `403` | — | Caller isn't an ADMIN. | Render verbatim. |

`OFFICER_HAS_CUSTOMERS` is exactly as before, count included:

```jsonc
{ "message": "Reassign this officer's 14 customers before deactivating.",
  "code": "OFFICER_HAS_CUSTOMERS", "assignedCustomers": 14, "statusCode": 409 }
```

Keep the existing flow: show the count, send the admin to
`PATCH /admin/officers/{id}/reassign-customers`, retry. Note this check applies to
**`OFFICER` only** — `ADMIN`, `REGIONAL_ADMIN` and `LOADING_OFFICER` hold no customer
portfolio and deactivate straight away.

`DELETE /admin/officers/{id}` still works and still only deactivates. It stays deprecated —
prefer the `PATCH`.

### What deactivation does to the target's session

The moment a deactivation succeeds:

- every one of that user's refresh tokens is revoked, in the same transaction;
- their **still-unexpired access token stops working on the very next request**.

So a deactivated user who has the portal open will start getting failures immediately, not
at the end of their token's lifetime. Two different statuses carry the same message:

| Where | Status | `message` |
|---|---|---|
| Any authenticated request | `401` | `This account has been deactivated. Contact an administrator.` |
| `POST /auth/refresh` | `403` | same |

**Your global interceptor must handle both.** Recommended: if a `401` or `403` carries that
exact message, clear the session, redirect to login, and show the message on the login
screen — do **not** attempt a token refresh, and do not show a generic "session expired",
which would send the user in a pointless retry loop.

Nothing is deleted. The account, its role, its region, its chat threads, its tickets and
its history all survive, and reactivation restores access with the same permissions. Keep
deactivated users visible in audit views — the backend still returns their history.

---

## 8. Suggested rollout order

1. **Ship the login relabel and the 401/403 interceptor first** (§3, §7). These are the
   only changes that affect users who are already signed in.
2. Add the role picker + region rule to the create screen (§5).
3. Add the `role`, `deactivatedAt`, `reactivatedAt` columns and the `isActive` filter to
   the officers list (§6). Safe to ship independently — the fields are already being
   returned.
4. Add the Users screen (`managed=true`) and the audit block on the detail view (§6).

Steps 2–4 are additive and can land in any order.

---

## 9. What did **not** change

- No endpoint was removed, renamed or moved.
- No request field was removed or made required that wasn't already.
- No response field was removed or renamed. Everything new is additive.
- `POST /admin/officers` with the old five-field body still creates an account officer,
  exactly as before.
- `PATCH /admin/officers/{id}` with `{"isActive": false}` still deactivates, and still
  returns `409 OFFICER_HAS_CUSTOMERS` with the same message and count.
- The whole password-reset flow is unchanged.
- Customer-facing endpoints, the ERP sync endpoints, and every region-scoping rule
  (RA-03 / RA-05 / RA-06) are unchanged.

---

## 10. Quick reference

| Need | Call |
|---|---|
| Sign in (all four roles) | `POST /auth/staff/web-login` `{ username: <email>, code: <password> }` |
| Who am I | `GET /users/me` |
| Create a user | `POST /admin/officers` `{ name, email, phone, role?, region?, password }` |
| List account officers (unchanged) | `GET /admin/officers` |
| List all managed users | `GET /admin/officers?managed=true` |
| List deactivated users | `GET /admin/officers?managed=true&isActive=false` |
| User detail + audit trail | `GET /admin/officers/{id}` |
| Deactivate | `PATCH /admin/officers/{id}` `{ "isActive": false }` |
| Reactivate | `PATCH /admin/officers/{id}` `{ "isActive": true }` |
| Move a portfolio before deactivating | `PATCH /admin/officers/{id}/reassign-customers` |

Live schemas and examples: **`/api/docs`** (Swagger — note: no `/v1`, unlike the routes
themselves). Anything ambiguous here, the Swagger page is authoritative.
