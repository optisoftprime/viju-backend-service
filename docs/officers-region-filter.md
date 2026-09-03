# Region filter — Account Officers page

`GET /api/v1/admin/officers`

Serves both the **admin** Account Officers page and the **regional admin** one.
The filter already exists on the API; this is what the frontend needs to send
and what to expect back.

---

## Quick reference

```
GET /api/v1/admin/officers?region=LAGOS&page=1&pageSize=20
Authorization: Bearer <token>
```

| Param | Values | Notes |
|---|---|---|
| `region` | `LAGOS` `EASTERN` `SOUTH_SOUTH` `WESTERN` `NORTH` `OTHERS` | Omit for **all regions**. Anything else → 400. |
| `role` | `OFFICER` (default) `LOADING_OFFICER` `ADMIN` `REGIONAL_ADMIN` | Account officers are `OFFICER`. |
| `managed` | `true` | All four managed roles in one page. Overrides `role`. |
| `isActive` | `true` `false` | Omit for both. |
| `search` | free text | Name / email / phone, case-insensitive, partial. |
| `sortBy` | `name` `email` `region` `customers` `createdAt` `lastLoginAt` `supportTickets` | Default: `name` ascending. |
| `sortOrder` | `asc` `desc` | Default `desc` when `sortBy` is given. |
| `page`, `pageSize` | integers | `pageSize` clamped to 200 and echoed back **as applied**. |

`region` is a **single value**, not a list. To show several regions, either
call once per region or omit it and group client-side.

---

## Who sees what

This is the part worth reading twice — the same request behaves differently by
role, and it is deliberate.

### ADMIN

Sees every region. `region` narrows the list; omit it for all officers.
The region dropdown should be fully enabled.

### REGIONAL_ADMIN

**Pinned to their own region, from the token.** A `region` param is *accepted
and ignored* — the response is always their own region, with **200**, never a
403.

Two consequences for the UI:

- Do **not** build the dropdown expecting it to work. Either hide it, or show
  it disabled with the admin's own region selected. A dropdown that appears to
  work but changes nothing is worse than no dropdown.
- Do **not** treat a "wrong" region coming back as an error. It is the
  documented behaviour.

> This differs from `GET /admin/customers`, which **refuses** a region a
> regional admin may not see. The officer picker has always tolerated it.
> Nothing leaks either way — scope is read from the token, so a user cannot
> widen it by editing the query string.

### OFFICER (account officer)

May call this route for one purpose only: the assign-loading-officer picker on
their own loading-request screen. They are forced to `role=LOADING_OFFICER`
and to their own region whatever the query string says.

---

## Response

Standard `{ data, meta }` envelope:

```jsonc
{
  "data": [
    {
      "id": "e4c1…",
      "name": "Adaeze Obiora",
      "email": "aobiora@viju.example",
      "phone": "+2348012345678",
      "region": "LAGOS",
      "role": "OFFICER",
      "isActive": true,
      "createdAt": "2026-08-21T14:10:55.680Z",
      "lastLoginAt": null,
      "deactivatedAt": "2026-08-25T16:19:30.087Z",
      "reactivatedAt": "2026-09-03T13:06:50.536Z",
      "_count": {
        "customers": 42,
        "supportTickets": 3
      }
    }
  ],
  "meta": {
    "total": 4,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

`meta.total` counts the rows **the current filter matches**, so the pager is
correct without any client-side counting. A region with no officers returns
`data: []` with a valid `meta` — never a 404.

Note the two counts arrive **nested under `_count`**, not flattened onto the
row: read `row._count.customers` and `row._count.supportTickets`. The `sortBy`
values for them are the flat names, `customers` and `supportTickets`.

`lastLoginAt` is `null` for an officer who has never signed in — render a dash,
not "Invalid Date". `deactivatedAt` / `reactivatedAt` are both populated on an
account that was switched off and back on; `isActive` is the field to drive the
status badge.

---

## Populating the dropdown

The six regions are fixed. Hard-code them rather than deriving from the current
page, which only shows regions that happen to have officers:

```ts
const REGIONS = [
  { value: 'LAGOS',        label: 'LAGOS' },
  { value: 'EASTERN',      label: 'EASTERN' },
  { value: 'SOUTH_SOUTH',  label: 'SOUTH-SOUTH' },  // hyphen in the label only
  { value: 'WESTERN',      label: 'WESTERN' },
  { value: 'NORTH',        label: 'NORTH' },
  { value: 'OTHERS',       label: 'OTHERS' },
];
```

Two things that catch people out:

- **`SOUTH_SOUTH` is the wire value; "SOUTH-SOUTH" is the label.** Sending the
  hyphenated form is a 400.
- **`OTHERS` is a real region**, not a catch-all bucket for bad data. It is the
  ERP's own `其他客户` cluster (BP_CLUSTER_CODE 9) and holds 58 distributors.
  It currently has **no officers assigned**, so `region=OTHERS` legitimately
  returns `total: 0` until someone is staffed there.

---

## Worked examples

```
# Admin: account officers in one region
GET /api/v1/admin/officers?region=EASTERN&role=OFFICER&page=1&pageSize=20

# Admin: all account officers, most recently active first
GET /api/v1/admin/officers?role=OFFICER&sortBy=lastLoginAt&sortOrder=desc

# Admin: active officers in NORTH, searching by name
GET /api/v1/admin/officers?region=NORTH&isActive=true&search=bello

# Regional admin: no region needed — the token decides
GET /api/v1/admin/officers?role=OFFICER&page=1&pageSize=20

# Loading-officer picker (regional admin, RA-06)
GET /api/v1/admin/officers?role=LOADING_OFFICER
```

---

## Errors

| Status | When |
|---|---|
| 400 | Unknown `region`, `role`, `sortBy` or `sortOrder`; invalid pagination |
| 401 | Missing or expired token |
| 403 | Role not permitted on this route |

An unknown query parameter is also a 400 — the API rejects properties it does
not recognise, so do not send extras.
