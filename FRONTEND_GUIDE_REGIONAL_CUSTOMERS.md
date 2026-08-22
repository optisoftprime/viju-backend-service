# Frontend Guide — Regional Admin Customers

**Endpoint:** `GET /api/v1/regional/customers`
**Roles:** `REGIONAL_ADMIN`, `ADMIN`
**Status:** live on `dev`
**Swagger:** `/api/docs` → *Regional Admin Portal* → `GET /regional/customers`

A dedicated list of every customer in the signed-in regional admin's own
region. The region is resolved from the caller's staff record, so the page
never has to know, choose, or send it.

The rows are produced by the **same service** that backs
`GET /admin/customers`, so the envelope, the row shape, the sort columns and
the ERP-derived columns are identical — the shared customer table renders both
with no branching.

---

## 1. The call

```http
GET /api/v1/regional/customers?page=1&pageSize=20
Authorization: Bearer <regional admin JWT>
```

That is the whole thing. **Do not send `region`.**

### Region rule

| Caller | `region` in the query | Result |
|---|---|---|
| `REGIONAL_ADMIN` | omitted *(do this)* | 200 — their own region |
| `REGIONAL_ADMIN` | their **own** region | 200 — same result, tolerated |
| `REGIONAL_ADMIN` | a **different** region | `403` |
| `ADMIN` | **required** | 200 — that region |
| `ADMIN` | omitted | `403` |

An `ADMIN` has no home region, so on this route they must name one — it is how
an admin previews a single region through the regional portal. For the
cross-region admin list keep using `GET /admin/customers`.

> Unlike `GET /admin/customers`, sending your **own** region here is *not* an
> error. This route is deliberately the forgiving one: if a shared query
> builder always appends `region`, this endpoint still works.

---

## 2. Query parameters

All optional. Anything not listed here is rejected with `400` — the API
whitelists query params.

| Param | Type | Default | Notes |
|---|---|---|---|
| `search` | string | — | **Case-insensitive partial match on `name` OR `erpId`.** See §3. |
| `hasOfficer` | `true` \| `false` | both | `true` = only customers with an assigned officer, `false` = only unassigned. Omit for both. Backs the "Unassigned" filter chip. |
| `sortBy` | enum | `erpId` asc | `name` \| `erpId` \| `region` \| `outstandingBalance` \| `supportTickets` \| `createdAt`. Unknown value → `400`. |
| `sortOrder` | `asc` \| `desc` | `desc` | Only applied when `sortBy` is also sent. |
| `page` | int ≥ 1 | `1` | |
| `pageSize` | int ≥ 1 | `20` | Clamped to **200**, never rejected. Read `meta.pageSize` for the value actually applied. |
| `includeUnprojected` | `true` \| `false` | `false` | Adds ERP customers **in this region** that the projector has not copied into the portal yet. See §6. |
| `region` | enum | from token | See §1. `LAGOS` \| `EASTERN` \| `SOUTH_SOUTH` \| `WESTERN` \| `NORTH`. |

Booleans accept `true` / `false` / `1` / `0`. Any other value → `400`.

---

## 3. Search

```http
GET /api/v1/regional/customers?search=adlak&page=1&pageSize=20
```

* Matches **`name`** or **`erpId`**, case-insensitive, anywhere in the value
  (`contains`, not `startsWith`) — so `adlak`, `ADLAK`, `dla` and `10110003`
  all find `ADLAK` / `10110003`.
* Applied **inside the region** — a regional admin can never surface a
  customer from another region by searching for them.
* `meta.total` counts the **matching** rows, so the pager stays correct while
  the box is filled. Do not filter the page client-side.
* An empty `search` behaves as no search.
* With `includeUnprojected=true` the term is applied to **both** halves of the
  union — `name`/`erpId` on portal rows, `CUSTOMER_NAME`/`CUSTOMER_CODE` on
  ERP-feed rows — and `meta.total` is the size of the filtered union.

Debounce it (~300 ms) and reset to `page=1` on every new term.

---

## 4. Response

`200` with the standard `{ data, meta }` envelope.

```json
{
  "data": [
    {
      "id": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
      "name": "ADLAK",
      "erpId": "10110003",
      "phone": "+2348168584112",
      "region": "LAGOS",
      "accountStatus": "ACTIVE",
      "outstandingBalance": -10140600.1232,
      "stockBalanceCartons": 320,
      "hasOfficer": true,
      "assignedOfficerId": "7c2a09d3-6f61-49c2-9a0e-8d5b1f2c3a44",
      "officerAssignments": [
        {
          "staff": {
            "id": "7c2a09d3-6f61-49c2-9a0e-8d5b1f2c3a44",
            "name": "Ifeanyi Okon",
            "email": "i.okon@viju.com"
          }
        }
      ],
      "_count": { "supportTickets": 2 },
      "lastSyncedAt": "2026-08-16T23:01:03.287Z",
      "createdAt": "2026-08-13T14:06:51.169Z",
      "isProjected": true
    },
    {
      "id": "a1b2c3d4-0000-4000-8000-000000000002",
      "name": "KJ FRESH MART",
      "erpId": "10110044",
      "phone": "+2348011112222",
      "region": "LAGOS",
      "accountStatus": "ACTIVE",
      "outstandingBalance": 0,
      "stockBalanceCartons": 0,
      "hasOfficer": false,
      "assignedOfficerId": null,
      "officerAssignments": [],
      "_count": { "supportTickets": 0 },
      "lastSyncedAt": null,
      "createdAt": "2026-08-14T09:22:10.004Z",
      "isProjected": true
    }
  ],
  "meta": {
    "total": 412,
    "page": 1,
    "pageSize": 20,
    "totalPages": 21,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### Row fields

| Field | Type | Notes |
|---|---|---|
| `id` | `string \| null` | Portal record id. **`null` only on an unprojected row** — disable any action that needs a local record. |
| `name` | `string` | |
| `erpId` | `string` | The ERP `CUSTOMER_CODE`. Show as "Customer Code". |
| `phone` | `string` | |
| `region` | enum | Always the caller's own region. `SOUTH_SOUTH` renders as "SOUTH-SOUTH". |
| `accountStatus` | `"ACTIVE" \| "ON_HOLD" \| null` | `null` only on an unprojected row. |
| `outstandingBalance` | `number \| null` | **Full precision, not rounded and not a string** (`-10140600.1232`). Negative means the distributor is in credit. Format at render time. `null` only on an unprojected row. |
| `stockBalanceCartons` | `number \| null` | Cartons paid for but not yet loaded (ordered − completed loading requests, floored at 0). |
| `hasOfficer` | `boolean` | Mirrors the `hasOfficer` filter. |
| `assignedOfficerId` | `string \| null` | Primary officer, or `null`. |
| `officerAssignments` | `{ staff: { id, name, email } }[]` | Every officer on the account, primary first. **The list rows carry only `staff`** — no `id` / `isPrimary` / `assignedAt`; for those use `GET /admin/customers/{id}`. Empty array = unassigned. |
| `_count.supportTickets` | `number` | **OPEN** tickets only, not all-time. |
| `lastSyncedAt` | `string \| null` | ISO-8601. When the ERP feed last reported this customer. `null` when the feed has no row, or the environment has no ERP feed. |
| `createdAt` | `string \| null` | ISO-8601. When the portal record was created. |
| `isProjected` | `boolean` | `false` = served straight from the ERP feed, no portal record yet. Always `true` unless `includeUnprojected=true`. |

### `meta`

`total`, `page`, `pageSize`, `totalPages`, `hasNextPage`, `hasPreviousPage`.
`total` always counts the rows the **current filter** matches inside the
region. With `includeUnprojected=true` it also carries `projectedTotal` and
`unprojectedTotal`.

`totalPages` is `1` (not `0`) when `total` is `0`.

### Empty region

`200` with an empty list and a valid `meta` — **never** a `404`:

```json
{
  "data": [],
  "meta": { "total": 0, "page": 1, "pageSize": 20, "totalPages": 1,
            "hasNextPage": false, "hasPreviousPage": false }
}
```

Render the empty state, not an error.

---

## 5. Errors

Every body is `{ message, error, statusCode }`. Branch on `statusCode` and the
`message` text below; `message` is safe to display.

| Status | `message` | When |
|---|---|---|
| `403` | `You cannot access data outside your assigned region.` | A `REGIONAL_ADMIN` sent a `region` that is not theirs. **Fix: stop sending `region`.** |
| `403` | `Your account has no region assigned. Contact admin.` | The caller's staff record has no region. An account-configuration problem — say so; do **not** render "no customers". |
| `403` | `Admin must specify ?region= for regional endpoints.` | An `ADMIN` called this route without `region`. |
| `403` | `You do not have permission to perform this action.` | The role is not `REGIONAL_ADMIN` or `ADMIN`. Comes from the role gate, i.e. the wrong token for this route. |
| `400` | array of validation messages | Unknown `sortBy` / `sortOrder`, a non-boolean `hasOfficer`, or an undeclared query param. |
| `401` | — | Missing, invalid or expired token. |

---

## 6. `includeUnprojected=true` (optional)

The portal only holds customers the ERP projector has copied across. Turn this
on and the result set becomes the **union** of portal customers and ERP
customers in the region that have not been copied yet, so the list agrees with
the ERP-reconciled count.

```http
GET /api/v1/regional/customers?includeUnprojected=true&search=latlek&page=1&pageSize=20
```

```json
{
  "data": [
    {
      "id": null,
      "erpId": "10110044",
      "name": "LATLEK VENTURES",
      "phone": "+2348011112222",
      "region": "LAGOS",
      "accountStatus": null,
      "outstandingBalance": null,
      "stockBalanceCartons": null,
      "hasOfficer": false,
      "assignedOfficerId": null,
      "officerAssignments": [],
      "_count": { "supportTickets": 0 },
      "createdAt": null,
      "lastSyncedAt": "2026-08-19T04:30:05.124Z",
      "isProjected": false
    }
  ],
  "meta": {
    "total": 1, "page": 1, "pageSize": 20, "totalPages": 1,
    "hasNextPage": false, "hasPreviousPage": false,
    "projectedTotal": 0, "unprojectedTotal": 1
  }
}
```

Rules for these rows:

* `isProjected: false` and `id: null`. **Disable every row action** — reassign,
  open detail, chat, ticket — since there is no local record to act on. Grey
  the row and show a "not yet synced" hint.
* Ordering is portal rows first, in the requested sort order, then unprojected
  rows by `erpId`. The two halves have different columns available, so they are
  not merged into one sort.
* `hasOfficer=true` excludes the ERP half entirely (an unprojected row can never
  have an officer), and `meta.unprojectedTotal` is then `0`.
* `unprojectedTotal` reaches `0` once projection has run, at which point this
  mode returns exactly what the default mode returns.

Leave it off unless the page is explicitly reconciling against the ERP count.

---

## 7. Types

```ts
export type Region = 'LAGOS' | 'EASTERN' | 'SOUTH_SOUTH' | 'WESTERN' | 'NORTH';

export interface RegionalCustomerRow {
  id: string | null;
  name: string;
  erpId: string;
  phone: string;
  region: Region;
  accountStatus: 'ACTIVE' | 'ON_HOLD' | null;
  outstandingBalance: number | null;
  stockBalanceCartons: number | null;
  hasOfficer: boolean;
  assignedOfficerId: string | null;
  officerAssignments: { staff: { id: string; name: string; email: string } }[];
  _count: { supportTickets: number };
  lastSyncedAt: string | null;
  createdAt: string | null;
  isProjected: boolean;
}

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  projectedTotal?: number;   // includeUnprojected=true only
  unprojectedTotal?: number; // includeUnprojected=true only
}

export interface RegionalCustomersQuery {
  search?: string;
  hasOfficer?: boolean;
  sortBy?: 'name' | 'erpId' | 'region' | 'outstandingBalance' | 'supportTickets' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  includeUnprojected?: boolean;
  // region is intentionally absent — it comes from the token.
}
```

```ts
export async function fetchRegionalCustomers(
  q: RegionalCustomersQuery = {},
): Promise<{ data: RegionalCustomerRow[]; meta: PageMeta }> {
  const params = new URLSearchParams();
  // Skip undefined/empty so no blank param is sent — the API whitelists them.
  Object.entries({ page: 1, pageSize: 20, ...q }).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });

  const res = await api.get(`/regional/customers?${params.toString()}`);
  return res.data;
}
```

Register it alongside the other endpoints, e.g.
`endpoints.regional.customers = '/regional/customers'`.

---

## 8. Wiring checklist

1. Point the regional admin Customers page at `/regional/customers`.
2. **Never send `region`** — keep the "All Regions / Lagos / …" tab strip
   hidden for this role. The header can name the region from
   `data[0].region` or from the signed-in user's own record.
3. Send `search` to the server, debounced, resetting to `page=1`. Delete any
   client-side filtering of the current page.
4. Drive the pager from `meta` — `total`, `totalPages`, `hasNextPage`,
   `hasPreviousPage` — and read back `meta.pageSize` in case it was clamped.
5. Render `outstandingBalance` with full precision; do not round server output.
6. `_count.supportTickets` is the **open** ticket count — label it as such.
7. Handle the three `403`s in §5 distinctly: a region-scope mistake, an
   unconfigured account, and a wrong-role token are three different messages
   to the operator.
8. If `includeUnprojected` is on, disable row actions when `isProjected` is
   `false`.

---

## 9. Relationship to `GET /admin/customers`

Both routes exist and both work for a regional admin. Use this one.

| | `GET /regional/customers` | `GET /admin/customers` |
|---|---|---|
| Roles | `REGIONAL_ADMIN`, `ADMIN` | `ADMIN`, `REGIONAL_ADMIN` |
| Region source | the caller's record | query param for `ADMIN`; token for `REGIONAL_ADMIN` |
| `region` sent by a regional admin | own region tolerated, other region `403` | **any** value `403 REGION_NOT_ALLOWED` |
| `region` required | only for `ADMIN` | never |
| Rows, filters, sorting, `meta` | **identical** | **identical** |

Same table component, same row type, same query builder — only the path and
the region handling differ.

### Related routes for the regional admin portal

| Purpose | Route |
|---|---|
| One customer, full detail | `GET /api/v1/admin/customers/{id}` — allowed in own region, `403` outside |
| Region's tickets | `GET /api/v1/admin/audit/tickets?status=OPEN,IN_PROGRESS,AWAITING_CUSTOMER` — auto-scoped |
| Region's chat threads | `GET /api/v1/admin/audit/chats` — auto-scoped |
| Read / reply to one customer's chat | `GET` / `POST /api/v1/chat/{customerId}` — own region only |
| Read / reply to a ticket, change status | `GET /api/v1/tickets/{id}`, `POST /api/v1/tickets/{id}/replies`, `PATCH /api/v1/tickets/{id}/status` — own region only |
| Officers in the region | `GET /api/v1/admin/officers` |

Details for all of these are in
[`FRONTEND_GUIDE_INTERACTION_AUDIT.md`](./FRONTEND_GUIDE_INTERACTION_AUDIT.md).
