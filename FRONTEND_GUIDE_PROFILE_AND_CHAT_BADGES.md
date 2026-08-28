# Frontend Guide — Profile Self-Service, Chat Badges & the Description Timestamp

**Answers:** `BACKEND_REQUEST_PROFILE_AND_CHAT_BADGES.md` (spec 42)
**Backend branch:** `dev`
**Date:** 28 Aug 2026
**Scope:** PR-1, PR-2, PR-3, TS-1, NB-1 — plus the §4 question.

> **All five are done**, including both blockers. **§4 is answered: sessions
> are NOT invalidated** — say nothing about other devices in the form (§3).
>
> ⚠️ **This release needs `prisma migrate deploy`** — two nullable columns.
> `docker-entrypoint.sh` runs it on container start, so a normal deploy covers
> it.
>
> Your covering note asked for "round 2 only" — that split belongs to the
> spec 35/38 request. This document has no rounds; everything in it is
> implemented.

---

## 0. Summary

| # | Outcome | What to change |
|---|---|---|
| **PR-1** | **Done.** `PATCH /users/profile/photo`, returns the refreshed profile. | Nothing — the page works. |
| **PR-2** | **Done.** `PATCH /users/profile/password`, both error codes as specified. | Nothing. |
| **PR-3** | **Done.** Magic-number check on image folders; PDFs still fine for waybills. | Keep the client check — it fails faster. |
| **TS-1** | **Done.** `descriptionUpdatedAt` on all four routes. | Nothing — your UI renders it on arrival. |
| **NB-1** | **Done.** `CHAT_MESSAGE` excluded from the staff bell, count included. | Delete the client-side filter **and the badge recount**. |
| **§4** | **Answered: sessions survive.** | Say nothing about other devices. |

---

## 1. PR-1 — your own profile picture

```http
PATCH /api/v1/users/profile/photo
```

```json
{ "profilePhotoUrl": "https://res.cloudinary.com/…/profile-photos/ada.png" }
```

Responds with the **refreshed profile**, identical in shape to
`GET /users/me`, so the navbar and sidebar avatar update from this one
response. Verified live:

```json
{
  "id": "82c3a13e-6529-4945-a3b6-c7b271391e91",
  "name": "Funmi Adelaja",
  "role": "OFFICER",
  "region": "SOUTH_SOUTH",
  "profilePhotoUrl": "https://res.cloudinary.com/…/profile-photos/mat2kk5lbp9fo0y2imky.jpg"
}
```

- **Acts on the token's own account.** No id in the path, so one user cannot
  set another's picture.
- **Open to every signed-in role**, as you built it — staff and customers
  alike. A customer calling it writes the same column
  `PATCH /customers/me/photo` does.
- **`null` or `""` clears it.**

### The URL is checked

An arbitrary URL is refused:

```json
{
  "message": "That image is not hosted on this service. Upload it through POST /uploads first and send the URL that returns.",
  "code": "INVALID_UPLOAD_URL",
  "field": "profilePhotoUrl",
  "statusCode": 400
}
```

Accepted: `https://` on one of this deployment's own upload hosts (Cloudinary
when configured, plus whatever `UPLOAD_PUBLIC_BASE` / `PUBLIC_BASE_URL` /
`APP_URL` resolves to), or the same-origin relative `/uploads/…` form the local
driver returns. `http://` is refused too — it would downgrade every viewer's
connection.

The allow-list is derived from configuration rather than hard-coded, so it
follows the deployment. `UPLOAD_URL_ALLOWED_HOSTS` (comma-separated) extends it
if a CDN is ever put in front of the bucket.

> **A new column.** Staff had nowhere to store a picture — `GET /users/me`
> returned a hard-coded `null` for them. It is a real value now. Customers are
> unchanged.

---

## 2. PR-2 — changing your own password

```http
PATCH /api/v1/users/profile/password
```

```json
{ "currentPassword": "…", "newPassword": "…" }
```

```json
{ "success": true, "message": "Password changed" }
```

`currentPassword` is compared against the stored hash **before anything is
written** — verified: a failed attempt performs no update at all.
`confirmNewPassword` is not accepted, as you intended; accepting it would imply
it was checked.

### The failures, all live-verified

```json
{ "message": "Your current password is not correct.", "code": "INVALID_CURRENT_PASSWORD", "field": "currentPassword", "statusCode": 400 }
```

```json
{ "message": "The new password must be different from your current one.", "code": "PASSWORD_REUSED", "field": "newPassword", "statusCode": 400 }
```

Each carries **`field`**, so you can render it against the right box without
mapping the code yourself.

One more you may hit: `NO_PASSWORD_SET` (400) for an ERP-mirrored account with
no local password — there is no current password for them to prove knowledge
of, so the reset flow is the right route for those users.

Length validation matches `POST /admin/officers` (8–72). Below 8 you get the
standard class-validator array:

```json
{ "message": ["newPassword must be longer than or equal to 8 characters"], "error": "Bad Request", "statusCode": 400 }
```

---

## 3. §4 — sessions are NOT invalidated

**Nothing is signed out.** Refresh tokens are untouched, on this device and on
every other one. The user stays signed in.

So: **say nothing about other devices** in the form, and do not sign the
current session out afterwards. This is asserted by a test, so it will not
change silently.

If you would rather it *did* revoke other sessions, that is a deliberate
product decision and a small change — the refresh tokens are already stored per
device and the deactivation path already revokes them. Say the word. We did not
do it unasked, because signing someone out of their phone for changing a
password on their laptop is a surprise, and you specifically wanted to know
which behaviour to warn about rather than discover it from a 401.

---

## 4. PR-3 — the server-side image check

`POST /uploads` now sniffs the **first bytes** for image folders. Verified
live: a PDF renamed `.png` and declared `image/png` is refused.

```json
{
  "message": "That file is not a JPEG, PNG, WEBP or AVIF image.",
  "code": "UNSUPPORTED_IMAGE_TYPE",
  "statusCode": 400
}
```

Signatures checked, exactly as you specified:

| Format | Signature |
|---|---|
| JPEG | `FF D8 FF` at 0 |
| PNG | `89 50 4E 47 0D 0A 1A 0A` at 0 |
| WEBP | `RIFF` at 0 **and** `WEBP` at 8 |
| AVIF | `ftyp` at 4 with an `avif`/`avis` brand at 8 |

Both compound checks matter and are tested: a `.wav` is also `RIFF`, and an
`.mp4` is also `ftyp` — checking only the first tag would let audio and video
through.

**The folder distinction is kept.** `waybill-documents` and `misc` legitimately
accept PDFs and are unaffected; `profile-photos`, `product-flyers`,
`chat-attachments` and `ticket-attachments` get the check. Verified: the same
renamed file uploads fine to `waybill-documents`.

**Keep your client-side check.** It fails faster, explains itself better, and
saves the round trip. This is the control behind it, not a replacement.

> **A pre-existing rough edge worth knowing**, since it sits right next to
> this: a file that passes the signature check but is *corrupt* (a truncated
> PNG, say) is rejected by Cloudinary and surfaces as a **500**, not a 400. We
> did not change that — it predates this work and affects `waybill-documents`
> equally. PR-3 actually reduces how often you will see it, since renamed files
> are now caught before Cloudinary sees them. Tell us if you want it turned
> into a proper 400.

---

## 5. TS-1 — the description timestamp

`descriptionUpdatedAt` is on every loading-request row: `GET /loading/queue`,
`GET /loading/queue/{id}`, `GET /regional/loading-requests` and
`GET /officers/loading-requests`, plus the `PATCH …/description` response.

Set when the note is written, **cleared to null when the note is cleared**, and
**never touched by a status change**. Verified live — this is the property the
field exists for:

```
note written            descriptionUpdatedAt = 2026-08-28T11:00:41.998Z
…then status → IN_PROGRESS
after the status move   descriptionUpdatedAt = 2026-08-28T11:00:41.998Z   ← unchanged
                        status               = IN_PROGRESS
```

`updatedAt` moved; `descriptionUpdatedAt` did not. That gap is exactly why the
one cannot stand in for the other.

### ⚠️ Existing notes read back `null`

There are already real notes on the live database — someone has been using the
L-2 field:

```
SEED-WB-10110003-08   "mr adlak loaded 800 cartons on 26/08/2026, remaining a…"   descriptionUpdatedAt: null
WB-135307             "about 20 cartons are damaged"                              descriptionUpdatedAt: null
```

They were written before the column existed, and we **deliberately did not
back-fill them from `updatedAt`** — that would stamp each note with the time of
some unrelated status change, which is the precise wrong answer this column
exists to avoid. Your own words: a wrong timestamp on a handover note is worse
than none.

So your UI rendering nothing for those two is correct. They pick up a real
stamp the next time someone edits the note.

---

## 6. NB-1 — chat rows out of the staff bell

`CHAT_MESSAGE` is now excluded from `GET /notifications/me` **for staff**, from
both the `data` rows and the `unread` count.

Verified live for one account officer:

| | |
|---|---|
| Unread `CHAT_MESSAGE` rows in the database | **28** |
| `unread` returned by the bell | **18** |
| `CHAT_MESSAGE` rows in `data` | **0** |

18 is exactly the non-chat unread total. Before this, the badge would have read
46 while the panel showed a chat-free list.

### Delete the recount, not just the filter

This is the part that fixes your actual bug. Because `unread` and `data` are
now filtered by the **same predicate**, the badge is exact regardless of
pagination. So:

- delete the client-side `CHAT_MESSAGE` filter, and
- **go back to rendering the server's `unread` directly** — the recount from
  the fetched page can go, and with it the under-reporting past page one.

### Two decisions behind it

**Filtered on read, not by refusing to write.** You said either was fine and
stopping the write was cleaner "if nothing else consumes those rows" —
something does. The row drives the push dispatch and the realtime frame, so
not writing it would silently remove staff chat pushes too. Filtering on read
keeps those intact, makes the count exact, and is reversible.

**`markAllRead` matches the list.** For staff it now skips `CHAT_MESSAGE` as
well, so "mark all read" clears what the bell actually showed rather than
silently clearing conversations you never saw there. Those are read by opening
the conversation, as before.

### The distributor's feed is unchanged

Confirmed, and asserted by a test: `listForCustomer` has no such exclusion. A
distributor keeps every chat notification. This is a staff-portal concern only,
exactly as you framed it.

---

## 7. What did NOT change

For your regression pass:

- **`GET /users/me` keeps its shape.** `profilePhotoUrl` is simply populated
  for staff now instead of always null.
- **`GET /notifications/me` keeps its shape** — same envelope, same fields.
  Only which rows a *staff* caller sees changed.
- **`PATCH /customers/me/photo` and `/customers/me/password` are untouched.**
- **`POST /uploads` accepts everything it accepted before**, for any file that
  really is what it claims. Size and MIME rules are unchanged.
- **Loading routes are otherwise unchanged** — `descriptionUpdatedAt` is
  additive, and the LC-1 cancellation window from spec 41 still stands.
- **Spec 39/40/41 work is untouched.**

### Test coverage

| Item | Spec file |
|---|---|
| PR-1, PR-2, PR-3 | `src/modules/users/profile-self-service.spec.ts` (18 tests) |
| NB-1 | `src/modules/notifications/notification-audience.spec.ts` (updated) |
| TS-1 | `src/modules/loading/loading-cancel-description.spec.ts` (updated) |

Three existing assertions were updated where spec 42 deliberately changes
behaviour — the staff feed's scoping predicate (NB-1) and the two L-2
description writes (TS-1). Each now asserts the new guarantee rather than
being deleted.

Full suite: **401 passing, 28 suites.** All five items were additionally
exercised live against the deployment database, with every probe removed
afterwards.

---

## 8. One thing we noticed, unrelated to this spec

While verifying, two officers turned out to be sitting outside the region their
customers are in:

```
6 LAGOS customers   → officer.lagos1@viju.local   (now region SOUTH_SOUTH)
2 WESTERN customers → officer.western1@viju.local (now region LAGOS)
```

That is a live consequence of the O-1 / O-2 region-edit features from spec 40
working as designed — an admin *can* move an officer's region — but nothing
warns that doing so strands the portfolio they hold. Those 8 customers now have
an officer that `PATCH /admin/customers/{id}/reassign` would refuse to assign,
because that route requires the officer to be in the **customer's** region.

We have not touched the data; it may be deliberate testing. But it is worth a
product decision: moving an officer who holds customers could reasonably refuse
with a 409 the way deactivation does (`OFFICER_HAS_CUSTOMERS`), or move the
portfolio with them. Say which and we will implement it.
