# Default Chart of Accounts — importable Polish starter plan kont

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(owns `LedgerAccountType`/`LedgerAccount`/`LedgerAccountGroup` and the
existing `createLedgerAccountType`/`createLedgerAccount` commands and
`ledger.accounts.manage` permission this document builds on directly
— no new module, no new entity), [Journal Entry Line Dimension](2026-09-06-journal-entry-line-dimension.md)
and [Posting Rules Engine](2026-09-06-posting-rules-engine.md) (both
consume `LedgerAccount`/`LedgerAccountGroup` rows this document helps
populate faster, but neither is a dependency of this document)

## TLDR

A single new command, `ledger.importDefaultChartOfAccounts`, that
bulk-creates a hardcoded, editable-afterward set of `LedgerAccountType`
and `LedgerAccount` rows implementing a representative Polish
"wzorcowy plan kont" (zespoły 0–8), plus one button on the existing
chart-of-accounts backend page that calls it. Opt-in only: nothing
changes about `ledger`'s existing Phase 1 behavior of shipping every
new organization with an empty chart of accounts. No new module, no
new entity, no new table — this document adds one command and one seed
data file to the `ledger` module `ledger` already owns.

## Overview

`ledger` (#5663) already seeds `LedgerAccountGroup` (the zespoły 0–8
classification buckets, system reference data) into every
organization, but deliberately seeds nothing into `LedgerAccountType`
or `LedgerAccount` — "no default chart of accounts
(`LedgerAccountType`/`LedgerAccount`) is seeded; tenants build their
own" (#5663, Design decisions). That decision stands: every real
system checked for this document (see Literature & Prior Art) treats
populating the *actual* chart of accounts as a distinct step from
seeding jurisdiction reference data, and two of the three Polish-market
systems checked (enova365, Symfonia) make that step explicitly
optional, not automatic. This document adds that step as an opt-in
action — not a change to what happens automatically when an
organization is created.

## Problem Statement

Today, after GL core engine seeds `LedgerAccountGroup`, an organization
still has zero `LedgerAccountType` and zero `LedgerAccount` rows. To
post a single journal entry, someone must first create every account
type and every account by hand through `createLedgerAccountType`/
`createLedgerAccount` — for a representative Polish plan kont covering
the nine zespoły, that's dozens of accounts before the ledger is
usable at all. Every real accounting system checked for this document
(ERPNext, enova365, Symfonia) offers a faster starting point than
building from zero, either automatically or as an explicit action —
this project has neither today.

## Proposed Solution

One new command in the existing `ledger` module,
`importDefaultChartOfAccounts`, that creates a fixed, hardcoded set of
`LedgerAccountType` rows (each linked to the correct, already-seeded
`LedgerAccountGroup` for its zespół) and `LedgerAccount` rows (each
linked to the correct `LedgerAccountType`), inside one transaction,
undoable as a single operation. A new button, "Zaimportuj domyślny
plan kont," on the existing `backend/ledger/accounts/page.tsx`, gated
by the same `ledger.accounts.manage` permission that already guards
manual account creation, calls it. The command refuses to run if the
organization already has any non-deleted `LedgerAccountType` or
`LedgerAccount` row — it is a starting point for an empty ledger, not
a merge tool.

Every imported row is a completely ordinary `LedgerAccountType`/
`LedgerAccount` row afterward: editable, deletable (subject to the
same posted-entries guards #5663 already enforces), and never read by
name or number anywhere in this codebase — per the knowledge base's
own "account numbers are illustrative, never literal" convention (§2),
this command seeds *data*, not a convention any other module's logic
depends on.

## Design Decisions

**Extends `ledger` directly — not a new module.** Every other document
in this family that introduced a new module (Journal Entry Line
Dimension, Fixed Assets) did so because it needed a new entity other
modules would read directly, or because more than one independent
consumer needed to depend on it without depending on each other (see
`2026-09-06-journal-entry-line-dimension.md`, Design Decisions, "Why
this is a separate document"). Neither applies here: this document
adds no entity, writes only into two tables `ledger` already owns, and
has exactly one caller (an admin, through one button). A new module
with a hard dependency on `ledger` just to call one command would add
a module-boundary crossing this feature doesn't need — the command
belongs where its data lives.

**Opt-in only, never automatic, and never wired into `onTenantCreated`
— corrected in scope from an earlier draft's wider onboarding-wizard
idea.** An earlier version of this document considered offering the
import as a step inside the organization-creation flow itself
(matching how ERPNext, enova365, and Symfonia all surface a
chart-of-accounts choice at setup time — see Literature & Prior Art).
Scoped out of Phase 1 after discussion: wiring a new choice into the
organization-creation flow touches onboarding UI this document's own
narrow chart-of-accounts scope shouldn't have to own, and — more
importantly — every other module in this family ships a manual,
explicit trigger in Phase 1 and defers the automated/onboarding-
integrated version to Phase 2 (the same "data model + manual trigger
first, automation later" split the knowledge base's §2 already names
as this project's own convention, e.g. Fixed Assets' manual
depreciation trigger vs. its Phase 2 scheduler). Phase 2 (Out of
Scope) is exactly that onboarding integration — tracked deliberately,
not dropped, so the alternative stays visible for whoever picks this
up next.

**Refuses to run against a non-empty chart of accounts, rather than
merging or skipping duplicates.** ERPNext's own Chart of Accounts
Importer enforces the same precondition on the opposite flow (replacing
its automatic default) — "make sure the company... doesn't have any
pre-existing transactions" — and Symfonia warns that some chart-of-
accounts-adjacent settings become permanently fixed once the first
year of postings begins. A clean "the ledger must currently have zero
non-deleted `LedgerAccountType`/`LedgerAccount` rows" precondition
avoids ever having to define what "merge this template into an
existing, customized chart of accounts" should mean — a real, harder
problem this document doesn't need to solve to be useful. Soft-deleted
rows don't block the import (nothing meaningful is lost by importing
alongside them), matching how every other posted-entries guard in
`ledger` already treats `deletedAt`.

**One command, one transaction, one undo — not `commandBus.execute`
calls to `createLedgerAccountType`/`createLedgerAccount` in a loop.**
Looping the existing per-row commands would reuse their validation for
free, but would also produce one `buildLog` undo entry per row (dozens
of undo-log rows for one logical action) and no single point to
enforce the empty-chart-of-accounts precondition atomically against a
concurrent import attempt. Instead, `importDefaultChartOfAccounts`
validates its own hardcoded template data once (through the same
`data/validators.ts` schemas `createLedgerAccountType`/
`createLedgerAccount` already use — no new validation rules, just
reused ones), then inserts every row inside one `withAtomicFlush`
transaction, and records every created id in its own `buildLog`
payload (`{ undo: { createdAccountTypeIds, createdAccountIds } }`) so
`undo` deletes exactly those rows in one call — content-idempotent in
the same sense JELD's own write command is (see
`2026-09-06-journal-entry-line-dimension.md`, Design Decisions, "Undo
contract").

**Hardcoded Polish template data, not a JSON seed file or an admin-
editable template entity.** Matches the existing, real precedent this
module already set for exactly this kind of system reference data:
`lib/seeds.ts`'s `seedPolishAccountGroups` is a hardcoded TypeScript
array, not an external file or an editable table (#5663, File
Manifest). A template a tenant might want to tweak before importing is
a real, harder feature (parametrized templates by business type, the
way enova365 and Symfonia both offer — see Literature & Prior Art) —
correctly Phase 2, not Phase 1: this document's own accounts are
ordinary rows the moment they're created, editable through the
existing `createLedgerAccountType`/`updateLedgerAccountType`/
`updateLedgerAccount` commands like any other, so "I don't like this
template" is already solvable today by editing after import, just not
by *choosing a different template* before it.

**Representative, not exhaustive.** The Phase 1 template (see Data
Models) covers a working subset of each zespół — enough to post a
real, small business's transactions — not a full multi-hundred-line
professional plan kont. Real systems checked for this document
similarly ship a starting point meant to be adjusted, not a complete,
final answer (Symfonia's own docs: "dostosuj plan kont do swoich
potrzeb"; enova365's: "dostosuj plan kont do swoich potrzeb" after
import). Expanding the template's coverage later is pure data, not a
schema or command change.

## Alternatives Considered

| Option | Why rejected/deferred |
| --- | --- |
| Reverse GL core engine's decision and auto-seed a chart of accounts at `onTenantCreated`, like ERPNext does | Rejected. ERPNext's own default-seed-then-optionally-replace model is a genuine, deliberate divergence recorded in Literature & Prior Art, not a gap to close — GL core engine's "no default chart of accounts is seeded; tenants build their own" is an explicit, load-bearing Phase 1 decision (#5663, Design decisions), and two of the three Polish-market systems checked (enova365, Symfonia) also make this an explicit action rather than an automatic one. Reopening that decision is out of scope for a document whose whole job is to add an *opt-in* faster starting point, not to relitigate what happens automatically. |
| Loop `commandBus.execute` calls to the existing `createLedgerAccountType`/`createLedgerAccount` commands instead of one new command | Rejected — see Design Decisions, "One command, one transaction, one undo." Reuses per-row validation for free, but produces one `buildLog` undo entry per row instead of one undo for the whole import, and has no single point to enforce the empty-chart-of-accounts precondition atomically. |
| A new standalone module (e.g. `chart_of_accounts_templates`) owning this command | Rejected — see Design Decisions, "Extends `ledger` directly." No new entity, no independent consumer other than the one admin button; a new module would add a dependency-boundary crossing this feature doesn't need. |
| Wire the import into the organization-creation/onboarding wizard in Phase 1, matching how ERPNext, enova365, and Symfonia all surface a chart-of-accounts choice at setup time | Deferred to Phase 2, not rejected — see Design Decisions, "Opt-in only, never automatic," and Out of Scope. Kept deliberately visible per explicit instruction rather than dropped: every other module in this family ships a manual trigger in Phase 1 and defers onboarding/automation integration to Phase 2, and wiring a new choice into org-creation UI is a larger, separate piece of work this document's narrow scope shouldn't have to own in one pass. |
| A JSON seed file or an admin-editable "chart of accounts template" entity instead of hardcoded TypeScript data | Rejected for Phase 1 — see Design Decisions, "Hardcoded Polish template data." Matches the existing `seedPolishAccountGroups` precedent; a genuinely editable/parametrized template (by business type, the way enova365/Symfonia offer) is a real Phase 2 feature, not a data-format choice to make speculatively now. |
| Merge into an existing non-empty chart of accounts (skip duplicates by slug, or upsert) instead of refusing to run | Rejected — see Design Decisions, "Refuses to run against a non-empty chart of accounts." Defining a correct merge semantics against an already-customized chart is a real, harder problem this document doesn't need to solve to be useful; a clean empty-chart precondition sidesteps it entirely. |

## Architecture

### Entities

No new entities. This document writes only into the three entities GL
core engine (#5663) already owns and this document treats as
authoritative: `LedgerAccountGroup` (read-only here — every row this
document creates links to an `accountGroupId` GL core engine already
seeded via `seedPolishAccountGroups`; this document never creates or
modifies a `LedgerAccountGroup` row), `LedgerAccountType` (created by
this document's command, using the same shape `createLedgerAccountType`
already validates: `slug`, `name`, `normalBalance`, optional
`parentAccountTypeId`, optional `accountGroupId`), and `LedgerAccount`
(created by this document's command, using the same shape
`createLedgerAccount` already validates: `slug`, `accountTypeId`,
optional `parentAccountId`, optional `description`). No migration, no
schema change.

### Access Control

Reuses the two `ledger` features GL core engine already defined — no
new feature, no new permission string:

- **`ledger.accounts.manage`** — already required by
  `createLedgerAccountType`/`createLedgerAccount`/
  `updateLedgerAccountType`/`updateLedgerAccount`; this document's
  `importDefaultChartOfAccounts` command requires the same permission,
  since importing a template is, functionally, bulk account creation.
  No separate "who may import a template" permission — anyone already
  trusted to create accounts by hand is trusted to import a template
  that creates the same kind of rows faster.
- **`ledger.accounts.view`** — unaffected; imported rows are ordinary
  `LedgerAccountType`/`LedgerAccount` rows and are visible to anyone who
  can already view the chart of accounts, through the same existing
  `DataTable` on `backend/ledger/accounts/page.tsx`.

### Module

No `ledger` module manifest change beyond registering one new command.
No new module dependency (this document adds no import of any other
module, and no other module needs to depend on this one — every
consumer of the rows it creates already depends on `ledger` for
`LedgerAccountType`/`LedgerAccount` directly).

### Commands

**`ledger.importDefaultChartOfAccounts`** — the one new command this
document adds.

- **Input**: no caller-supplied fields in Phase 1 — the template is
  fixed (see Data Models), so the command takes no parameters beyond
  the tenant/organization scope `commandBus.execute` already threads
  through every command's context. (A future Phase 2 with multiple
  selectable templates would add a `templateId`-shaped input then; not
  needed while there is exactly one template.)
- **Precondition check**: counts non-deleted `LedgerAccountType` rows
  and non-deleted `LedgerAccount` rows in the caller's tenant/
  organization scope. If either count is greater than zero, the command
  fails validation without writing anything — "the chart of accounts
  already has N account type(s)/M account(s); import refuses to run
  against a non-empty chart of accounts" (see Design Decisions,
  "Refuses to run against a non-empty chart of accounts"). Soft-deleted
  rows (`deletedAt` set) don't count toward this precondition.
- **Validation**: every hardcoded template row is validated once
  through the same `data/validators.ts` schemas
  `createLedgerAccountType`/`createLedgerAccount` already use — no new
  validation rules (see Design Decisions, "One command, one
  transaction, one undo").
- **Write**: inserts every `LedgerAccountType` row first (in an order
  that satisfies each row's own `parentAccountTypeId`/`accountGroupId`
  reference), then every `LedgerAccount` row (satisfying
  `accountTypeId`/`parentAccountId`), inside one `withAtomicFlush`
  transaction.
- **Undo**: records every created id in its own `buildLog` payload
  (`{ undo: { createdAccountTypeIds, createdAccountIds } }`), so `undo`
  removes exactly those rows in one call — the same content-idempotent
  undo contract JELD's own write command already established (see
  `2026-09-06-journal-entry-line-dimension.md`, Design Decisions, "Undo
  contract").
- **Permission**: `ledger.accounts.manage`.

### Events

None emitted in Phase 1. Matches this family's own YAGNI convention for
events (see the knowledge base's §2 event-driven-posting notes on only
emitting events an actual consumer needs today): nothing in this
codebase currently needs to react to "a chart of accounts was
imported" as distinct from "an account was created," and every
imported row is already an ordinary `LedgerAccountType`/`LedgerAccount`
row a future consumer could listen for at the existing granularity if
that need arises.

### Backend Pages

One new button, "Zaimportuj domyślny plan kont," on the existing
`backend/ledger/accounts/page.tsx` (alongside the existing "create
account"/"create account type" actions), gated by
`ledger.accounts.manage` — hidden entirely for a viewer who only has
`ledger.accounts.view`. On success, the page's existing `DataTable`
refreshes to show every imported row. On the precondition failure, the
page surfaces the command's own refusal message rather than a generic
error, so an admin immediately understands why ("your chart of accounts
already has accounts — this import is only for starting from empty").
No new page, no new route — one action added to a page GL core engine
already built.

## Data Models

The template is **representative, not exhaustive** (see Design
Decisions) — a working subset of each zespół, covering enough of a
small business's transactions to post real journal entries, not a
complete professional plan kont. Every code below is illustrative, per
the knowledge base's own "account numbers are illustrative, never
literal" convention (§2) — nothing in this codebase parses or depends
on any of these specific `slug` values; they exist so an imported
account is recognizable to a Polish bookkeeper, not so other code can
match against them. Each `LedgerAccountType`'s `accountGroupId` links
to the `LedgerAccountGroup` row GL core engine already seeded for that
zespół (`jurisdiction: 'PL'`, `code` matching the zespół number).

**Zespół 0 — Aktywa trwałe:**

| `LedgerAccountType` (`slug` / `name` / `normalBalance`) | Child `LedgerAccount` rows |
| --- | --- |
| `010` / Środki trwałe / DEBIT | `010-1` Budynki i lokale; `010-2` Maszyny i urządzenia techniczne; `010-3` Środki transportu |
| `020` / Wartości niematerialne i prawne / DEBIT | `020-1` Licencje i oprogramowanie |
| `070` / Umorzenie środków trwałych / CREDIT | `070-1` Umorzenie środków trwałych |
| `071` / Umorzenie wartości niematerialnych i prawnych / CREDIT | `071-1` Umorzenie wartości niematerialnych i prawnych |
| `072` / Odpisy aktualizujące środki trwałe oraz wartości niematerialne i prawne / CREDIT | `072-1` Odpisy aktualizujące środki trwałe oraz WNiP |

**Zespół 1 — Środki pieniężne, rachunki bankowe i inne krótkoterminowe
aktywa finansowe:**

| `LedgerAccountType` | Child `LedgerAccount` rows |
| --- | --- |
| `100` / Kasa / DEBIT | `100-1` Kasa złotowa |
| `130` / Rachunki bankowe / DEBIT | `130-1` Rachunek bieżący PLN; `130-2` Rachunek walutowy EUR |

**Zespół 2 — Rozrachunki i roszczenia:**

| `LedgerAccountType` | Child `LedgerAccount` rows |
| --- | --- |
| `200` / Rozrachunki z odbiorcami / DEBIT | `200-1` Rozrachunki z odbiorcami krajowymi |
| `210` / Rozrachunki z dostawcami / CREDIT | `210-1` Rozrachunki z dostawcami krajowymi |
| `220` / VAT naliczony / DEBIT | `220-1` VAT naliczony podlegający odliczeniu |
| `221` / VAT należny / CREDIT | `221-1` VAT należny |
| `225` / Rozrachunki z ZUS / CREDIT | `225-1` Rozrachunki z ZUS |
| `230` / Rozrachunki z tytułu wynagrodzeń / CREDIT | `230-1` Rozrachunki z pracownikami z tytułu wynagrodzeń |

**Zespół 3 — Materiały i towary:**

| `LedgerAccountType` | Child `LedgerAccount` rows |
| --- | --- |
| `300` / Rozliczenie zakupu / DEBIT | `300-1` Rozliczenie zakupu materiałów i towarów |
| `310` / Materiały / DEBIT | `310-1` Materiały w magazynie |
| `330` / Towary / DEBIT | `330-1` Towary w magazynie |

**Zespół 4 — Koszty według rodzajów i ich rozliczenie:**

| `LedgerAccountType` | Child `LedgerAccount` rows |
| --- | --- |
| `400` / Amortyzacja / DEBIT | `400-1` Amortyzacja środków trwałych |
| `401` / Zużycie materiałów i energii / DEBIT | `401-1` Zużycie materiałów; `401-2` Zużycie energii |
| `402` / Usługi obce / DEBIT | `402-1` Usługi obce |
| `403` / Podatki i opłaty / DEBIT | `403-1` Podatki i opłaty |
| `404` / Wynagrodzenia / DEBIT | `404-1` Wynagrodzenia |
| `405` / Ubezpieczenia społeczne i inne świadczenia / DEBIT | `405-1` Ubezpieczenia społeczne |
| `409` / Pozostałe koszty rodzajowe / DEBIT | `409-1` Pozostałe koszty rodzajowe |

**Zespół 5 — Koszty według typów działalności i ich rozliczenie:**

| `LedgerAccountType` | Child `LedgerAccount` rows |
| --- | --- |
| `550` / Koszty zarządu / DEBIT | `550-1` Koszty zarządu |
| `552` / Koszty sprzedaży / DEBIT | `552-1` Koszty sprzedaży |

**Zespół 6 — Produkty i rozliczenia międzyokresowe:**

| `LedgerAccountType` | Child `LedgerAccount` rows |
| --- | --- |
| `600` / Produkty gotowe / DEBIT | `600-1` Wyroby gotowe |
| `640` / Rozliczenia międzyokresowe kosztów czynne / DEBIT | `640-1` Rozliczenia międzyokresowe kosztów czynne |

**Zespół 7 — Przychody i koszty związane z ich osiągnięciem:**

| `LedgerAccountType` | Child `LedgerAccount` rows |
| --- | --- |
| `700` / Przychody ze sprzedaży produktów / CREDIT | `700-1` Przychody ze sprzedaży produktów |
| `701` / Koszt sprzedanych produktów / DEBIT | `701-1` Koszt sprzedanych produktów |
| `730` / Przychody ze sprzedaży towarów / CREDIT | `730-1` Przychody ze sprzedaży towarów |
| `731` / Wartość sprzedanych towarów w cenie zakupu / DEBIT | `731-1` Wartość sprzedanych towarów w cenie zakupu |
| `750` / Przychody finansowe / CREDIT | `750-1` Przychody finansowe |
| `751` / Koszty finansowe / DEBIT | `751-1` Koszty finansowe |
| `760` / Pozostałe przychody operacyjne / CREDIT | `760-1` Pozostałe przychody operacyjne |
| `761` / Pozostałe koszty operacyjne / DEBIT | `761-1` Pozostałe koszty operacyjne |

**Zespół 8 — Kapitały (fundusze) własne, fundusze specjalne i wynik
finansowy:**

| `LedgerAccountType` | Child `LedgerAccount` rows |
| --- | --- |
| `800` / Kapitał (fundusz) podstawowy / CREDIT | `800-1` Kapitał (fundusz) podstawowy |
| `820` / Rozliczenie wyniku finansowego / CREDIT | `820-1` Rozliczenie wyniku finansowego |
| `840` / Rozliczenia międzyokresowe przychodów / CREDIT | `840-1` Rozliczenia międzyokresowe przychodów |
| `860` / Wynik finansowy / CREDIT | `860-1` Wynik finansowy |

`840` / Rozliczenia międzyokresowe przychodów (RMP) is a forward
pointer added for the new Deferred Revenue spec
(`2026-09-17-deferred-revenue.md`, PR #6193): Zespół 6 already carried
`640` Rozliczenia międzyokresowe kosztów czynne (prepaid costs, DEBIT)
but Zespół 8 had no liability-side counterpart for revenue received
before it is earned. `840` mirrors `640`'s role on the credit side —
the account `RevenueDeferral` records against until the recognition
schedule accrues it into `700`/`730`.

Zespół 0's `070`/`071`/`072` split — separate accumulated-depreciation
accounts for tangible (`070`) and intangible (`071`) fixed assets, and
a third, genuinely separate accumulated-impairment account (`072`) —
follows Fixed Assets' own 2026-09-09 correction
(`2026-09-06-fixed-assets.md`, Changelog, "dedicated accumulated-
impairment account, corrected against a reference chart of accounts"):
real Polish practice keeps planned depreciation and one-off impairment
write-downs on genuinely separate synthetic accounts, and `FixedAsset`
already has a dedicated `ledgerAccumulatedImpairmentAccountId` field
expecting exactly this account to exist. Per
`financial-spec-citation-check`: this specific numbering is sourced
from the same external reference chart of accounts (supplied by the
accounting team) that Fixed Assets' own correction cites, not from
Kieso/Hay/Fowler — none of the three covers Polish chart-of-accounts
numbering at this level of detail (see Literature & Prior Art).

Totals: 39 `LedgerAccountType` rows, 43 `LedgerAccount` rows across the
nine zespoły — deliberately leaving numbering gaps within each zespół
(e.g. `010`/`020`/`070`, not `010`/`011`/`012`) matching Kieso's own
Illustration 3.9 convention of numbering with intentional gaps "to
permit the insertion of new accounts" (see Literature & Prior Art) —
every gap here is exactly that: room for a tenant to insert their own
account after import without renumbering anything this document
created.

## API Contracts

No new HTTP routes. The existing `backend/ledger/accounts/page.tsx`
already has client-side access to `commandBus` for its existing
create/update actions; the new "Zaimportuj domyślny plan kont" button
calls `commandBus.execute('ledger.importDefaultChartOfAccounts', {})`
the same way the page's existing actions call their own commands. **Open
validation point for implementation**: whether the existing CRUD-route
plumbing already exposes a generic non-CRUD "run this command" endpoint
the button can call, or whether one thin route needs adding to trigger
this one command from the client — this should be confirmed against
whatever mechanism the codebase already uses elsewhere for a
non-CRUD, button-triggered command (if one already exists) before
implementation starts; this document does not invent new generic
command-triggering infrastructure either way.

## Literature & Prior Art

Per the project's `financial-spec-writing-process`, this section grounds
the decision to ship a hardcoded, non-enforced starter template against
Fowler and Hay, and adds the real-system comparison this document's
Overview and Design Decisions already lean on. All page numbers verified
against the full-text extraction (see
`financial-module-knowledge-base.md` §3 for the verification method);
this is the first document in this family to cite Kieso for a
chart-of-accounts-shape claim rather than only for recognition/
measurement rules.

**Kieso's Illustration 3.9 (ch. 3, pp. 3-12–3-13) confirms deliberate
numbering gaps are standard practice, not an implementation shortcut.**
Kieso presents a real numbered chart of accounts organized by account
type (assets in the 100s, liabilities in the 200s, and so on), with
gaps deliberately left inside each range specifically to permit the
insertion of new accounts later without renumbering anything already
in use. This document's own template (see Data Models) follows exactly
that convention at the zespół level — `010`/`020`/`070`, not
`010`/`011`/`012` — for the same reason Kieso gives: an admin who wants
to insert their own account under zespół 0 after importing this
template has numbering room to do it without renumbering anything this
document created.

**Hay, ch. 7, p. 119 — "the organization has wide latitude in setting
up the specific list" of account types — is direct, primary-source
support for treating this document's own template as a starting point
rather than an enforced structure.** Hay makes this point in the
context of ACCOUNT TYPE definitions generally: there is no universal,
externally-imposed list of account types an organization must use:
each organization defines its own. That is precisely this document's
own stance on the imported rows — every one becomes an ordinary,
editable `LedgerAccountType`/`LedgerAccount` row the moment it's
created (see Design Decisions, "Representative, not exhaustive"), not
a fixed structure the codebase enforces afterward.

**Confirmed absence: Fowler has zero "chart of accounts" mentions
anywhere in *Analysis Patterns*.** A full-text search for "chart of
accounts" across the complete book returns no matches. Fowler's
accounting chapter is about the shape of individual postings and
account roll-ups (already the source for JELD's and GL core engine's
own citations elsewhere in this knowledge base), not about how an
organization's initial set of accounts gets populated — a genuine gap
in that source for this document's specific question, not a missed
citation.

**Real-system comparison.**

- **ERPNext** (Chart of Accounts, docs.frappe.io, verified 2026-09-15):
  a genuine, honestly-recorded divergence, not a validation. ERPNext
  does the *opposite* of this document's design — it automatically
  seeds a default chart of accounts at company-creation time, and
  separately offers a "Chart of Accounts Importer" to replace that
  default, but only while "the company... doesn't have any
  pre-existing transactions" (the same precondition quote already
  informing this document's own "refuses to run against a non-empty
  chart of accounts" rule — see Design Decisions). ERPNext's choice to
  auto-seed is exactly the option this document's Alternatives
  Considered table records as rejected: GL core engine's own explicit
  Phase 1 decision not to auto-seed a chart of accounts stands, and
  this document doesn't reopen it.
- **enova365** (enova.pl, Księga Handlowa module documentation,
  verified 2026-09-15): matches this document's design closely — a
  chart of accounts is offered as an explicit, optional import at
  company setup rather than seeded automatically, from a choice of
  templates by business type, and is fully editable afterward
  ("dostosuj plan kont do swoich potrzeb" — adjust the chart of
  accounts to your needs). The choice-of-templates-by-business-type
  detail is exactly the Phase 2 parametrized-template idea this
  document defers (see Design Decisions, "Hardcoded Polish template
  data").
- **Symfonia** (finanse.wsparcie.symfonia.pl, "Krok 5: Konfiguracja
  nowej firmy," verified 2026-09-15): also matches closely — generating
  or importing a chart of accounts is presented as a recommended but
  optional step during company setup, with the same "dostosuj plan
  kont do swoich potrzeb" framing, and a caveat that some
  chart-of-accounts-adjacent settings become fixed once the first
  posting year begins — independent confirmation, from a second
  Polish-market system, of the same "don't allow changes once
  transactions exist" caution ERPNext's Importer precondition already
  raised.
- **Comarch ERP Optima**: inconclusive. Comarch's public documentation
  (pomoc.comarch.pl) didn't yield a clear, checkable statement of
  whether a default or template chart of accounts is offered at
  company setup — recorded honestly as unverified rather than forced
  into a comparison, consistent with how this same source was treated
  elsewhere in this knowledge base.

Together, enova365 and Symfonia — the two Polish-market systems this
document is most directly comparable to — both validate the
opt-in/optional/template shape this document chose, while ERPNext's
opposite (auto-seed-then-replace) choice is recorded as a deliberate,
explained divergence rather than smoothed over: this document's own
Alternatives Considered table already explains why GL core engine's
existing no-auto-seed decision isn't being reopened here.

## Migration & Deployment

No schema migration. `LedgerAccountType`/`LedgerAccount`/
`LedgerAccountGroup` already exist (#5663); this document adds one
command and its hardcoded template data as application code, not a
database change. Deployable independently of every other document in
this family — no other module needs to change for this command to
ship, and no other module breaks if this command is deployed before or
after them.

## Implementation Plan

1. Add the hardcoded Phase 1 template data (see Data Models) as a
   TypeScript module in `ledger`, following the same pattern as
   `lib/seeds.ts`'s existing `seedPolishAccountGroups` array.
2. Implement `importDefaultChartOfAccounts` as a new Command: the
   empty-chart-of-accounts precondition check, validation of the
   template data through the existing `data/validators.ts` schemas,
   the ordered insert (account types before accounts) inside one
   `withAtomicFlush` transaction, and the `buildLog`/`undo` payload
   recording every created id.
3. Register the new command in `ledger`'s module manifest, gated by
   the existing `ledger.accounts.manage` feature.
4. Add the "Zaimportuj domyślny plan kont" button to
   `backend/ledger/accounts/page.tsx`, wired to call the new command
   and refresh the page's existing `DataTable` on success, surfacing
   the command's own refusal message on the precondition failure.
5. Confirm the API Contracts open validation point (whether a new thin
   route is needed to trigger the command from the button, or an
   existing generic mechanism already covers it) and implement
   whichever applies.

## File Manifest

- `lib/defaultChartOfAccounts.ts` (new) — the hardcoded Phase 1
  template data (39 `LedgerAccountType` rows, 43 `LedgerAccount` rows
  across zespoły 0–8), following `lib/seeds.ts`'s existing
  `seedPolishAccountGroups` pattern.
- `commands/importDefaultChartOfAccounts.ts` (new) — the command
  itself: precondition check, validation, transactional insert,
  `buildLog`/`undo`.
- `backend/ledger/accounts/page.tsx` (modified) — one new button
  calling the new command.
- `api/accounts/import-default-chart-of-accounts/route.ts` (new) — a
  thin custom write route resolving the API Contracts section's own
  "Open validation point for implementation": `backend/ledger/
  accounts/page.tsx` has no client-side `commandBus` access (like
  every other backend page in this module, it calls REST routes under
  `/api/ledger/...`) and no existing generic "run this command"
  endpoint covers a non-CRUD, button-triggered action — resolved by
  following the same pattern `api/fiscal-periods/[id]/lock/route.ts`
  already established for exactly this situation. Gated by
  `ledger.accounts.manage`.
- No module-manifest edit needed — `ledger`'s command auto-discovery
  (the `module-registry.ts` generator, which scans each module's
  `commands/` directory) registers
  `commands/importDefaultChartOfAccounts.ts` automatically once the
  file exists in the right location; nothing lists this module's
  commands by hand for that generator to update. The original "Module
  manifest (modified)" bullet here was inaccurate — see Changelog.

## Testing Strategy

- **Refuses to run against a non-empty chart of accounts**: seed one
  `LedgerAccountType` or `LedgerAccount` row (including a soft-deleted
  scenario as the negative case — see below), call the command, assert
  it fails validation and writes nothing.
- **Soft-deleted rows don't block the import**: seed only
  soft-deleted (`deletedAt` set) `LedgerAccountType`/`LedgerAccount`
  rows, call the command, assert it succeeds and imports the full
  template alongside them.
- **Happy path creates the full template**: call the command against
  an empty chart of accounts, assert exactly 39 `LedgerAccountType`
  rows and 43 `LedgerAccount` rows are created, each correctly linked
  to its `accountGroupId`/`accountTypeId`/`parentAccountTypeId`/
  `parentAccountId`.
- **Undo restores empty state**: call the command, then its `undo`,
  assert the chart of accounts returns to zero non-deleted
  `LedgerAccountType`/`LedgerAccount` rows.
- **Imported rows are ordinary rows afterward**: after import, call
  `updateLedgerAccountType`/`updateLedgerAccount` against an imported
  row and assert it behaves identically to a manually created row (no
  special-cased "imported" flag blocking edits).
- **Permission enforcement**: call the command as a principal without
  `ledger.accounts.manage`, assert it's rejected the same way
  `createLedgerAccountType` already rejects that principal.
- **Tenant/organization scoping**: importing in one organization
  doesn't affect another organization's (already-populated or empty)
  chart of accounts.

## Risks & Impact Review

- **Template drift from real-world Polish practice.** The hardcoded
  template is a Phase 1 snapshot of common practice, not a legally
  mandated structure (Hay's own "wide latitude" point applies both to
  the tenant and to this document) — a tenant with different needs
  edits after import, exactly as intended. Risk is low: nothing in this
  codebase reads these specific codes, so an imperfect template never
  produces incorrect behavior, only a less convenient starting point.
- **A tenant runs the import expecting it to merge into an existing,
  customized chart of accounts.** Mitigated by the precondition
  failure message explaining exactly why the import was refused (see
  Backend Pages) rather than a generic error, and by this document's
  own explicit choice not to support merging (see Alternatives
  Considered) — a tenant who wants some of the template still has the
  option of deleting their existing rows first, or building the
  specific accounts they want manually.
- **Concurrent import attempts.** Two simultaneous calls to the command
  against the same empty chart of accounts could both pass the
  precondition check before either writes. The single `withAtomicFlush`
  transaction per call and the underlying database's own constraints
  bound the damage to, at worst, a duplicate set of rows rather than
  data corruption — acceptable for an admin-triggered, low-frequency
  action; not worth a dedicated locking mechanism in Phase 1.
- **No impact on existing modules.** JELD and Posting Rules Engine
  already consume `LedgerAccount`/`LedgerAccountGroup` rows regardless
  of whether they were created by hand or imported — this document
  changes nothing about how either module reads those rows.

## Out of Scope

- **Phase 2: wiring the import into the organization-creation/
  onboarding wizard**, so a new organization can choose to start with
  this template at setup time instead of (or in addition to) through
  the manual button this document adds — matching how ERPNext,
  enova365, and Symfonia all surface a chart-of-accounts choice during
  setup (see Literature & Prior Art). Deliberately deferred, not
  dropped: this alternative is kept visible here and in Design
  Decisions specifically so whoever picks up onboarding-wizard work
  next sees it as a planned extension of this document rather than a
  closed question. Phase 2 would also be the natural point to revisit
  whether the precondition should instead run automatically as part of
  organization creation (when the chart of accounts is guaranteed
  empty by construction) rather than as a user-facing refusal.
- **Multiple selectable templates / parametrized templates by business
  type** (the way enova365 and Symfonia both offer). This document
  ships exactly one hardcoded Polish template; a tenant who wants a
  different starting point edits after import today. A `templateId`
  input and a small library of templates is a natural Phase 2
  extension once real usage shows which variations tenants actually
  want.
- **Multi-country / pluggable chart-of-accounts templates**
  (`IChartOfAccountsTemplate`-style, per SPEC-024's aspirational,
  since-diverged-from plugin contract). Explicitly scoped out by the
  user's own decision for this document (see the Open Questions this
  document's drafting process resolved): Phase 1 is PL-only and
  hardcoded, not a pluggable framework for other jurisdictions.
- **Merging a template into an existing, customized chart of
  accounts.** See Alternatives Considered — defining correct merge
  semantics is a real, harder problem this document doesn't attempt to
  solve.

## Final Compliance Report

**Compliance Matrix** (against root/`packages/core` `AGENTS.md` and
`om-spec-writing`'s Quick Rule Reference):

| Rule | Status |
| --- | --- |
| No new entity without a documented reason | Compliant — explicitly zero new entities (see Architecture, "Entities") |
| Commands go through `commandBus`, own their transaction/undo | Compliant — see Architecture, "Commands" |
| Permission checks reuse existing features where the action is equivalent in kind | Compliant — reuses `ledger.accounts.manage`, no new permission string |
| Phase 1/Phase 2 scope discipline (data model + manual trigger first, automation later) | Compliant — matches this family's established convention (see Design Decisions, "Opt-in only") |
| Open Questions gate | Compliant — both open questions (scope: PL-only vs. pluggable; seeding model: opt-in button vs. onboarding-wizard-first) were put to the user with researched options and resolved explicitly before drafting began |
| Literature grounding present, primary-source verified | Compliant — see Literature & Prior Art; three sources checked (Kieso, Hay, Fowler), one absence explicitly recorded |
| Real-system comparison present | Compliant — ERPNext, enova365, Symfonia checked; Comarch recorded as inconclusive rather than forced |

**Internal Consistency Check:** Cross-checked against GL core engine
(#5663) — this document's Entities section correctly treats
`LedgerAccountGroup` as read-only and already-seeded, and its Design
Decisions correctly builds on, rather than reopens, #5663's own
no-auto-seed decision. Cross-checked against JELD and Posting Rules
Engine — both are named in this document's own Related header as
consumers of the rows this document helps populate, and neither
document's own text needed a change beyond the annotation each already
received (see Changelog, 2026-09-15 cont.). Cross-checked against
Fixed Assets (#6014) — **found and fixed one real defect**: the
initial Data Models draft combined tangible/intangible accumulated
depreciation into one `070` account and had no `072` impairment
account at all, contradicting Fixed Assets' own 2026-09-09 correction
(a dedicated `ledgerAccumulatedImpairmentAccountId`, sourced from a
real accounting-team-supplied reference chart of accounts). Corrected
by splitting `070`/`071` and adding `072` — see Data Models and
Changelog. Cross-checked against the knowledge base's §2 conventions —
no new tagging mechanism, no new control-account pattern, no new
event; nothing to add to §2.

**Verdict:** Fully compliant. First-draft complete; ready for review.

## Changelog

### 2026-09-15 (initial draft)

- New document, `financial-spec-writing-process` applied from the
  start (unlike every prior document in this family, which received
  Literature & Prior Art / real-system comparison as a later
  enrichment pass — this is the first document in this family to carry
  both from its very first draft).
- Step 1 (cross-spec consistency): confirmed no existing spec, branch,
  or PR already covers this; found GL core engine's own explicit,
  load-bearing "no default chart of accounts is seeded; tenants build
  their own" Phase 1 decision, and SPEC-024's aspirational, since-
  diverged-from `IChartOfAccountsTemplate` plugin contract — surfaced
  both to the user as genuine, consequential Open Questions rather than
  guessed: (1) scope — PL-only hardcoded template vs. a pluggable
  multi-country framework, resolved as PL-only hardcoded; (2) seeding
  model — resolved as Phase 1 opt-in command + button on the existing
  backend page (no change to GL core engine's `onTenantCreated`
  behavior), with the onboarding-wizard-integration alternative
  explicitly tracked in Phase 2/Out of Scope rather than dropped, per
  the user's own explicit instruction to keep it visible.
- Step 2 (literature grounding): confirmed Kieso Illustration 3.9 (ch.
  3, pp. 3-12–3-13, deliberate numbering gaps); confirmed Hay ch. 7,
  p. 119 ("wide latitude" in setting up account types); confirmed
  Fowler has zero "chart of accounts" mentions anywhere.
- Step 3 (real-system comparison): ERPNext recorded as a genuine,
  honestly-documented divergence (auto-seed-then-replace, the opposite
  of this document's design); enova365 and Symfonia both confirmed as
  close matches to this document's opt-in/template/customizable-after
  design; Comarch recorded as inconclusive.
- Step 4 (`om-spec-writing` structure): full document drafted following
  the standard section order, Open Questions gate satisfied via
  explicit user confirmation on both questions raised in Step 1.
- Step 5: this document's own entry added to
  `2026-09-08-financial-module-knowledge-base.md` (module map row, new
  Tier 2/Tier 3 citation entries for Kieso Illustration 3.9 and Hay p.
  119, new Tier 4 real-system entry, dated Changelog entry) — see that
  document's own Changelog for the mirrored entry.

### 2026-09-24 (cont. — arithmetic error in the totals corrected before OM-16 implementation)

- While starting implementation (OM-16, `lib/defaultChartOfAccounts.ts`),
  counted every row in the Data Models tables directly rather than
  trusting the document's own summary numbers (per
  `financial-spec-citation-check`'s verification standard) and found a
  real, one-off arithmetic error: File Manifest, Testing Strategy, and
  the previous Changelog entry all stated 38 `LedgerAccountType` / 42
  `LedgerAccount` rows, but the Data Models section's own "Totals:" line
  already correctly said 39/43 — and a direct recount of every zespół's
  own table (zespoły 0 through 8) confirms 39/43 is the number that
  actually matches the template as specified, not 38/42.
- The error predates the 070/071/072 split fix, not just this document's
  arithmetic after it: the previous Changelog entry claimed that fix
  moved the totals "from 36/40 to 38/42," but recomputing the pre-split
  template (070 combined, no 072) gives 37/41, not 36/40 — the same
  off-by-one existed before that fix and was carried through it
  unnoticed.
- Fixed File Manifest, Testing Strategy, and the previous Changelog
  entry's numbers (now 37/41 to 39/43) to match the Data Models table,
  which was correct all along and needed no change itself.

### 2026-09-15 (cont. — cross-spec consistency pass against every sibling spec; one real defect found and fixed)

- Per the user's own request to check whether any other spec in this
  family needed updating relative to this new document (and vice
  versa), read every sibling spec directly (GL core engine, JELD,
  Posting Rules Engine, Accounts Payable, GL account balances, AR
  sales-invoice-GL-posting, Fixed Assets) rather than relying on the
  knowledge base's summary of them, per `financial-spec-citation-check`.
- **Found and fixed a real defect in this document, not in a sibling
  spec**: the original Data Models draft modeled `070` as one combined
  "Umorzenie środków trwałych oraz wartości niematerialnych i prawnych"
  account and had no `072` account at all. Fixed Assets'
  own 2026-09-09 Changelog entry ("dedicated accumulated-impairment
  account, corrected against a reference chart of accounts") already
  established, against a real accounting-team-supplied wzorcowy plan
  kont, that Polish practice keeps `070` (Umorzenie środków trwałych),
  `071` (Umorzenie wartości niematerialnych i prawnych), and `072`
  (Odpisy aktualizujące — impairment) as three genuinely separate
  accounts — and `FixedAsset.ledgerAccumulatedImpairmentAccountId`
  already expects `072` to exist as a real, importable account. Split
  `070`/`071` and added `072`; totals updated from 37/41 to 39/43
  `LedgerAccountType`/`LedgerAccount` rows throughout (Data Models,
  Testing Strategy, File Manifest). This is exactly the kind of
  external-reference correction Fixed Assets' own Changelog entry
  flagged as uncatchable by reading either spec alone — only surfaced
  by actually cross-checking the two documents' account-numbering
  claims against each other.
- **Posting Rules Engine** (#6015) — its own Out of Scope already names
  "a general chart-of-accounts import mechanism... a distinct,
  `ledger`-owned feature this module depends on existing... but does
  not itself build," added 2026-09-14. Added an **Update (2026-09-15)**
  annotation there pointing to this document, while explicitly
  recording that this document is *narrower*, not a full match: that
  bullet describes bulk-loading a *tenant's own arbitrary* numbering
  (e.g. from an Excel "plan kont"), while this document ships exactly
  one fixed, hardcoded template — the general "import your own
  existing chart" capability that bullet describes remains unbuilt and
  still out of scope everywhere in this project.
- **GL core engine** (#5663) — its Module Setup section states "no
  default chart of accounts... is seeded; tenants build their own" as
  a plain architecture fact, not a flagged deferred item, so no
  correction was needed there; added a one-line forward-pointer to
  this document for discoverability, matching that document's existing
  convention of annotating related follow-up specs in place.
- **JELD, Accounts Payable, GL account balances, AR sales-invoice-GL-
  posting** — read in full; none make an account-numbering or
  seeding claim this document's template contradicts or duplicates
  (AP/AR both confirm the existing "accountant configures via Module
  Config, no auto-picked account" pattern this document is fully
  compatible with — it only makes more accounts available to pick
  from). No changes needed to any of the four.

### 2026-09-24 (cont. — File Manifest gap found and fixed during OM-18 implementation)

- While implementing OM-18 (the backend-page button), resolved this
  document's own "Open validation point for implementation" (API
  Contracts) by adding one new thin route,
  `api/accounts/import-default-chart-of-accounts/route.ts`, following
  the same pattern `api/fiscal-periods/[id]/lock/route.ts` already
  established in this codebase for a non-CRUD, button-triggered
  command. The File Manifest never anticipated this file at all — it
  only listed `backend/ledger/accounts/page.tsx` (modified) and
  "Module manifest (modified)" — even though the API Contracts section
  itself already flagged that a new route might be needed. Added the
  route file to the File Manifest.
- Also checked the File Manifest's "Module manifest (modified)" bullet
  directly against the real codebase (per
  `financial-spec-citation-check`) rather than accepting it at face
  value: `ledger`'s commands are registered by the `module-registry.ts`
  generator scanning each module's `commands/` directory automatically
  (confirmed by the absence of any file that imports
  `commands/ledgerAccountTypes` or similar commands by hand, besides
  test/validator files) — no module manifest file exists to hand-edit
  for this. The bullet was inaccurate from the first draft; corrected
  to say so explicitly instead of removing it silently.
