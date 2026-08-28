# Frontend Guide — The Officer's Chat List & the Cancellation Window

**Answers:** `BACKEND_REQUEST_CHAT_LIST_AND_CANCEL_WINDOW.md` (spec 41)
**Backend branch:** `dev`
**Date:** 28 Aug 2026
**Scope:** LC-1, CH-1, CH-2, CH-3 — plus the §4 confirmation.

> **All four are done**, and §4 is confirmed: **listing conversations does not
> mark them read**, verified against the live database (§6).
>
> **CH-3 is the route you preferred** — `GET /officers/chats` — and CH-1/CH-2
> also landed on `GET /officers/customers`, so both paths work and you can
> migrate at your own pace.
>
> **No migration.** CH-2 reuses a column that already exists.
>
> Your covering note asked for "round 2 only" — that split belongs to the
> spec 35/38 request. This document has no rounds; everything in it is
> implemented.

---

## 0. Summary

| # | Outcome | Fallback you can now delete |
|---|---|---|
| **LC-1** | **Done.** `IN_PROGRESS → CANCELLED` is now a 409 on all three routes, with the message you asked for. | Keep hiding the button; the API is now the control too. |
| **CH-1** | **Done.** `lastMessagePreview` + `lastMessageSenderType` on both list routes. | `ChatListItem`'s account-code secondary line. |
| **CH-2** | **Done — the field already existed.** `avatarUrl`, set by distributors in the mobile app. | Keep `initialsOf` as the null fallback. |
| **CH-3** | **Done, your preference.** `GET /officers/chats`. | `PORTFOLIO_WINDOW`, the client-side drop, and the browser re-sort. |
| **§4** | **Confirmed.** Neither list route marks anything read. | — |

---

## 1. LC-1 — the cancellation window

The legal window is now **`PENDING` and `ASSIGNED` only**. `IN_PROGRESS` is
refused on all three routes:

- `PATCH /regional/loading-requests/{id}/cancel`
- `PATCH /officers/loading-requests/{id}/cancel`
- `PATCH /loading/queue/{id}/status` with `{"status":"CANCELLED"}`

```json
{
  "message": "This load is already being loaded and cannot be cancelled.",
  "code": "INVALID_STATUS_TRANSITION",
  "statusCode": 409
}
```

Exactly the wording you specified, rendered as-is. Verified live on both the
officer cancel route and the loading-officer status route.

Your reasoning is now recorded in the code, because it is the kind of rule that
gets "simplified" later by someone who reads it as tidiness: cancelling a load
that is already being loaded leaves stock physically moved with no waybill
accounting for it, and the portal cannot reconcile that.

**Nothing else moved.** `ASSIGNED → IN_PROGRESS → COMPLETED` is untouched, and
`ASSIGNED → COMPLETED` still works — verified live (`IN_PROGRESS → COMPLETED`
returned 200 immediately after the cancel was refused).

Keep hiding the button at `IN_PROGRESS`. The UI rule is still the better
experience; the API is now the guarantee.

---

## 2. CH-3 — `GET /officers/chats`

```http
GET /api/v1/officers/chats?page=1&pageSize=30&search=
```

Live response, real data:

```json
{
  "data": [
    {
      "customerId": "843812d6-fa56-4b36-9095-4f980b6e252c",
      "name": "ISEA INTEGRATED",
      "accountNumber": "10110017",
      "avatarUrl": "https://res.cloudinary.com/…/profile-photos/obqh9gkq8pnqhwgi1evf.png",
      "lastMessagePreview": "📎 Attachment",
      "lastMessageSenderType": "STAFF",
      "lastMessageAt": "2026-08-28T08:41:17.255Z",
      "unreadMessages": 7
    },
    {
      "customerId": "f4065cfe-682e-4864-9e7a-49e0a3b0f244",
      "name": "ADLAK",
      "accountNumber": "10110003",
      "avatarUrl": null,
      "lastMessagePreview": "Has my waybill been assigned?",
      "lastMessageSenderType": "CUSTOMER",
      "lastMessageAt": "2026-08-28T08:37:17.255Z",
      "unreadMessages": 1
    }
  ],
  "meta": { "page": 1, "pageSize": 30, "total": 2, "totalPages": 1, "hasNextPage": false, "hasPreviousPage": false }
}
```

### What it guarantees

- **Conversations only.** A customer the officer has never exchanged a message
  with does not appear — verified: the officer holds 6 LAGOS customers and the
  route returned the 2 with threads. Nothing to filter client-side.
- **Ordered by recency across the whole portfolio, then paged.** Page 1 starts
  at the officer's genuinely most recent conversation, not the most recent
  within a window of accounts. This is the bit that silently broke past 100
  accounts.
- **`search`** matches name, account number and phone — the same matching
  `GET /officers/customers` applies, so the two screens agree.
- **`unreadMessages`** uses the identical predicate as
  `GET /officers/customers` (AO-C1): messages the **distributor** sent that are
  still unread by staff, always a number, `0` rather than omitted. The two
  cannot disagree on one screen.
- **Read-only.** See §6.

### Why it is a separate resource

You called it a different resource from "my customers" and that was right — it
also made it cheaper. The row carries only what a conversation list renders, so
the screen no longer pays for wallet balances, stock figures, ticket counts and
an ERP credit lookup per page that it never displays.

`accountNumber` is still there: as you said, it is what tells two
similarly-named distributors apart, so keep it available as a secondary line
even now that a real preview exists.

### Fallbacks to delete

```
app/chat/page.tsx      PORTFOLIO_WINDOW            → gone
                       the lastMessageAt drop      → gone (never returned)
                       the browser re-sort         → gone (server order is correct)
```

---

## 3. CH-1 — the message preview

On **both** `GET /officers/chats` and `GET /officers/customers`:

| Field | Meaning |
|---|---|
| `lastMessagePreview` | The newest message on the thread, **either side** |
| `lastMessageSenderType` | `"CUSTOMER"` \| `"STAFF"` \| `null` |

`ChatListItem` already reads both, so rows start showing real previews with no
frontend change — as you predicted.

### The rules, all pinned by tests

- **120 characters**, truncated with an ellipsis (`…`) so a cut-off sentence
  reads as cut off. A message exactly at the limit is untouched.
- **Whitespace collapsed.** Newlines and tabs become single spaces, so a pasted
  multi-line message renders as one line rather than a ragged fragment.
- **Attachment-only → `"📎 Attachment"`**, exactly as you asked, rather than an
  empty string that would make the row look broken. Verified as correct UTF-8
  on the wire (`f0 9f 93 8e`).
- **Text wins over the attachment label** when a message has both.
- **`null` on an empty thread**, and `lastMessageSenderType` is `null` with it.

Prefix with "You: " when `lastMessageSenderType === "STAFF"`.

> One thing to be aware of: `"STAFF"` means *any* staff member, not necessarily
> the signed-in officer. An admin or regional admin replying through the
> Interaction Audit also writes a `STAFF` message. "You: " will therefore be
> slightly wrong in the rare case where someone else answered on the officer's
> behalf. If that matters, say so and we will add the author's `staffId` to the
> row — the data is there, we just did not want to widen the payload
> speculatively.

---

## 4. CH-2 — the avatar

**The field already existed, and distributors already set it.**
`Customer.profilePhotoUrl` is written by the mobile app through
`PATCH /customers/me/photo`. That is exactly the value you asked for, so it is
now surfaced as `avatarUrl` on both list routes.

So the honest answer to your question is better than "there is no such field":
there is one, it is populated, and ISEA INTEGRATED already has a real
Cloudinary photo on it — visible in the §2 response above.

`null` for a customer who has not set one. **Keep `initialsOf`** — it is the
right fallback and it is doing real work, since most customers have no picture.

Not added to `GET /admin/customers` in this pass. Say the word if the admin
distributor list wants it too; it is a one-line addition now that the
projection carries it.

---

## 5. CH-3(b) — the NULL ordering concern

**Already safe, and it was not the failure mode you expected.**

`sortBy=lastMessageAt` on `GET /officers/customers` has never been a SQL
`ORDER BY`. `lastMessageAt` is derived after the query (it is a `groupBy` over
`Message`), so that sort runs **in memory** over the full matching set, through
a comparator that puts `null` **last in both directions**:

```ts
if (left == null && right == null) return 0;
if (left == null) return 1;      // ← not multiplied by direction
if (right == null) return -1;
```

Verified live — `?sortBy=lastMessageAt&sortOrder=desc` returned:

```
ISEA INTEGRATED   2026-08-28T08:41:17Z
ADLAK             2026-08-28T08:37:17Z
AIRPORT           null                 ← last, not first
```

Because the sort runs over the whole matching set before paging, the ordering
was already correct across the portfolio rather than within a page. So if you
prefer to keep using `/officers/customers` with `hasMessages`-style filtering
in the client, the ordering half is sound.

`?hasMessages=true` was **not** added — `GET /officers/chats` makes it
redundant, and a second way to express "conversations only" is a second thing
to keep in step. Ask if you want it anyway.

---

## 6. §4 — confirmed: listing does not mark read

**Neither list route marks anything read.** Only `GET /chat/{customerId}`
does (C-1), which is right when a human opens a conversation.

Verified against the live database:

```
unread messages before : 8
  GET /officers/chats?pageSize=50
  GET /officers/customers?pageSize=50
unread messages after  : 8
```

Your reasoning is exactly why this matters and is now recorded in the code: the
unread count is shared across staff, so a list that quietly cleared it would
clear it for everyone and destroy the only signal telling an officer who is
waiting. Both list routes are read-only by construction — they run `groupBy`
and `SELECT` only, and there is no `updateMany` on either path.

You are also right that you never call `PATCH /chat/{customerId}/read`. It
remains available for the "dismiss without opening" case; nothing calls it on
your behalf.

---

## 7. What did NOT change

For your regression pass:

- **No migration, no schema change.** CH-2 reuses `Customer.profilePhotoUrl`.
- **`GET /officers/customers` gained three fields and lost none.** Same
  envelope, same filters, same sorts, same `meta`.
- **`unreadMessages` and `lastMessageAt` are unchanged** in meaning and value
  on that route — the dashboard tiles still agree with the list.
- **Forward loading transitions are untouched.** Only `IN_PROGRESS → CANCELLED`
  was removed.
- **`PATCH /chat/{customerId}/read` and `GET /chat/{customerId}`** behave
  exactly as they did after C-1.
- **The regional-admin parity work (spec 40) is untouched.**

### Test coverage

| Item | Spec file |
|---|---|
| LC-1 | `src/modules/loading/loading-cancel-description.spec.ts` (updated, 18 tests) |
| CH-1, CH-3(b) | `src/modules/officer/officer-chats.spec.ts` (10 tests) |

One assertion in the loading spec had to be inverted — it pinned the L-1
window that allowed cancelling from `IN_PROGRESS`, which LC-1 deliberately
closes. It now asserts the narrowed window, the exact refusal message, and that
the forward moves still work.

Full suite: **381 passing, 27 suites.** LC-1, CH-1, CH-2, CH-3 and the §4
confirmation were additionally exercised live against the deployment database
as a real LAGOS account officer, with every probe removed afterwards.
