# Frontend Guide — Interaction Audit & Admin/Regional Admin Interconnection

**Answers:** `BACKEND_API_REQUESTS.md` (raised 22 Aug 2026)
**Backend branch:** `dev`
**Base URL:** every path below is prefixed with `/api/v1`
**Swagger:** `/api/docs` — every route here carries the rules in its description

All nine items are implemented or answered. Section 1 is the summary you can
scan; section 2 tells you what to change per screen and which fallback to
delete; section 3 lists the four behaviour changes that touch code you already
shipped; section 4 is the answer to the two "please confirm" questions.

---

## 1. Summary

| # | What you asked for | Answer | Fallback you can now delete |
|---|---|---|---|
| **AD-T1** | `ADMIN` on `GET /tickets/{id}`, `POST /tickets/{id}/replies`, `PATCH /tickets/{id}/status` | **Done.** `ADMIN` on every ticket; `REGIONAL_ADMIN` on tickets in their own region (403 outside). No `assignedOfficerId` check applies to either. | Ticket modal's API-error branch |
| **AD-C1** | `ADMIN` on `GET /chat/{otherUserId}` and `POST /chat/{receiverId}`, with the admin's own `staffId` | **Done.** `ADMIN` for any customer, `REGIONAL_ADMIN` for their own region. A staff message stores the **sender's own** `staffId`. | Read-only fallback — **show the composer** |
| **AD-S1** | `search` applied to both halves of the union, `meta.total` = filtered size | **Done** (and covered by tests). `search` matches `name`/`erpId` on projected rows and `CUSTOMER_NAME`/`CUSTOMER_CODE` on unprojected ones. | Client-side page filtering |
| **AD-R1** | Confirm unassigned customers work + officer is notified | **Confirmed**, and the response now carries `officerAssignments`. Errors carry `code`. | Nothing — plus you can drop the refetch |
| **RA-T1** | `status` filter on `GET /admin/audit/tickets` | **Done.** Repeatable or comma-separated, `meta.total` counts the filtered set. | Client-side resolved-row filtering |
| **RA-T2** | `REGIONAL_ADMIN` on `GET /admin/audit/tickets`, region-scoped | **Done.** Always scoped to the token's region; `region` you send is overridden, not honoured. | "could not be loaded" branch |
| **RA-C1** | Confirm `REGIONAL_ADMIN` on `GET /admin/customers` | **It was not authorised — now it is.** Token-derived scoping; sending `region` is a `403 REGION_NOT_ALLOWED` as you assumed. `GET /admin/customers/{id}` was already open and stays open. | Nothing — keep the tab strip hidden |
| **RA-O1** | Is `region` accepted on `GET /admin/officers`? | **Accepted and ignored → 200.** Never a 403. Keep sending it or drop it; both work. | n/a |
| **AD-X1** | Confirm `GET /admin/audit/chats/export.csv` | **Exists, and now emits exactly the columns you specified.** Same filters as the list. `REGIONAL_ADMIN` allowed, region-scoped. | Ship the export button |

---

## 1a. If you still get `403 You do not have permission to perform this action.`

That message comes from one place only — the role gate, when the **path you
called** does not list your role. It is never the region check (those say
"Region is derived from your account" / "You can only access customers in your
own region."). Two things produce it for an `ADMIN`:

**1. The server is running an older build.** Restart it. `npm run start:dev`
recompiles on save; `npm run start:prod` serves `dist/`, so it needs
`npm run build` first (already done on this branch). Verify against the
running instance rather than the source:

```bash
curl -s http://localhost:3000/api/docs-json   | jq '.paths["/api/v1/chat/{receiverId}"].post.description'
```

**2. You called a customer-only or officer-only path.** These four keep their
original roles on purpose, and all four answer that exact 403 to an admin:

| Path | Roles | Use instead, as ADMIN / REGIONAL_ADMIN |
|---|---|---|
| `GET /chat/me` | CUSTOMER | `GET /chat/{customerId}` |
| `POST /chat/me` | CUSTOMER | `POST /chat/{customerId}` |
| `PATCH /chat/me/read` | CUSTOMER | — (nothing to mark read; you are not the recipient) |
| `GET /tickets/officer` | OFFICER | `GET /admin/audit/tickets` |

`/chat/me` resolves the thread from `user.id` as the **customer** id, so it can
only ever mean "my own thread as a distributor". An admin has no thread of
their own — that is why it stays closed rather than being widened. Same for
`/tickets/officer`, which lists tickets assigned to the caller as an officer.

If a shared "send message" or "load thread" helper points at `/chat/me`, that
is the fault. The staff paths take the **customer id** in the URL.

---

## 2. Per-item wiring

### AD-T1 — admin ticket thread, reply and status

Three routes, one authorisation rule shared between them:

| Role | Allowed on |
|---|---|
| `CUSTOMER` | their own ticket |
| `OFFICER` | a customer they manage (primary **or** secondary) |
| `ADMIN` | **every** ticket, no assignment check |
| `REGIONAL_ADMIN` | every ticket whose `customer.region` equals their own; `403` outside it |

Unknown ticket → `404 { "message": "Ticket not found" }` on every role. The
`403` body is the standard `{ "message": "Access denied", "statusCode": 403 }`.

**`GET /api/v1/tickets/{id}` → 200** — unchanged shape, exactly as your §3.1.
`description` is always present (render it as the opening message) and
`replies` is oldest-first. `customer` carries `erpId`, `name`, `phone`,
`email`, `region`, `accountStatus`, `outstandingBalance` and
`assignedOfficerId`; auth columns (`password`, `failedLoginAttempts`,
`lockedUntil`) are never serialised.

**`POST /api/v1/tickets/{id}/replies` → 201** — the response is now **the whole
thread**, as you asked, with the new reply already appended, plus a `reply`
key echoing the row that was just created:

```json
{
  "id": "9f1c…", "ticketId": "TCK-00123", "status": "OPEN",
  "customer": { "…": "…" },
  "replies": [ { "id": "4b8e…", "…": "…" }, { "id": "5c9f…", "senderType": "STAFF", "staffId": "1a55…", "content": "Finance has credited the wallet.", "createdAt": "2026-08-22T09:12:00.000Z" } ],
  "reply": { "id": "5c9f…", "senderType": "STAFF", "staffId": "1a55…", "content": "Finance has credited the wallet.", "createdAt": "2026-08-22T09:12:00.000Z" }
}
```

Render straight from it — `setThread(response)` — no refetch. Send
`{ "content": "…" }` and omit `attachmentUrl` when there is none.

> ⚠️ This changed the shape for the officer and customer flows too. See §3.1.

A staff reply is stored with the **author's own** `staffId`, so an admin's
reply shows the admin. `senderType` is `"STAFF"` for `OFFICER`, `ADMIN` and
`REGIONAL_ADMIN` alike, and `"CUSTOMER"` for a distributor.

**`PATCH /api/v1/tickets/{id}/status` → 200** — send `{ "status": "IN_PROGRESS" }`.
The response is the updated ticket, which carries the `id`, `status` and
`updatedAt` your select binds to (plus the rest of the row — a superset of
your §3.3, safe to ignore). An unknown status is a `400` from the validation
pipe, so the select snaps back as designed.

The bug you predicted was real: `PATCH …/status` was previously authorised as
if the caller were an `OFFICER` no matter who they were, so **every** admin
status change answered 403. Fixed.

---

### AD-C1 — admin chat thread and reply

`otherUserId` / `receiverId` is the **customer id** for `OFFICER`, `ADMIN` and
`REGIONAL_ADMIN`. (For a `CUSTOMER` it stays the officer id.)

> The path is `/chat/{customerId}` — **not** `/chat/me`, which is
> CUSTOMER-only and answers `403 You do not have permission to perform this
> action.` to staff. See §1a.

**`GET /api/v1/chat/{customerId}` → 200** — a **bare array**, oldest first,
never a `{ data, meta }` envelope, exactly your §3.4. Staff get the whole
account thread regardless of which officer each message carries, so a
reassignment never hides history.

**`POST /api/v1/chat/{customerId}` → 201** — the **single created message**,
exactly your §3.5:

```json
{ "id": "c3…", "customerId": "bd5d…", "staffId": "1a55…", "senderType": "STAFF",
  "content": "Looking into it now.", "attachmentUrl": null,
  "createdAt": "2026-08-22T09:05:00.000Z", "readAt": null }
```

`staffId` is the **replying admin's** id — confirmed and enforced, so the audit
trail records who actually answered. The distributor still sees the message
under the `"Viju Account Officer"` label (PRD F6); individual staff names are
never exposed to a customer.

Errors: `404 { "message": "Customer not found" }` for an unknown customer;
`403 { "message": "You can only access customers in your own region." }` for a
regional admin reaching outside their region.

**`GET /api/v1/chat/audit/{customerId}` → 200** — the read-only companion, same
bare array and same region rule, now open to `REGIONAL_ADMIN` as well as
`ADMIN`. Use `GET /chat/{customerId}` when you also need to reply.

**Show the composer.** Keep the audit row's message list as the initial paint
if you like, but the live thread and the reply path are both authorised now.

> Note on the audit table: the chat audit groups by *(customer, officer)*, so an
> admin reply creates a conversation row keyed to that admin rather than
> appending to the officer's row. That is the intended consequence of
> attributing the reply correctly — expect a second row per customer once an
> admin has replied.

---

### AD-S1 — search on the union

`GET /api/v1/admin/customers?search=latlek&includeUnprojected=true&page=1&pageSize=20`

`search` is applied to **both** halves:

* projected rows — `name` OR `erpId`, case-insensitive `contains`;
* unprojected rows — `CUSTOMER_NAME` OR `CUSTOMER_CODE` from the ERP feed,
  case-insensitive `ILIKE`.

`meta.total` is `projectedTotal + unprojectedTotal` of the **filtered** union,
and `meta.projectedTotal` / `meta.unprojectedTotal` break it down — so the
arithmetic behind your pager holds. Response shape is your §3.6 unchanged.

Ordering is unchanged: projected rows first in the requested sort order, then
unprojected rows by `erpId`.

Drop the current-page filter and the narrowing label.

---

### AD-R1 — assigning a customer with no officer

**Confirmed (a):** `PATCH /api/v1/admin/customers/{id}/reassign` accepts a
customer with an empty `officerAssignments[]` and a null `assignedOfficerId`.
The join row is *upserted*, so a first assignment and a reassignment take the
same path; there is no source officer to move from.

**Confirmed (b):** the incoming officer is notified on **both** paths. One call
to `NotificationService.notify` writes the bell row (source of truth) and
dispatches the web push to every active token for that officer. Push is
best-effort and never fails the request — if push is down the bell row still
lands.

**Response — 200**, now the richer body you preferred:

```json
{
  "message": "Customer assigned successfully",
  "customerId": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
  "officerAssignments": [
    { "id": "as1f…", "isPrimary": true, "assignedAt": "2026-08-22T09:10:00.000Z",
      "staff": { "id": "7c2a…", "name": "Ifeanyi Okon", "email": "i.okon@viju.com" } }
  ]
}
```

Primary first. Refresh the OFFICERS cell from `officerAssignments` — no refetch.

**Errors** now carry the `code` you branch on:

| Status | Body |
|---|---|
| `404` | `{ "message": "Customer not found", "code": "CUSTOMER_NOT_FOUND" }` |
| `400` | `{ "message": "Officer not found or inactive", "code": "OFFICER_NOT_FOUND" }` — also covers an officer in a different region |
| `409` | `{ "message": "Ifeanyi Okon is already assigned to this customer", "code": "ALREADY_ASSIGNED" }` |

> ⚠️ The success message string and the `409` are both new. See §3.2.

---

### RA-T1 — status filter on the ticket audit

`GET /api/v1/admin/audit/tickets?status=OPEN,IN_PROGRESS,AWAITING_CUSTOMER&page=1&pageSize=20`

* Repeatable (`?status=OPEN&status=IN_PROGRESS`) **or** comma-separated — use
  whichever your query builder emits.
* Case-insensitive, whitespace-trimmed, de-duplicated.
* Omitted → every status, the unchanged default.
* `meta.total` counts the **filtered** set, so page 1 of 20 showing 20 rows out
  of `total: 37` is now literally true.
* The same filter works on `GET /admin/audit/tickets/export.csv`.

Unknown value → **400**, with the message rendered verbatim:

```json
{ "message": "status must be one of: OPEN, IN_PROGRESS, AWAITING_CUSTOMER, RESOLVED",
  "code": "VALIDATION_ERROR", "statusCode": 400 }
```

Envelope and row shape are unchanged (your §3.8), including
`replies[].staff = { id, name }`.

Delete the client-side resolved-row filter and the "n rows hidden" line.

---

### RA-T2 — regional admin on the ticket audit

`REGIONAL_ADMIN` is authorised on all four audit routes now — `GET /admin/audit/tickets`,
`GET /admin/audit/tickets/export.csv`, `GET /admin/audit/chats`,
`GET /admin/audit/chats/export.csv`.

Scoping is **token-derived and overriding**: whatever `region` arrives in the
query string is replaced with the caller's own before the query runs. You are
right not to send it; if you did, it would be ignored rather than honoured.
Every `data[].customer.region` comes back as their own region and `meta.total`
counts that region only.

A region with no tickets returns `data: []` with a valid `meta`
(`total: 0`, `totalPages: 1`) — never a `404`.

One new edge case: a `REGIONAL_ADMIN` whose staff record carries **no region**
cannot be scoped, so rather than showing them every region the request is
refused:

```json
{ "message": "No region is set on your account. Contact an administrator.",
  "code": "REGION_NOT_SET", "statusCode": 403 }
```

This only happens on a misconfigured account. Treat it as an account problem
("no region is set on your account"), not as "no tickets".

---

### RA-C1 — regional admin customer list

Your fix was right, but the premise was not: `GET /admin/customers` was
**ADMIN-only** — the 403 you saw would have happened with or without the
`region` param. It is now authorised for `REGIONAL_ADMIN`:

* No `region` sent → 200, every row in the caller's own region, shape exactly
  your §3.9. Keep the tab strip hidden.
* `region` sent → `403 { "message": "Region is derived from your account", "code": "REGION_NOT_ALLOWED" }`.
  This applies even when the value matches their own region — the parameter is
  refused, not compared, so a wrong value can never look like it worked.
* `REGION_NOT_SET` (see RA-T2) applies here too.

`GET /admin/customers/{id}` was already open to `REGIONAL_ADMIN` with a
region check (403 outside it) and is unchanged.

`outstandingBalance` is a full-precision JSON number
(`-10140600.1232`), never a pre-formatted string — it always was, and there is
nothing rounding it server side. Keep rendering every decimal.

`GET /admin/customers/export.csv` stays **ADMIN-only** — the widening is
confined to the two read routes the regional admin portal calls. Ask if you
need the export there too.

**There is now also a dedicated route** — `GET /api/v1/regional/customers` —
which returns the identical rows and envelope but resolves the region from the
caller instead of the query string, and tolerates `region` when it matches
their own. Prefer it for the regional admin Customers page; full reference in
[`FRONTEND_GUIDE_REGIONAL_CUSTOMERS.md`](./FRONTEND_GUIDE_REGIONAL_CUSTOMERS.md).

---

### RA-O1 — `region` on `GET /admin/officers`

**Answer: `200`. The parameter is accepted and ignored.**

A `REGIONAL_ADMIN` sending `?region=LAGOS` gets the same 200 they get without
it, listing their own region. It is never a `REGION_NOT_ALLOWED` 403. The rule
is deliberately different from `GET /admin/customers` — that route refuses the
parameter, this one tolerates it — because the officer picker has always
accepted it and the screen works today. Nothing leaks either way: the scope is
read from the token in both cases, and a `REGIONAL_ADMIN` cannot widen it.

Also held to the token regardless of the query string: `role` is forced to
`OFFICER` unless you ask for `LOADING_OFFICER`, and `managed` is forced off.
Response shape is your §3.10, unchanged.

You can keep sending `region` or drop it. Dropping it is tidier and matches
what you now do on the customer list.

---

### AD-X1 — chat audit CSV export

`GET /api/v1/admin/audit/chats/export.csv` exists and is wired to the same
filters as `GET /admin/audit/chats`: `region`, `customerName`, `officerName`,
`keyword`, `startDate`, `endDate`, `officerId`, `customerId`. Allowed for
`ADMIN` and, region-scoped, for `REGIONAL_ADMIN`.

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="viju-audit-chats.csv"
```

```csv
Customer,Customer Code,Account Officer,Region,Messages,Last Message
ADLAK,10110003,Ifeanyi Okon,LAGOS,24,2026-08-18T16:40:00.000Z
KJ Fresh Mart,10110044,Chinedu Okafor,LAGOS,3,2026-08-17T11:02:00.000Z
```

One row per conversation, most recently active first, matching the Chat tab.
`Region` is the enum value (`SOUTH_SOUTH`, not `SOUTH-SOUTH`). Values
containing a comma, quote or newline are RFC-4180 quoted. No matches returns
the header row alone with a `200`, never a `404`. Read it as a `Blob` — the
body is CSV, not a JSON envelope.

Ship the export button.

> ⚠️ The columns and the filename changed from what was there before. See §3.3.

---

## 3. Behaviour changes to code you already shipped

Four responses changed shape or wording. Nothing else did.

### 3.1 `POST /tickets/{id}/replies` returns the thread, not the reply

This is what you asked for in AD-T1, but the route is shared with the **officer
web** and the **customer mobile app**, and both of those previously received
the bare `TicketReply`.

| Before | After |
|---|---|
| `{ id: "<replyId>", ticketId, senderType, content, … }` | the full `TicketThread` + `reply: { id: "<replyId>", … }` |

Anything reading `response.id` as a reply id must read `response.reply.id`
instead — `response.id` is now the **ticket** id. Same for `content`,
`senderType` and `createdAt`: they live under `reply`. Please pass this to
whoever owns the mobile app and the officer portal.

### 3.2 `PATCH /admin/customers/{id}/reassign`

* `message` is now `"Customer assigned successfully"` (was
  `"Officer reassigned successfully"`) — the wording your doc documented.
* `customerId` and `officerAssignments` are new additive fields.
* The `400` message changed from a sentence to
  `"Officer not found or inactive"` and every error body gained a `code`.
* **New `409`:** re-sending the officer the customer already holds as primary
  is now refused with `ALREADY_ASSIGNED` instead of quietly succeeding. If any
  screen re-sends the current assignment as an idempotent "save", it will now
  see a 409 — treat it as a no-op, not an error toast.

### 3.3 `GET /admin/audit/chats/export.csv`

* Header row: `threadId,distributorName,region,officerName,messageCount,lastMessageAt`
  → `Customer,Customer Code,Account Officer,Region,Messages,Last Message`.
* Filename: `viju-audit-chats.csv` (was `viju-chats-audit.csv`).
* `Content-Type` now carries `; charset=utf-8`.

`threadId` is gone from the export. It is still on every row of
`GET /admin/audit/chats` as `data[].id` (`"<customerId>:<staffId>"`) if you
need it.

The ticket export (`/admin/audit/tickets/export.csv`) is **unchanged** —
columns and `viju-tickets-audit.csv` filename both as before.

### 3.4 New `403` on region-scoped routes

`REGION_NOT_SET` (§RA-T2) can now come back from `GET /admin/customers`,
`GET /admin/audit/tickets`, `GET /admin/audit/chats` and both audit CSV
exports, for a `REGIONAL_ADMIN` whose staff record has no region. Previously
such an account would have been shown **every** region. Surface it as an
account-configuration message.

---

## 4. Quick reference

| Route | Roles | Region rule |
|---|---|---|
| `GET /tickets/{id}` | CUSTOMER, OFFICER, ADMIN, REGIONAL_ADMIN | RA: own region only (403) |
| `POST /tickets/{id}/replies` | CUSTOMER, OFFICER, ADMIN, REGIONAL_ADMIN | RA: own region only (403) |
| `PATCH /tickets/{id}/status` | OFFICER, ADMIN, REGIONAL_ADMIN | RA: own region only (403) |
| `GET /chat/{customerId}` | CUSTOMER, OFFICER, ADMIN, REGIONAL_ADMIN | RA: own region only (403) |
| `POST /chat/{customerId}` | CUSTOMER, OFFICER, ADMIN, REGIONAL_ADMIN | RA: own region only (403) |
| `GET /chat/audit/{customerId}` | ADMIN, REGIONAL_ADMIN | RA: own region only (403) |
| `GET` / `POST /chat/me`, `PATCH /chat/me/read` | CUSTOMER | staff use `/chat/{customerId}` |
| `GET /tickets/officer` | OFFICER | staff use `/admin/audit/tickets` |
| `GET /admin/customers` | ADMIN, REGIONAL_ADMIN | RA: token-derived; sending `region` → 403 |
| `GET /admin/customers/{id}` | ADMIN, REGIONAL_ADMIN | RA: own region only (403) |
| `GET /admin/customers/export.csv` | ADMIN | — |
| `PATCH /admin/customers/{id}/reassign` | ADMIN | — |
| `GET /admin/officers` | ADMIN, REGIONAL_ADMIN | RA: token-derived; `region` accepted and **ignored** |
| `GET /admin/audit/tickets` | ADMIN, REGIONAL_ADMIN | RA: token-derived, overrides any `region` sent |
| `GET /admin/audit/tickets/export.csv` | ADMIN, REGIONAL_ADMIN | same |
| `GET /admin/audit/chats` | ADMIN, REGIONAL_ADMIN | same |
| `GET /admin/audit/chats/export.csv` | ADMIN, REGIONAL_ADMIN | same |
| `GET /chat/audit/{customerId}` | ADMIN, REGIONAL_ADMIN | RA: own region only (403) |
| `GET /regional/customers` | REGIONAL_ADMIN, ADMIN | RA: own region; own region tolerated in `region`, other region 403. ADMIN must send `region` |

### Error codes introduced or formalised

| `code` | Status | Where |
|---|---|---|
| `VALIDATION_ERROR` | 400 | unknown `status` on the ticket audit |
| `CUSTOMER_NOT_FOUND` | 404 | reassign |
| `OFFICER_NOT_FOUND` | 400 | reassign |
| `ALREADY_ASSIGNED` | 409 | reassign |
| `REGION_NOT_ALLOWED` | 403 | `region` sent by a REGIONAL_ADMIN on `GET /admin/customers` |
| `REGION_NOT_SET` | 403 | REGIONAL_ADMIN with no region on their staff record |

Every error body is `{ message, code, statusCode }`. Branch on `code`;
`message` is safe to display.
