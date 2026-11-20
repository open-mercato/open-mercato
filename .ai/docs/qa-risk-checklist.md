# QA risk checklist

Recurring risks from manual QA of Open Mercato, grouped by area. `om-auto-qa-pr` reads it before writing a scenario, and human testers can use it the same way. Add one line when a bug reaches a human that automated QA missed.

## Sales documents and money

- Recheck discounts after every cart or line change, also on shipping, with multi-currency and with tax rounding.
- A change of quantity alone must update both net and gross totals.
- Line discounts on quantities above 1 must not be applied twice.
- Header totals on a new document must not stay at 0.00.
- Returns, and undo or redo of a return, must keep paid and refunded totals.
- A failed email on send must not leave the page stale or the status changed without notice.
- Customer and contact changed in one save must not store unreadable values.

## Conflicts and record locks

- A refused save that keeps the window open needs a two-field test: user A edits one field, user B another, A saves twice.
- A stale second tab shows its conflict only after the tab regains focus.
- A form that saves other records must use each record's own version, or it raises a false conflict.
- A record changed by the app itself, such as adding lines, must not raise a conflict for the same user.

## Permissions, tenants, sessions

- Every new route: from tenant B, request tenant A's ids and expect 404.
- Check "All organizations" on reads and on writes. The symptom can be an endless reload, not an error.
- Seeded `employee` is not a no-permission role for sales. Build a narrow role.
- A role that cannot use an action must not see it, and direct URLs must be refused too.
- Run a negative control, so that "still visible" proves something.
- A new role feature reaches existing tenants only after sync.
- A security fix needs a test that failed before the fix, not a random token.

## Encryption

- Check detail, list and CSV export for raw ciphertext.
- Dedup on an encrypted column can create duplicates.
- Emails read from an encrypted column need decryption before sending.

## CRM

- Test person, company and deal pages. Old and new detail pages differ.
- Open the edit dialog of a completed activity and save a title change: dates must not move.
- A feature behind a toggle needs the toggle on. Records made in one mode may not appear in the other.

## Portal and email

- Invitations must create the user, not only answer 201.
- Check that the email really arrives and that its link opens the right organization.

## Numbers and locale

- A number must redisplay with the locale comma after reload.
- A cleared number field must stay empty until typed, not snap back to a default.
- Invalid text must not turn into 0.
- Compare single date and date range pickers, because they resolve the locale differently.
- A select left empty must not show a raw enum code.

## Translations

- Check page title, breadcrumb and visual editors as well as the form body.
- Dictionary entries have two translation paths, and a screen may use only one.
- The product default is English; saved preferences may choose another locale. Select Polish explicitly for decimal-comma checks and record the selected language.

## Data integrity

- Soft-delete uniqueness conflicts must answer 409 or 422, not 500.
- A secondary write path must apply the same validation as the main form.
- Migrations: test on a database with existing data, and check derived fields and existing tenants.
- Custom fields: test list and detail, and typed values after import.

## Lists and tables

- Test header stability after reload on lists beyond those the PR names.
- Check late injected columns, saved views and default-hidden columns.
- Check narrow widths: columns and row actions must stay reachable.

## Background work

- Queue names must work in Redis mode, not only in local mode.
- Long operations need polling while active, plus a manual refresh.
- Persistent events run with a delay. Wait before reporting that a trigger did not fire.
- An async workflow step must resume in a separate worker process.

## Undo and audit

- Undo and redo must restore linked balances, stock and child rows.
- A refused undo must leave the data unchanged and say why.

## Keyboard and dialogs

- Escape in a nested layer closes only that layer.
- Cmd/Ctrl+Enter submits and Escape cancels in every dialog, also after an error.

## False alarms

- A slow first load on dev can look like a render loop. Retry on a warm page or a production build.
- A 500 on dev needs a check on a production build before it is reported.
- Injected tabs can take 20 to 40 seconds on dev. Wait 60 seconds and check the role's permissions.
- A demo banner at the bottom of the page can intercept clicks.
- A dev runtime banner appears on expected 409 and 400 answers. It is not a bug.
- Seeded prices can have net equal to gross. Create a correct price before reporting a total.
- `ENABLE_CRUD_API_CACHE=true` keeps lists stale locally for up to 5 minutes.
