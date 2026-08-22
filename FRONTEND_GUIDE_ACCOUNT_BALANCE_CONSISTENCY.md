# Frontend Note — One Account Balance, Everywhere

**Backend branch:** `dev`
**Base URL:** every path below is prefixed with `/api/v1`

`GET /customers/me` has always derived the account balance live from the ERP
customer-credit feed. The staff-facing endpoints read the stored
`Customer.outstandingBalance` column instead, so a distributor and the officer
looking at the same account could see **opposite numbers**.

They now all use the one derivation. No request or response shape changed —
**only the values**.

---

## 1. Endpoints now on the shared derivation

| Endpoint | Field |
|---|---|
| `GET /customers/me` | `outstandingBalance` *(unchanged — this was already the reference)* |
| `GET /admin/customers` | `outstandingBalance` |
| `GET /admin/customers/{id}` | `outstandingBalance` |
| `GET /officers/customers` | `walletBalance` |
| `GET /officers/customers/{id}` | `outstandingBalance` |
| `GET /officers/customers/{id}/overview` | `walletBalance` |
| `GET /regional/customers` | `outstandingBalance` |

`GET /officers/customers/{id}/overview` was not on your list, but it is the
Overview tab of the very page `GET /officers/customers/{id}` opens. A header
and a tab on one screen disagreeing is exactly the problem being fixed, so it
is included.

---

## 2. The formula

```
Running Balance = CREDIT_AMT + CREDIT_AMT1 − CREDIT_PAY
```

Read from the newest credit record per customer (`EFFECTIVE_DATE` descending)
in the ERP customer-credit feed, joined on `CUSTOMER_CODE` = `erpId`.

The sign convention is the one the portal already assumes:
**positive = funds available, negative = overdrawn/owing.**

The stored column was not trustworthy on its own: the projector that writes it
lives in another service and copies the ERP's raw `CREDIT_PAY` — consumed
credit, signed the other way — straight into it. On the current feed that
inverted **1,473 of 1,831 customers (80%)**.

Worked example, ISEA INTEGRATED (`10110017`):

```
  1000.2222  CREDIT_AMT
+ 1000.1111  CREDIT_AMT1
− (−33401031.14)  CREDIT_PAY
= 33403031.4733   → in credit
```

The stored column reported `−33401031.14` for the same customer — "owes ₦33.4m"
instead of "holds ₦33.4m in credit".

**Not rounded.** The arithmetic runs in SQL `numeric` (exact decimal, not binary
float), and every decimal the ERP supplies survives: `33403031.4733`, not
`33403031.47`. Keep formatting at render time.

---

## 3. What you will see change

**Signs flip on roughly 80% of customers** in the staff portals. A distributor
the officer list showed as deeply overdrawn will now, correctly, show as holding
credit — and vice versa where the ERP really does show a debt.

Check anything that branches on the sign rather than just printing it:

* overdue / low-balance badges and row highlighting;
* the `overdue=true` filter on `GET /officers/customers` (server-side, and it
  reads the **stored** column — see §5);
* any "owes" / "in credit" wording chosen from `balance < 0`;
* sort by `walletBalance` / `outstandingBalance` — the ordering changes with
  the values.

The numbers on `GET /customers/me` do **not** change. If the mobile app and the
officer portal disagreed before, the officer portal was the wrong one.

---

## 4. Fallback behaviour

An ERP code with **no credit record** in the feed falls back to the stored
column — not to `0`. Reporting a zero the ERP never stated would be worse than
reporting a stale figure, and the fallback also keeps every endpoint working on
a database with no ERP feed attached (CI, a fresh local environment).

So `outstandingBalance` / `walletBalance` are always present and always a
number. There is no new null to handle.

Unprojected rows on `GET /admin/customers?includeUnprojected=true` keep
`outstandingBalance: null` as documented — they have no portal record, and that
contract is unchanged.

---

## 5. Two things deliberately left alone

**`overdue=true` on `GET /officers/customers`** still filters on the stored
column, because it is a SQL `WHERE` clause and the derived figure is not in the
database. Until the reconciler has run, that filter can disagree with the
balance now shown on the row. Rather than paper over it, flag it if it bites
and we will move the filter onto the reconciled column.

**The stored column itself.** `ErpAccountBalanceService` already reconciles it
from the same formula, but the periodic pass is off by default so it cannot
fight the immediate delivery-allowance bump (PRD F15 AC5). Reading the derived
figure at request time means the portal is correct *now*, without waiting for a
reconcile. Nothing about how the column is written has changed.

---

## 6. Cost

One extra query per page — a batched lookup keyed on the page's ERP codes, not
one query per row. Detail routes add a single-row lookup. No pagination, sort
or filter behaviour changed.
