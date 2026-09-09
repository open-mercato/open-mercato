# Pinned Form Action Bar — one action surface per page, with `Cmd/Ctrl+S`

- **Status:** Draft
- **Scope:** OSS (`@open-mercato/ui` internals + call-site migrations; no runtime contract changes, no DB/API changes)
- **Refs:** issue [open-mercato/open-mercato#2647](https://github.com/open-mercato/open-mercato/issues/2647)
- **Extends:** [`SPEC-016 Form Headers & Footers`](./implemented/SPEC-016-2026-02-03-form-headers-footers.md)
- **Risk:** `risk-medium` (touches every `CrudForm` page) · **Priority:** `priority-medium`
- **Category:** `refactor`

## TLDR

Save sits in a different place on every form: Resources shows it only at the bottom, Customers
only at the top without an icon, Products in both places at once. On a long form the bottom Save
scrolls out of view, because the sticky footer is applied **only inside dialogs**
(`packages/ui/src/backend/CrudForm.tsx:1267`). There is no global save shortcut.

This spec gives every `CrudForm` page **exactly one** action surface: a bar pinned directly under
the app topbar, carrying the record's title and everything you can do to that record — context
actions and `Delete / Cancel / Save` alike. The bottom copy goes away on pages. Dialogs keep their
sticky footer, unchanged. `Cmd/Ctrl+S` saves the focused form everywhere.

The change is centralised in `CrudForm` / `FormHeader`, so the ~135 conformant forms inherit it
without a per-page edit.

## Overview

Three independently reviewable pieces:

1. **Pinned bar** — `FormHeader` gains a pinned mode; `CrudForm` applies it on non-embedded page
   hosts and stops rendering the footer's standard buttons there.
2. **Global `Cmd/Ctrl+S`** — a document-level handler that resolves the form containing
   `document.activeElement` and submits it, without hijacking the browser when no form is in play.
3. **Migration** — the surfaces that bypass the standard today (the issue's three examples, plus
   the dialog and inline editors that hand-roll their own footer).

## Problem Statement

The issue reports three symptoms, all confirmed in the current code:

1. **Save is in a different place per form.** Resources embeds its `CrudForm` under a custom
   detail header; the embedded form's top Save is suppressed (`!embedded` guard,
   `CrudForm.tsx:3532`), leaving only a non-sticky bottom Save. Customers passes
   `hideFooterActions` (`CrudForm.tsx:3587`), leaving only a top Save. Products, the baseline the
   issue calls out as acceptable, renders both.
2. **The bottom Save scrolls away.** `dialogFooterClass` (`CrudForm.tsx:1267`) applies the sticky
   classes only when `isInDialog` is true, so on a full page the footer sits in normal flow.
3. **No `Cmd/Ctrl+S`.** A repo-wide search finds only the local `Cmd/Ctrl+Enter` binding for
   fieldset dialogs and inline editors.

There is a fourth problem the issue does not name, and it decides the shape of the fix: **"both
places" is not a solution, it is the symptom.** Products is tolerable only because its two Saves
are identical. As soon as a form carries *contextual* actions as well — Convert, Send, Print,
Export, a preview toggle — putting standard actions on one edge of the screen and context actions
on the other splits the answer to "what can I do here?" across two places. Removing one copy is
not enough; the two kinds of action have to end up in the same bar.

## Goals / Non-Goals

**Goals**

- One standard-action surface per `CrudForm` page, always visible while editing.
- The same position, the same `Save` icon, on every form.
- `Cmd/Ctrl+S` works wherever a `CrudForm` is mounted.
- Centralised: conformant forms change behaviour without changing code.

**Non-Goals**

- Dialog forms. A dialog has no app topbar to pin under and its footer is the established
  convention (and the `Cmd/Ctrl+Enter` surface). Dialogs are explicitly out of scope and unchanged.
- Single-action forms: auth/login/reset, portal signup/login, OTP/passkey/TOTP, the onboarding
  wizard, the AI chat composer, and the logout `<form>`s styled as menu items. These are not
  multi-field records and gain nothing.
- Read-only detail/view pages that render `FormHeader` without an editable `CrudForm`.
- Any change to validation, optimistic locking, or the submit path itself.

## Proposed Solution

### 1. The pinned bar

`FormHeader` gains a pinned mode, applied by `CrudForm` on non-embedded page hosts:

```
sticky top-[var(--topbar-height,0px)] z-sticky bg-background border-b border-border
```

Both values are existing contracts, not new inventions:

- `AppShell` already publishes its own height as `--topbar-height: 61px` on the shell container
  (`packages/ui/src/backend/AppShell.tsx:1238`), and `Sheet` already consumes it
  (`top-[var(--topbar-height,0px)]`, `packages/ui/src/primitives/sheet.tsx:23`). Pinning therefore
  needs **no magic number** and stays correct if the topbar ever changes height.
- `z-sticky` is the token the AppShell topbar itself uses (`AppShell.tsx:1314`), so the stacking
  order is defined by the same scale rather than a hand-picked `z-20`.

Because it is `position: sticky`, there is no JS: the bar is part of the page header and simply
stops scrolling away.

### 2. One surface, not two

- **On pages**, `FormFooter` no longer renders the standard buttons. The pinned bar is the only
  place `Delete / Cancel / Save` appear. This is what removes the duplication — rather than moving
  it to the other edge.
- **Context actions join the bar.** The detail-mode `ActionsDropdown` (Convert / Send / Print /
  Export) renders in the same row, separated from the committing actions by a `Separator`, so
  "inspect this record" reads as a different group from "write this record" without occupying a
  different edge of the screen.

Resulting layout, one row:

```
[← Back]  Title  [Status]  …  [Actions ▼] │ [extraActions] [Delete] [Cancel] [Save]
```

- **In dialogs**, nothing changes: `isInDialog` keeps today's sticky footer.
- **Embedded** forms render no standard buttons of their own; the host detail page's
  `FormHeader mode="detail"` is the bar, wired to the embedded form through a shared `formId`
  (`<button type="submit" form={formId}>`). One bar per page, embedded or not.

### 3. Global `Cmd/Ctrl+S`

A document-level `keydown` handler, mounted by `CrudForm`:

1. Resolve the target: the `CrudForm` root containing `document.activeElement`; else the sole
   registered `CrudForm` on the page.
2. If none resolves — **bail without `preventDefault`**, so the browser's own "save page" keeps
   working on pages that have no form.
3. Otherwise `preventDefault()` + `requestSubmit()`, reusing the existing submit path (validation,
   optimistic locking, injection `onBeforeSave`).

Registration is a small client-only module-level map keyed by `formId`, so several forms on one
page are disambiguated by focus. Coexists with `Cmd/Ctrl+Enter`, unchanged.

### Reference implementation

`official-modules` `financial-pl` ships this pattern on the invoice create/edit form: a pinned row
carrying `Show preview │ Send to KSeF · Save draft · Cancel · Create invoice`, with the bottom copy
removed. It is the evidence behind the "one surface" requirement — that form has both contextual
and standard actions, and splitting them across two edges was visibly worse than grouping them.

That implementation is a **workaround to delete once this ships**: it pins with a scoped `<style>`
block using a hardcoded `top: 61px`, a raw `z-20`, and a selector reaching into `CrudForm`'s
internal markup. All three become unnecessary here.

## Architecture

No new modules, entities, events, API routes, or DB changes.

```
packages/ui/src/backend/
  CrudForm.tsx                ← pinned-vs-footer resolution, `stickyHeader` prop,
                                Cmd/Ctrl+S handler + form registry
  forms/FormHeader.tsx        ← pinned mode + context-actions slot
  forms/FormFooter.tsx        ← unchanged for dialogs; standard buttons suppressed on pages
  forms/FormActionButtons.tsx ← unchanged (Save icon already defaulted)
  AppShell.tsx                ← unchanged (already publishes `--topbar-height`)
```

The bar resolves from `{ isInDialog, embedded, stickyHeader }`: dialog → today's sticky footer;
page → pinned header; embedded → host-controlled.

## Migration & Backward Compatibility

`CrudForm` is a STABLE contract surface. The API change is **additive**:

```typescript
/** Pin the standard action bar under the app topbar on full pages.
 *  Defaults to true. Set false to keep the header in normal flow. */
stickyHeader?: boolean
```

No prop is removed or renamed. The behavioural change is **not** visual-only and is the real
compatibility note: on pages the footer stops rendering the standard buttons, so a host that
relied on the bottom Save finds its affordance at the top. `hideFooterActions` becomes redundant
on pages and is kept as a no-op for source compatibility.

**Migration worklist**

| Group | Surfaces | Work |
|---|---|---|
| Conformant (~135) | standard `CrudForm` create/edit pages across auth, catalog, customers v2, directory, entities, integrations, planner, resources, sales, staff, webhooks, workflows, example app | none — inherit Phase 1 |
| Embedded under a custom detail header | `core/resources/.../resources/[id]`, `core/entities/.../user/[entityId]`, `core/feature_toggles/FeatureToggleOverrideCard`, `core/dictionaries/DictionaryForm` | wire host header Save via shared `formId` |
| `hideFooterActions` / custom top button | `core/auth/.../profile`, `.../change-password`, `enterprise/security/{EnforcementPolicyForm,PasswordChangeForm}`, `core/customer_accounts/.../users/[id]` | verify the pinned bar carries Save; drop the custom button |
| Raw `DialogFooter` instead of `FormFooter` | `core/attachments/AttachmentPartitionSettings`, `core/catalog/PriceKindSettings`, `core/dictionaries/{DictionariesManager,DictionaryEntriesEditor}` | converge on `FormFooter` + shared keyboard contract |
| Custom inline editors | `core/customers/components/detail/*`, `core/sales/DocumentNumberSettings`, `ui/src/backend/detail/{InlineEditors,NotesSection,AddressEditor}` | standardise Save affordance + keyboard; lower priority |

## Implementation Plan

Each phase is its own PR.

- **Phase 1 — Pinned bar.** `stickyHeader` prop, pinned `FormHeader` mode, suppression of the page
  footer's standard buttons. Verify both `AppShell` layout branches: the page-scroll `<main>`
  (`AppShell.tsx:1415`) and the `overflow-y-auto` panel (`:1520`), where the bar pins to the
  panel's own top — the desired result. Confirm dialogs are untouched.
- **Phase 2 — Context actions into the bar.** `ActionsDropdown` inside the pinned bar with a
  `Separator` before the committing actions; responsive collapse on narrow viewports.
- **Phase 3 — Global `Cmd/Ctrl+S`.** Registry + handler + guarded `preventDefault`.
- **Phase 4 — Issue examples.** Resources, Customers, Products.
- **Phase 5 — Dialog/inline migration.** One PR per cluster if a cluster exceeds ~200 lines.
- **Phase 6 — Docs + workaround removal.** SPEC-016 changelog note, root `AGENTS.md` "UI
  Interaction", `packages/ui/AGENTS.md` CrudForm guidelines; delete the `financial-pl` `<style>`
  workaround in `official-modules`.

## Risks & Impact Review

| # | Risk | Severity | Area | Mitigation | Residual |
|---|------|----------|------|------------|----------|
| R1 | Blast radius: ~135 forms change action placement at once | High | Whole backend | Default-ON with `stickyHeader={false}` opt-out; screenshot QA per layout variant before Phase 4 | Medium |
| R2 | Removing the bottom Save breaks the habit of scrolling to the end to submit | Medium | Whole backend | The bar never scrolls away, so the action is closer than before, not further; `Cmd/Ctrl+S` covers keyboard users | Low |
| R3 | The bar costs vertical space on every page, worst on short viewports | Medium | Mobile | One row on `sm+`; wraps to at most two rows narrow, with the context dropdown collapsing to an icon; measure on the 5 layout variants | Medium |
| R4 | `z-index` collides with Drawer, `ProgressTopBar`, or the `DataTable` sticky header, which now sits below a second sticky band | Medium | UI overlays | Use the `z-sticky` token the topbar already uses; explicit stacking audit in Phase 1 | Medium |
| R5 | Sticky resolves against the wrong scroll container in the panel branch | Medium | Layout | Verify both branches in Phase 1; pinning to the panel top is intended | Low |
| R6 | `Cmd/Ctrl+S` hijacks the browser save on pages with no form | Medium | Global shortcut | Handler mounted only by `CrudForm`; `preventDefault` only after a target resolves | Low |
| R7 | Several `CrudForm`s on one page — the shortcut saves the wrong one | Medium | Detail pages | Resolve by `document.activeElement` containment; bail when ambiguous | Low |
| R8 | `--topbar-height` is a static `61px` literal today; a dynamic topbar would make it stale | Low | Layout | The variable is the single source either way; making it dynamic is a one-line `AppShell` change every consumer inherits | Low |

## Validation Plan

1. `yarn workspace @open-mercato/ui test` — new pinned-header test + existing `CrudForm.render.test.tsx`.
2. New `CrudForm.keyboardSave.test.tsx`: single form; several forms with focus in one; nothing
   focused → no hijack; input focused inside a form → that form saves.
3. `yarn typecheck`, `yarn lint`, `yarn lint:ds` — no new findings.
4. Visual QA on the five layout variants (single-card, grouped, two-column, embedded, dialog) at
   desktop and mobile widths, plus an explicit stacking check against Drawer, `ProgressTopBar` and
   a `DataTable` with a sticky header.
5. Acceptance: Resources, Customers and Products each show `Delete / Cancel / Save` in the pinned
   bar and nowhere else; the Save icon is present on all three; `Cmd/Ctrl+S` saves each of them.

## Open Questions

1. **Mobile vertical cost (R3).** Is one pinned row acceptable on the smallest supported viewport,
   or should the bar collapse further there — for example title-only, with the actions behind an
   overflow menu? Needs a measurement before Phase 4.
2. **`extraActions` ordering.** The reference implementation orders the bar as
   *inspect → separator → commit*. Worth confirming as the house rule, or leaving to each host.

## Changelog

### 2026-08-01

- Initial spec, addressing issue #2647.
- Supersedes an earlier uncommitted draft (`2026-06-14-standardize-save-button`, present only on a
  local checkout) that resolved the same issue by floating the **footer** and thinning the top
  header. That direction is not carried over: it removes the literal top+bottom repetition but
  replaces it with a split — standard actions on the bottom edge, context actions on the top —
  so a form carrying both still makes the operator look in two places. Neither that draft nor its
  reported "Phase 1a" implementation exists in the repository (`git log --all -S "stickyFooter"`
  returns no commit on any branch), so nothing has shipped and no migration is owed to it.
