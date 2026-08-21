# Frontend guide — listing every customer the dashboard tile counts

**For:** Viju Customer Portal — Admin Web
**Answers:** `BACKEND_REQUEST_CUSTOMER_LIST_PARITY.md`
**Status:** shipped on the backend — `includeUnprojected` is live on `GET /admin/customers`
**Date:** 20 Aug 2026

---

## 1. What changed, in one paragraph

`GET /admin/customers` accepts a new optional query param, **`includeUnprojected`**.
Leave it off and nothing changes. Set it to `true` and the result set becomes the
union of portal customers and ERP customers that have not been copied into the
portal yet — so `meta.total` matches the **Total Customers** tile and the table
can page through all of them. Every row gains an **`isProjected`** flag, and
`meta` gains **`projectedTotal`** / **`unprojectedTotal`**.

This is Option A from your §3.2, implemented as specified. Option B
(`/admin/erp/customers`) was not built — say the word if you still want it.

> **Read §7 before you plan the rollout.** Your §3.1 assumed the projection job
> just needs running. It does not: the ERP data currently *cannot* be projected.
> That changes `includeUnprojected` from a few-day stopgap into the working
> solution for the foreseeable future.

---

## 2. The request

```
GET /api/v1/admin/customers?page=1&pageSize=20&includeUnprojected=true
Authorization: Bearer <admin jwt>
```

| Param | Type | Notes |
|---|---|---|
| `includeUnprojected` | `true` \| `false` | **New.** Default `false`. Accepts `true`, `false`, `1`, `0`. Anything else → `400`. |
| `page` | int ≥ 1 | Default 1. |
| `pageSize` | positive int | Default 20, clamped server-side to **200**. Read `meta.pageSize` for the applied value. |
| `search` | string | Matches name or `erpId`, case-insensitive. Applies to **both** sides. |
| `region` | `LAGOS` \| `EASTERN` \| `SOUTH_SOUTH` \| `WESTERN` \| `NORTH` | Applies to **both** sides. |
| `hasOfficer` | `true` \| `false` | See §6 — `true` collapses the result to projected rows only. |
| `sortBy` / `sortOrder` | see §6 | Sorts the projected block only while unprojected rows exist. |

Role: `ADMIN`. Unchanged — this endpoint has always been admin-only, so there is
no region-scoping change to absorb.

---

## 3. The response

### Default mode (`includeUnprojected` absent or `false`)

Byte-for-byte what you get today, plus `isProjected: true` on each row.

```jsonc
{
  "data": [ /* … */ ],
  "meta": {
    "total": 4, "page": 1, "pageSize": 20,
    "totalPages": 1, "hasNextPage": false, "hasPreviousPage": false
  }
}
```

`projectedTotal` and `unprojectedTotal` are **absent** in this mode — don't read
them unconditionally.

### Union mode (`includeUnprojected=true`)

```jsonc
{
  "data": [ /* projected rows first, then unprojected — see §5 */ ],
  "meta": {
    "total": 1851,            // ← equals the dashboard tile
    "page": 1, "pageSize": 20,
    "totalPages": 93, "hasNextPage": true, "hasPreviousPage": false,
    "projectedTotal": 4,      // rows with a portal record
    "unprojectedTotal": 1847  // ERP-only rows; reaches 0 when projection works
  }
}
```

### A projected row (`isProjected: true`)

Real response from dev, unchanged from today apart from the new flag:

```jsonc
{
  "id": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
  "name": "ADLAK",
  "erpId": "10110003",
  "phone": "+2348168584112",
  "region": "LAGOS",
  "accountStatus": "ACTIVE",
  "outstandingBalance": -10140600.1232,
  "assignedOfficerId": null,
  "createdAt": "2026-08-13T14:06:51.169Z",
  "_count": { "supportTickets": 0 },
  "officerAssignments": [],
  "hasOfficer": false,
  "stockBalanceCartons": 0,
  "lastSyncedAt": "2026-08-16T23:01:03.287Z",
  "isProjected": true
}
```

### An unprojected row (`isProjected: false`)

Real response from dev. Every field the ERP customer master does not carry is an
explicit `null` — never omitted, so you never have to tell "absent" from "unknown":

```jsonc
{
  "id": null,
  "erpId": "10110200",
  "name": "VIJU-A-SOLARS TRADE",
  "phone": "0913580925",
  "region": "LAGOS",
  "accountStatus": null,
  "outstandingBalance": null,
  "stockBalanceCartons": null,
  "assignedOfficerId": null,
  "hasOfficer": false,
  "officerAssignments": [],
  "_count": { "supportTickets": 0 },
  "createdAt": null,
  "lastSyncedAt": "2026-08-17T05:01:46.623Z",
  "isProjected": false
}
```

Only four fields are ever populated on an unprojected row: `erpId`, `name`,
`phone`, `region` — plus `lastSyncedAt` for ERP freshness.

---

## 4. Types

```ts
type Region = 'LAGOS' | 'EASTERN' | 'SOUTH_SOUTH' | 'WESTERN' | 'NORTH';

interface CustomerListItem {
  id: string | null;                 // null when isProjected === false
  erpId: string;
  name: string;
  phone: string;
  region: Region;
  accountStatus: 'ACTIVE' | 'ON_HOLD' | null;
  outstandingBalance: number | null;
  stockBalanceCartons: number | null;
  assignedOfficerId: string | null;
  hasOfficer: boolean;
  officerAssignments: Array<{ staff: { id: string; name: string; email: string } }>;
  _count: { supportTickets: number };
  createdAt: string | null;          // ISO-8601
  lastSyncedAt: string | null;       // ISO-8601
  isProjected: boolean;
}

interface CustomerListMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  projectedTotal?: number;           // only when includeUnprojected=true
  unprojectedTotal?: number;         // only when includeUnprojected=true
}
```

A narrowing helper keeps the null-handling honest and stops `id!` creeping in:

```ts
type ProjectedCustomer = CustomerListItem & { id: string; isProjected: true };

const isProjected = (c: CustomerListItem): c is ProjectedCustomer => c.isProjected;
```

---

## 5. Implementing the All Customers modal

### 5.1 Turn the flag on

```ts
const params = new URLSearchParams({
  page: String(page),
  pageSize: String(pageSize),
  includeUnprojected: 'true',
  ...(search ? { search } : {}),
  ...(region ? { region } : {}),
});
const res = await api.get(`/admin/customers?${params}`);
```

That is the whole integration. `meta.total` is now 1,851 and paging is
arithmetically correct across all 93 pages — no empty pages, no gaps, no
duplicates.

### 5.2 Key rows on `erpId`, not `id`

`id` is `null` for 1,847 of the rows, so it is unusable as a React key. `erpId`
is unique across the union and stable:

```tsx
{rows.map((c) => <CustomerRow key={c.erpId} customer={c} />)}
```

### 5.3 Render the two kinds differently

Grey the ERP-only rows and label them, as you planned:

```tsx
<tr className={c.isProjected ? undefined : 'opacity-60'}>
  <td>{c.erpId}</td>
  <td>
    {c.name}
    {!c.isProjected && <Badge title="In the ERP, not yet in the portal">ERP only</Badge>}
  </td>
  <td>{c.region}</td>
  <td>{c.outstandingBalance === null ? '—' : formatNaira(c.outstandingBalance)}</td>
  <td>{c.accountStatus ?? '—'}</td>
</tr>
```

Render every nullable field through a single `—` fallback rather than checking
`isProjected` per cell. Two reasons: `lastSyncedAt` can legitimately be `null` on
a *projected* row too, and when projection eventually runs the fallbacks simply
stop firing with no code change.

### 5.4 Disable what needs a local record

Anything keyed on `id` is unavailable for an unprojected row. Gate on
`isProjected`, not on `id !== null`, so intent is obvious at the call site:

| Action | Endpoint | On an unprojected row |
|---|---|---|
| Open customer detail | `GET /admin/customers/:id` | disable — no `id` |
| Assign / reassign officer | `PATCH /admin/customers/:id/reassign` | disable — no `id` |
| Target an individual broadcast | `POST /admin/broadcasts/individual` | disable — needs `customerId` |
| View statements / tickets | various | disable — no local record |

A tooltip such as *"This distributor is in the ERP but not yet in the portal"*
explains the greyed state without the user filing a bug.

### 5.5 Replace the interim banner

Drive the notice off `meta` instead of hard-coded numbers, and hide it entirely
once the gap closes:

```tsx
{meta.unprojectedTotal > 0 && (
  <Notice>
    Showing all {meta.total.toLocaleString()} customers.{' '}
    {meta.unprojectedTotal.toLocaleString()} are in the ERP but not yet in the
    portal — greyed rows are read-only until they are.
  </Notice>
)}
```

When `unprojectedTotal` reaches `0`, the notice disappears, every row is
`isProjected: true`, and the screen becomes the plain customer list with no
further work on your side.

### 5.6 Wire the tile

The tile reads `totalCustomers` from `GET /admin/dashboard`; the modal now reads
`meta.total`. With the flag on they are the same number by construction. If they
ever diverge again, that is a backend bug worth raising — don't paper over it
client-side.

---

## 6. How it interacts with the params you already send

**`search` and `region`** apply to both sides. Verified on dev:
`region=LAGOS` → 731 unprojected (734 in the ERP, minus the 3 already projected);
`search=LAT` → 19.

**`hasOfficer=true`** returns projected rows only, and `unprojectedTotal` comes
back `0`. An ERP-only row has no portal record and therefore can never have an
officer — including it would inflate `total` with rows the filter can't match.
`hasOfficer=false` includes them (they're all unassigned).

**`sortBy` / `sortOrder`** sort the **projected block only**; unprojected rows
always follow, ordered by `erpId`. The two sides don't share columns — an ERP row
has no balance, ticket count or `createdAt` — so a merged sort would be ordering
on values that exist for a fraction of the set. Today that means sorting by
"Outstanding balance" visibly reorders only the first 4 rows. Your options:

- leave sorting enabled and accept it (it becomes fully correct the moment
  `unprojectedTotal` hits 0), or
- hide the sort affordances while `unprojectedTotal > 0`, or
- offer sorting only in the default (projected-only) view.

We'd suggest the first — it degrades gracefully and needs no cleanup later.

**CSV export** (`GET /admin/customers/export.csv`) does **not** support
`includeUnprojected`; it exports projected customers only. Ask if you need the
union there and we'll add it.

---

## 7. Why the 1,847 are not simply "not copied yet"

Your §3.1 asked us to run `project:customer`, expecting the gap to close. We
investigated, and the job is not the blocker — the data is.

**All 1,851 Viju-region ERP customers carry only 5 distinct phone numbers. One
value, `0913580925`, is on 1,847 of them.**

`Customer.phone` is a **unique** column in the portal database, so those rows
cannot be inserted: the first succeeds and the remaining 1,846 collide. That also
explains the number 4 — the four customers already in the portal are precisely
the four with genuinely distinct phone numbers.

Relaxing the constraint is not a safe workaround. Customer login resolves an
account by phone number (`/auth/customer/request-otp`, `/auth/customer/login`).
With 1,847 distributors sharing one number, phone-based OTP login could not tell
which distributor was signing in.

**This needs real phone numbers in the ERP customer master.** It is not a portal
change, and it is not a quick one. Supporting detail for whoever chases the ERP
team:

- `project:customer` reports `SUCCESS` with `rows_fetched: 0`, and all 3,747 raw
  customer rows have both `projected_at` **and** `project_error` set to `NULL` —
  the job has never attempted a single row, so it is not failing per row.
- There is no `sync_cursor` entry for `project:customer`.
- Many `ingest:*` runs are stuck in `RUNNING` with no finish time, including
  `ingest:customer`. The customer feed itself last changed on 17 Aug 2026.

**Plan accordingly:** treat `includeUnprojected` as the working solution, not a
few-day stopgap. Everything in §5 is written so that the day projection does
start working, the screen needs no changes — the banner hides itself and the
greyed rows light up.

---

## 8. Errors

| Status | When | Body |
|---|---|---|
| `400` | `includeUnprojected` is not `true`/`false`/`1`/`0`; unknown `sortBy`; bad `region` | `{ "message": ["includeUnprojected must be a boolean value"], "error": "Bad Request", "statusCode": 400 }` |
| `401` | missing/expired bearer token | `{ "statusCode": 401, "message": "Unauthorized" }` |
| `403` | non-admin token | `{ "statusCode": 403, "message": "Forbidden resource", "error": "Forbidden" }` |

An empty result is `data: []` with a valid `meta` — never a `404`.

---

## 9. Environments without the ERP feed

Local and CI databases have no `erp_raw` schema. There, `includeUnprojected=true`
degrades cleanly: `unprojectedTotal` is `0` and the response equals default mode.
So don't treat "the extra meta keys are present" as "there are ERP rows" — branch
on `unprojectedTotal > 0`, as §5.5 does.

---

## 10. Checklist

- [ ] Send `includeUnprojected=true` from the All Customers modal
- [ ] Key rows on `erpId`
- [ ] Render nullable fields through one `—` fallback
- [ ] Grey `isProjected: false` rows and badge them
- [ ] Disable detail / assign / reassign / broadcast on those rows
- [ ] Drive the banner off `meta.unprojectedTotal`, hide it at `0`
- [ ] Decide the sorting behaviour from §6
- [ ] Confirm the tile and `meta.total` agree (both 1,851 on dev)

Questions, or want Option B / CSV parity after all — come back to us.
