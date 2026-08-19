# Time Tracking — Manual Test Results

Findings from manual testing of the time-tracking consulting suite.
One row per finding; add new ones as they are found.

**Environment**

| | |
|---|---|
| Branch | `develop` |
| Head | `ea078b78f` — feat(staff): seed time-tracking demo data |
| App | `http://localhost:3100` (worktree `/2/open-mercato`) |
| Data | demo seed — 4 projects, 27 tasks, ~470 entries, 2 reports |
| Tester | Patryk Lewczuk |
| Started | 2026-08-19 |

**Status legend:** `open` · `in progress` · `fixed` · `wontfix` · `not reproducible`

---

## Summary

| # | Finding | Area | Severity | Status |
|---|---|---|---|---|
| 1 | Team member shown as a raw UUID instead of their name | Project edit — Team section | Medium | **fixed** |
| 2 | Detail page shows only 5 of ~22 stored fields | Project details — Settings card | Medium | **fixed** |
| 3 | Quick-log takes only duration — no description, date or billable | Task drawer — log time | Medium | **fixed** |
| 4 | **Clicking a time entry opens a different entry** | Time entries — edit dialog | **High** | **fixed** |
| 5 | Selecting a customer leaves the picker looking empty | Project form — customer picker | High | **fixed** |
| 6 | Task references: short codes + searchable picker | Time entry — task picker | Medium | partly done |
| 7 | Tags: cannot create inline, colour never rendered | Time entry / task drawer — tags | Medium | open |
| 8 | Footer keyboard hints wrap into columns | Time entry dialog — footer | Low | **fixed** |
| 9 | Entries list should default to my own entries | Time entries — filters | Medium | open |
| 10 | Entry filters too thin (2 filters; options built from loaded rows) | Time entries — filters | Medium | open |

---

## 1 — Team member rendered as a UUID on the project edit page

**Status:** fixed · **Severity:** medium (cosmetic, but the chip is unreadable and leaks an internal id into the UI)
**Where:** `/backend/staff/time-tracking/projects/{id}/edit` → right column → **Team**

**Expected:** the chip shows the member's name, e.g. `Marta Lopez`, with matching initials `ML`.

**Actual:** the chip shows the raw staff-member UUID `0f08892b-5b01-41d9-a355-ecde91147e59`, and the avatar derives its initials from that string (`0F`).

### Root cause — confirmed

`packages/core/src/modules/staff/lib/time-tracking-ui/ProjectFormSections.tsx:146` — `memberLabel()`:

```ts
function memberLabel(row: TeamMemberRow): string {
  const display = readString(row.displayName)          // <- camelCase only
  if (display) return display
  const first = readString(row.firstName) ?? readString(row.first_name)
  const last = readString(row.lastName) ?? readString(row.last_name)
  const joined = [first, last].filter(Boolean).join(' ')
  return joined || readString(row.email) || readString(row.id) || ''
}
```

`GET /api/staff/team-members?ids=…` returns **snake_case**, verified against the running app:

```json
{ "id": "0f08892b-…", "display_name": "Marta Lopez", "user_id": "…", "is_active": true }
```

So `row.displayName` is `undefined`. Every fallback then misses too:

- `first_name` / `last_name` / `email` **do not exist on `StaffTeamMember` at all** — the entity has only `displayName` (`data/entities.ts:89`). Those fallbacks describe a shape this endpoint never returns.
- The function therefore falls through to `readString(row.id)` — the UUID.

The snake_case fallback was written for `first_name`/`last_name` but **not** for `display_name`, which is the only name column that actually exists.

### Suggested fix

One line, plus the type:

```ts
const display = readString(row.displayName) ?? readString(row.display_name)
```

and add `display_name?: unknown` to `TeamMemberRow` (line 132).

Worth considering in the same pass: dropping to `row.id` is what turned a missing field into a UUID on screen. Returning `''` (the chip is already filtered out by `.filter((name) => name.length > 0)`) would have shown nothing rather than an internal id — a quieter failure, and one that does not look like data corruption to a client sitting next to you.

### Notes

- The **portfolio table** and the **project detail team panel** render names correctly — they go through the `staff.timesheets-projects-portfolio` enricher, which resolves names server-side. This bug is specific to the edit form's Team section.
- Not caught by tests: there is no unit test over `memberLabel`, and no integration test asserts the edit page's team chips.

### Resolution — fixed 2026-08-19

`memberLabel` now reads `display_name` alongside `displayName`, and **no longer falls back to `row.id`** — an unnamed row yields `''`, which the caller already filters out, so a missing name renders nothing rather than leaking a UUID. Four tests in `__tests__/projectTeamMemberLabel.test.ts`.


---

## 2 — Project details page shows only 5 of the ~22 stored fields

**Status:** fixed · **Severity:** medium (no data loss; the page under-reports what the project actually holds)
**Where:** `/backend/staff/time-tracking/projects/{id}` → the "Project Settings" card

**Expected:** the detail page shows everything stored about the project.

**Actual:** the card renders **Code, Status, Project type, Start date** and (when set) **Description** — nothing else. Rate, currency, customer, budget, cost center and the rest are only visible by opening **Edit Project**.

### Root cause — confirmed

`backend/staff/time-tracking/projects/[id]/page.tsx:436-474` — the `<dl>` hard-codes those five fields and stops.

**The data is already on the client.** The page fetches the list route with `?ids=<id>`, and that projection (`timeProjectListFields`) returns every column. Verified against the running app — one request, one project, everything below already present in the response the page throws away:

| Field | In payload | Rendered |
|---|---|---|
| `code` | ✅ | ✅ |
| `status` | ✅ | ✅ |
| `project_type` | ✅ | ✅ |
| `start_date` | ✅ | ✅ |
| `description` | ✅ | ✅ |
| `name` | ✅ | title only |
| **`customer_snapshot` / `customer_id`** | ✅ | ❌ |
| **`hourly_rate`** | ✅ | ❌ |
| **`currency_code`** | ✅ | ❌ |
| **`billable_by_default`** | ✅ | ❌ |
| **`budget_kind` / `budget_value` / `budget_warn_at_percent`** | ✅ | ❌ |
| **`cost_center`** | ✅ | ❌ (declared on `ProjectRecord` at line 46 and never used) |
| **`color`** | ✅ | ❌ |
| **`owner_user_id`** | ✅ | ❌ |
| **`created_at` / `updated_at`** | ✅ | ❌ |
| **`entryCount` / `lockedEntryCount` / `currencyLocked`** | ✅ | ❌ |

`cost_center` being typed on `ProjectRecord` but never rendered is the tell: fields were added to the model and the detail card was not kept in step.

### Derived data is free too

The same response already carries the portfolio enricher's `_staff` block — **no `include=` parameter needed**, it runs unconditionally:

```
_staff.customerName    Brightside Solar        _staff.budget       {kind: hours, value: 240, warnAtPercent: 80}
_staff.totalMinutes    6660                    _staff.members      [{id, name, role}, …]
_staff.billableMinutes 6270                    _staff.memberCount  2
_staff.hourlyRate      165                     _staff.hoursWeek    0
_staff.cost            17242.5                 _staff.hoursTrend   [34.5, 17, 25.5, 0, 0, 0, 0]
```

So logged hours, billable split, cost to date, budget burn and the hours sparkline can all be shown on this page **without touching the API** — the portfolio table already renders them from this exact block.

### Suggested shape

Money fields are ACL-gated (`staff.timesheets.rates.view`) in the portfolio; the detail card must gate them the same way rather than printing a rate to someone the list hides it from.

1. **Client** — customer name (linked to the CRM record), project color swatch beside the title.
2. **Commercials** *(gated on `rates.view`)* — hourly rate + currency, billable by default, budget kind/value/warn-at with the burn bar the portfolio uses, cost to date.
3. **Delivery** — logged hours, billable vs non-billable, hours/week sparkline, entry count, locked-entry count.
4. **Administration** — cost center, owner, created / last updated.

### Notes

- Suggest reusing the portfolio's burn-bar and money formatters rather than re-deriving them here, so the detail page and the list can never disagree about a percentage.
- `currencyLocked` / `lockedEntryCount` are worth surfacing: they explain *why* the currency field is read-only in the edit form, and today that reason is invisible until you try to change it.

### Resolution — fixed 2026-08-19

Three sections added below the existing card, all fed from the payload the page already had — **no API change**:

- **Client** — customer (linked to the CRM record) and the project colour swatch, in the existing card.
- **Delivery** — logged hours, billable hours, entry count, locked-in-reports count.
- **Billing** — hourly rate, currency, billable-by-default, cost to date, and the budget burn bar, **gated on `staff.timesheets.rates.view`** so a rate hidden in the portfolio is not readable one click deeper.
- **Administration** — cost center (previously typed and never rendered), created, last updated.

Reuses `ProjectBudgetCell`, `computeBudgetBurn`, `formatCurrency` and `resolveProjectColorHex` rather than re-deriving, so the detail page and the portfolio cannot disagree. 17 i18n keys × 5 locales, parity verified. One incidental fix: the query engine returns `2026-05-24 00:00:00+00`, whose space separator and two-digit offset `Date` rejects, so timestamps rendered raw until the value is normalised.

Verified on Apollo: 658:10 logged, 565:10 billable, 213 entries, 90 locked, $150.00/h USD, $84,775.00 cost, 91% of 720 h.


---

## 3 — Task drawer quick-log accepts only a duration; needs description, date and billable inline

**Status:** fixed · **Severity:** medium (feature gap — logging a described, dated or non-billable hour forces you out of the drawer)
**Where:** task drawer → the row above **LOGGED TIME**

**Expected:** log a line of time from the drawer with at least **description, hours, date, billable** set inline.

**Actual:** one duration field (`1h 40m`) and a **Log** button. Everything else is assumed.

### Current behaviour — by design, and the design is documented

`lib/time-tracking-ui/TaskQuickLog.tsx:26-34`:

> There is no date, no person and no billable switch: the entry is written for today, for the signed-in person, billable — the defaults the note names — and anything else is a job for the full form.

`TaskDrawer.tsx:449-457` hard-codes exactly that:

```ts
staffMemberId: selfStaffMemberId,
date: todayIsoDate(),        // always today
durationMinutes: minutes,
taskId, timeProjectId,
isBillable: true,            // always billable
source: 'manual',
```

So this is a scope decision (US-C5, screen 7 note 1) rather than a defect — but the defaults are wrong often enough to be a real problem: **yesterday's forgotten hour and any non-billable hour cannot be logged here at all**, and no entry logged from the drawer can carry a note explaining what the time went on.

### No API change needed

`staffTimeEntryCreateSchema` (`data/validators.ts:302`) already accepts everything being asked for:

| Field | Schema | Sent by quick log today |
|---|---|---|
| `description` | `string().max(2000)` | ❌ |
| `notes` | `string().max(2000)` | ❌ |
| `date` | `coerce.date()` | today, hard-coded |
| `durationMinutes` | `int().min(0).max(1440)` | ✅ |
| `isBillable` | `boolean()` | `true`, hard-coded |
| `startedAt` / `endedAt` | `coerce.date()` | ❌ |
| `tagIds` | `array(uuid).max(50)` | ❌ |
| `rateOverrideAmount` | money | ❌ |

The endpoint, the command, the overlap check and the lock guard all already handle these. This is a UI-only change.

### Drawer width — needs a design-system decision first

The user offered to widen the drawer. Note that the width is **not** the staff module's to change:

`packages/ui/src/primitives/drawer.tsx:97-98`

```
// Figma Drawer [1.1] width: 400px (not the Tailwind max-w-md 448px)
'inset-y-0 right-0 h-full w-full max-w-[400px] rounded-l-xl '
```

400px is a Figma-pinned constant baked into `drawerContentVariants`, shared by every drawer in the product. Widening it means either a new `size` variant on the DS primitive or a local `className` override that silently diverges from Figma. Per `AGENTS.md` this is design-system governance — **ask before changing**. Recommended: add an explicit `size` variant (e.g. `md` = 400px default, `lg` = 560–640px) so the change is a deliberate, reusable DS decision rather than a one-off override.

### Suggested shape

Two options, in preference order:

1. **Keep the one-field quick log, add an expander.** The duration field and **Log** stay exactly as they are — the two-second path is the common one and should not get slower. A "More…" toggle reveals description, date, billable and tags in the same row group. No width change needed for the collapsed state; the expanded state benefits from the wider drawer.
2. **Inline row.** Duration · description · date · billable toggle on one line. Needs the wider drawer to avoid wrapping, and makes the common case visually busier.

Either way the existing `TimeEntryDialog` already renders all of these fields — reuse its field components rather than building a second set, or the drawer and the dialog will drift on validation and formatting.

### Resolution — fixed 2026-08-19

Kept the one-field quick log exactly as it was and added a **Details** expander holding description, date and a billable switch. The collapsed form is unchanged, so the two-second path did not get slower; a test pins that the extra fields are absent until expanded.

The date and billable flag **survive a save** while the duration and description clear — logging three lines against yesterday should not mean re-picking yesterday three times. The person stays fixed: logging for someone else is a different act with different permissions and belongs to the full form.

**No drawer width change was needed**, so the 400px Figma constant in `drawerContentVariants` is untouched and the design-system decision stays open rather than being made by side effect. Two tests in `__tests__/TaskDrawer.test.tsx`; 2 i18n keys × 5 locales.


---

## 4 — Clicking a time entry opens a different entry

**Status:** fixed · **Severity:** HIGH (wrong record shown; a save writes one entry's values onto another)
**Where:** Time tracking → Time entries → click any row

**Expected:** the dialog opens the entry that was clicked.

**Actual:** the dialog opens an unrelated entry. Clicking a **HBH / Consulting workshops, Wed Aug 19, 8:00, €1,200.00** row opened **"Design system and component library — Brightside Solar — Apollo — Website Redesign", 04/08/2026, 3h, 15:00–18:00, $150.00/h, $450.00** — different task, project, customer, date, duration *and* currency.

### Root cause — confirmed against the running API

`lib/time-tracking-ui/TimeEntryDialog.tsx:304` asks for the entry with **`?id=`**:

```ts
`/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}&pageSize=1`
```

The list route's query schema (`api/timesheets/time-entries/route.ts:91-111`) declares **`ids`** — plural — and no `id`. It is `.passthrough()`, so zod does not reject the unknown key: it passes it through unread, `buildFilters` never looks at it, and the filter silently disappears.

With the filter gone and `pageSize=1`, the route returns **the first entry in the default sort order**. Verified live:

```
asked for: 03531cc5-f6da-4aa1-ab11-79d9ec5aa14f
?id=…   → total: 522   got: 00f001ae-53f0-4190-93e8-cbd9c337c668   ← wrong entry, whole table matched
?ids=…  → total: 1     got: 03531cc5-f6da-4aa1-ab11-79d9ec5aa14f   ← correct
```

`total: 522` is the entire entry table — proof the filter was dropped rather than mismatched.

Every row therefore opens the same wrong entry, except the one row that happens to sort first.

### Why this is worse than a display bug

On save (`TimeEntryDialog.tsx:563`) the dialog sends:

```ts
isEdit ? { id: entryId, ...body } : …
```

`entryId` is the **clicked** id — correct. `body` is built from form state, which was populated from the **wrong** entry. So pressing **Save** writes the wrong entry's task, date, duration, times and billable flag **onto the entry you clicked**.

What has been preventing that so far is incidental: `versionRef.current` is set from the loaded (wrong) entry's `updatedAt` at line 374, so the optimistic-lock header carries a version that will not match the clicked row, and the write 409s. That is a safety net nobody designed for this, and it stops working the moment two entries share an `updatedAt` — which is exactly what a bulk write or a seeded batch produces.

### Fix

One character, then verify the rest:

```ts
`/api/staff/timesheets/time-entries?ids=${encodeURIComponent(entryId)}&pageSize=1`
```

Worth doing in the same pass:

1. **Assert the id you got back.** After loading, if `entry.id !== entryId`, refuse to populate and surface an error. A dialog silently editing a record other than the one asked for should be impossible to express, not merely unlikely.
2. **Reconsider `.passthrough()` on the list schema.** It is what turned a wrong parameter name into a silent full-table match instead of a 400. The projects route has the same shape — worth an audit of every `?id=` caller against the schema that receives it.
3. **The integration specs use `?id=` too** (`TC-STAFF-010/011/013/014/023`) — but on `DELETE`, where a separate delete schema (`id: z.string().uuid()`, line 536) does read it. Those are fine; only the GET path is affected. Worth confirming rather than assuming when fixing.

### Notes

- Not caught by tests: no test asserts that the dialog loads the entry it was asked for, and the API tests exercise `ids=`, never `id=`.
- Locked rows are unaffected — `onRowClick` returns early for them (`entries/page.tsx:836`).

### Resolution — fixed 2026-08-19

`TimeEntryDialog.tsx:302-321`:

1. `?id=` → `?ids=`.
2. Added the mismatch guard — if the response carries an id other than the one requested, the query throws and the dialog renders "Could not load the time entry." instead of populating. Nothing but a dropped filter can produce that, and populating anyway is what turns a display bug into a write onto the wrong record.
3. Added a `null` guard for `toTimeEntryRecord`, which the mismatch check exposed as nullable.

Two regression tests in `__tests__/TimeEntryDialog.test.tsx`: one pins the request to `ids=` and asserts no `id=` parameter, one asserts a mismatched response fails closed. **Both were confirmed to fail against the pre-fix code** — the suite's api mock is id-blind, which is why the original never caught this.

Verified in the browser: clicking the HBH row now opens *Consulting / workshops — HBH*, 2026-08-19, 8h, €1,200.00 at €150.00/h — matching the row. Staff suite 1387/1387, core typecheck clean, lint clean.

**Still open from this finding** (not fixed, needs a decision):

- The list schemas are `.passthrough()`, which is what turned a wrong parameter name into a silent full-table match rather than a 400. Tightening it is a contract change and may break custom-field filters that rely on passthrough — worth an explicit audit rather than a blind fix.
- The projects route reads `ids` **and defensively `id`** (`time-projects/route.ts:469`); the entries route reads only `ids`. Making that consistent server-side would stop this class of bug at the source rather than per caller.

---

## 5 — Selecting a customer leaves the picker looking empty

**Status:** fixed · **Severity:** high (the selection is invisible, so the form reads as broken)
**Where:** project create/edit → **Customer**

**Actual:** picking a customer (ExcelMed, checkmark shown in the list) left the field showing its `Search customers…` placeholder. Nothing on screen said what had been chosen.

### Root cause — confirmed

`packages/ui/src/backend/inputs/LookupSelect.tsx` — the visible input is the **search box**, not a value display, and reverts to its placeholder once the list collapses. The component accepts a `selectedHintLabel` prop, destructures it at line 65 — and **never renders it**. There was no code path anywhere that displayed the current selection.

The id was stored correctly; it was purely invisible. Saving would have attached the right customer, which makes it worse rather than better: the form looked like it had lost the input.

### Resolution — fixed 2026-08-19

Rendered the collapsed-state summary the prop was always for: the resolved label plus a Clear button, falling back to the raw id when no resolver is given. Four tests in `packages/ui/src/backend/inputs/__tests__/LookupSelect.test.tsx`.

**This is a shared primitive** — every `LookupSelect` caller in the product gains the same summary, and any that was silently affected is now fixed too.

Verified: the project edit page now shows **Brightside Solar** with a Clear button.

---

## 6 — Task references need short project codes and a searchable picker

**Status:** partly done · **Severity:** medium (feature request)
**Where:** time entry dialog → **Task** picker; project code derivation

**Asked for:** 3-letter project codes, per-project incrementing task numbers (`ADS-21`, `ADS-6043`), and a picker you can search by code or number.

### What already exists

The numbering scheme is **already built and shipped**. `staff_time_tasks.reference` is `<project.code>-<sequence_number>`, allocated by `formatTaskReference` and made race-safe by a partial unique index on `(organization_id, tenant_id, time_project_id, sequence_number)`. It is denormalized and frozen at creation precisely so a closed report keeps quoting the same number after a rename.

Three things were missing.

**A. The picker never showed it.** ✅ **Fixed** — `toTaskOption` dropped `reference` on the floor and `describeTaskOption` built `Title — Customer — Project`. The reference now leads: `APOLLO-14 · Booking flow rebuild — Brightside Solar — Apollo`. Three tests added. This is why the screenshot shows three indistinguishable `Consulting / workshops` rows.

**B. The picker is not searchable.** ⛔ **Not done.** It is a plain `Select` (`SelectValue`/`SelectItem`), not a search input, and the tasks route searches **title only**:

```ts
// api/timesheets/tasks/route.ts:289
const term = sanitizeSearchTerm(query.q)
if (term) filters[F.title] = { $ilike: `%${term}%` }   // reference not searched
```

Needs both halves: an OR across `title` and `reference` server-side, and swapping the `Select` for a searchable control. `LookupSelect` is the obvious candidate — it is already used for the customer picker and now renders its selection correctly (finding 5).

**C. 3-letter project codes.** ⛔ **Not done — needs a decision.** This one contradicts a recorded spec decision and has consequences:

- **Spec D-10** sets the code derivation at a 19-word budget with a 20-character cap, deliberately, so that references stay readable. Dropping to 3 letters is a reversal of that decision, not an implementation detail.
- **Collisions become the normal case.** Three letters is ~17.5k combinations, and derived-from-name codes cluster hard (`Apollo`→`APO`, `Apex`→`APE`, `Aponia`→`APO`). The code carries a partial unique index per organization, so the derivation needs a documented disambiguation rule (`APO`, `AP2`, `APO1`?) rather than failing the save.
- **Existing projects keep their codes.** `code` is frozen after creation and `reference` is frozen per task, both on purpose. So today's `ERGO-HESTIA-KORPO-4` and `DENTALOS-2` stay as they are, and only new projects get short codes — the tenant ends up with both conventions side by side unless codes are backfilled, which would break every already-quoted reference.

**Question before I build C:** should 3 letters be the *default derivation* for new projects (with a collision rule), or a *hard constraint* enforced on every project including a migration of existing codes? The first is safe and inconsistent; the second is consistent and breaks references already printed on client-facing reports.

---

## 7 — Tags: no way to create one inline, and no colour

**Status:** open · **Severity:** medium (feature request)
**Where:** time entry dialog → **Tags**; task drawer tags

**Asked for:** add **existing and new** tags from the same control, in the style of the reference screenshot — coloured chips, a searchable list, and "create it if it doesn't exist yet".

### What exists today

- `TimeEntryDialog` renders a plain "Add tag" combobox over `tagOptions`, filtered to tags not already assigned (`TimeEntryDialog.tsx:652`). It can only ever pick from what already exists.
- `staff_time_tags` **already carries a `color`** column (a `PROJECT_COLOR_KEYS` key, validated by `staffTimeTagCreateSchema`), and the demo seed sets one on all five tags. **The colour is stored and never rendered** — the chips are monochrome.
- Creation is fully supported server-side: `POST /api/staff/timesheets/tags` via `staffTimeTagCommandIds.create`, with `slug`, `label` and `color`.

So this is a UI change on both counts — nothing to add to the schema or the API.

### What it needs

1. **Render the colour.** The data is already there; the chips just ignore it. Cheapest visible win.
2. **Create-on-type.** A "Create «foo»" affordance in the dropdown that POSTs the tag then assigns it. Slug derivation already exists (`timeSlugSchema` / `slugifyProjectName`); the partial unique index on `(organization_id, tenant_id, slug)` makes a duplicate a 409 to surface, not a silent second tag.
3. **One control, both surfaces.** The entry dialog and the task drawer should share it, or they will drift the way the drawer and dialog drifted on time logging (finding 3).

### Note

`TagsInput` already exists in `packages/ui/src/backend/inputs/` and may cover most of this. Worth reading before building a staff-local control — the same reasoning as reusing `TimeEntryDialog`'s fields for the drawer.

---

## 8 — Dialog footer keyboard hints wrap into columns

**Status:** fixed · **Severity:** low (cosmetic)
**Where:** time entry dialog → footer

**Actual:** "save and add another" collapsed into a four-line column squeezed between the shortcut keys, mangling the footer.

### Root cause

`TimeEntryDialog.tsx:1109` — the hint strip is `flex items-center gap-1` with no wrap control. Each label is its own flex item, so under pressure from the three buttons the longest one shrinks and wraps internally instead of staying on the line.

### Resolution — fixed 2026-08-19

`whitespace-nowrap` on the strip, and hidden below the `sm` breakpoint: on a narrow dialog the hint competes with the buttons for room it does not deserve, and a keyboard hint is useless on a touch device anyway.

---

## 9 — Time entries should default to my own entries

**Status:** open · **Severity:** medium
**Where:** Time tracking → Time entries

**Actual:** the list shows **everyone's** entries. A manager opening their own timesheet lands in a page dominated by other people's hours; on the demo tenant that is 522 rows.

### Root cause

`entries/page.tsx:263-277` never sends `staffMemberId`, so the route returns every entry the caller may see — which, for anyone holding `manage_all`, is all of them. The default filter state seeds only a period:

```ts
const [filterValues, setFilterValues] = React.useState<FilterValues>(() => ({
  period: { from: defaultRange.from, to: defaultRange.to },
}))
```

### What it needs

The API side is **already there** — `staffMemberId` is in the list schema (line 93) and filters correctly. This is client-only:

1. Resolve the signed-in staff member (`/api/staff/team-members/self`, already used by `TimeEntryDialog`).
2. Seed `filterValues.staffMemberId` with it.
3. Add a **Person** filter so someone with `manage_all` can widen to the whole team — a default, not a cage.

Worth deciding: for a caller **without** `manage_all` the route already scopes to their own entries, so the filter should be hidden rather than shown-and-useless for them.

---

## 10 — Entry filters are too thin

**Status:** open · **Severity:** medium
**Where:** Time entries → **Filters** overlay

**Actual:** two filters — Period and Project (`entries/page.tsx:556-573`). The overlay is mostly empty space.

Worse, the Project options are built **from the rows currently on screen**:

```ts
options: rows.filter((row) => row.timeProjectId).map(...)
```

so a project with no entry on the current page cannot be filtered to — the filter can only narrow to what you can already see.

### What is free today (API already supports it)

| Filter | Schema field | Work |
|---|---|---|
| Person | `staffMemberId` | client only — see finding 9 |
| Task | `taskId` (accepts a comma list) | client only |
| Running timer | `running` | client only |

### What needs a route change

| Filter | Why |
|---|---|
| Billable / non-billable | no `isBillable` in `listSchema`; the column renders it, nothing filters it |
| Locked / unlocked | **already recorded as a known gap** — the spec's API Contracts promise a `locked` / `lockedReportId` filter that was never implemented |
| Tag | `staff_time_entry_tags` exists and the demo seeds 176 assignments; no filter reaches them |
| Free-text description | no `q` on this route, unlike tasks and projects |

### Also worth fixing while in there

Project options should come from `/api/staff/timesheets/time-projects`, not from the loaded rows, so the filter can reach a project that has no entry in the current period.
