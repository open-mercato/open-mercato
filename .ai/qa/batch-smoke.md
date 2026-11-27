# Batch smoke

The fixed part of every batch QA pass (`om-qa-batch`, see
`.ai/docs/pr-workflow.md` → Batch QA). It takes about 30 minutes on a
fresh build of the batch branch (`stabilize/qa-<YYYY-MM-DD>`, deployed from its batch
PR). The PRs that need a human eye come on top of it from the batch checklist
(`om-qa-batch --range <start>..<batch-head>`; the first batch starts at the
merge-base of `main` with the newest release line). A PR whose only
`qa-approved` came from an agent counts as not covered and is on that list. When
the list is too long for one sitting, split it across QA sessions on the same
batch and note what each covered in `.ai/runs/<YYYY-MM-DD>-qa-batch.md`.

Order is risk first: when time runs short, a partial pass still covers the
parts where a failure blocks users. Any step that fails under the blocker
definition (a main screen does not load or returns a server error, sign-in,
save or create fails, data is lost or leaks between organizations or tenants,
a migration fails) is a blocker.

Use the seeded tenant (for example `admin@acme.com` in Acme Corp) and a second
tenant for step 7.

## 1. Start and sign in

- [ ] The app starts on the batch head and the migrations applied without
      errors in the log.
- [ ] `/login` → sign in as admin → `/backend` dashboard opens with no error
      banner.
- [ ] Sign out, sign in as a non-admin employee → only permitted menu items
      show, and a backend page outside their role shows the access message,
      not a crash.

## 2. Sales: quote to order to payment

- [ ] `/backend/sales/quotes` → create a quote with two lines → convert it to
      an order.
- [ ] `/backend/sales/orders` → open the order → change quantity, price and a
      discount on a line → totals and tax recalculate and stay after reload.
- [ ] Add a payment and a shipment → order status and history update.
- [ ] Undo the last change → only that change is reverted.

## 3. Customer portal

- [ ] Sign in at `/<orgSlug>/portal/login` with a portal user (invite one
      first when the environment has none) → portal dashboard and profile
      open.
- [ ] Sign out → a portal page URL now asks for sign-in.

## 4. CRM

- [ ] `/backend/customers/people` and `/backend/customers/companies` → list,
      search, create, edit, save, reload.
- [ ] `/backend/customers/deals` → create a deal → move it to another stage →
      close it as won.

## 5. Catalog

- [ ] `/backend/catalog/products` → search (also without diacritics) → create
      a product with a variant and a price → edit → save → reload.

## 6. Users and roles

- [ ] `/backend/users` and `/backend/roles` open → change one role permission →
      save → the change shows after reload.

## 7. Cross-cutting

- [ ] Same record open in two tabs → save in the first, then in the second →
      the second shows the conflict message, nothing is silently overwritten.
- [ ] A second tenant's user opens a first-tenant record by URL → access
      denied or not found, never the data.
- [ ] Switch the interface language → no raw translation keys on the screens
      above.
- [ ] Narrow window (about 390 px) on one list and one form → no page-wide
      horizontal scroll, buttons reachable.
