# Destructive Button Loudness Policy (`destructive` quiet, `destructive-solid` for the point of no return)

> Status: **IMPLEMENTED — pending merge; originated in PR [#4652](https://github.com/open-mercato/open-mercato/pull/4652)**
> Refs: issue [open-mercato/open-mercato#4651](https://github.com/open-mercato/open-mercato/issues/4651)
> Related: [`.ai/ds-rules.md`](../ds-rules.md) · [`.ai/ui-components.md`](../ui-components.md) · [`.ai/skills/om-ds-guardian/references/component-guide.md`](../skills/om-ds-guardian/references/component-guide.md)

## TLDR

`Button variant="destructive"` changes from a **filled red** button to the DS Error/Stroke style: red
text and a full `--destructive` border on the page surface. The filled form survives as a new,
additive variant `destructive-solid`, and is reserved for the single point-of-no-return confirmation
inside a dialog.

This is a **visual behavior change to a public UI primitive**: every existing `variant="destructive"`
call site — inside this repo and in third-party modules — renders differently after upgrading, with no
code change on their side. No exported symbol, prop, or type is removed or narrowed, so the change is
source- and type-compatible; it is the rendered pixels that move.

Alongside the variant split, the status-token contract is tightened: `text-destructive` is an **action**
token (delete/remove/discard controls and their icons) and MUST NOT be used for validation, failure, or
other status copy, which takes `text-status-error-text`.

## Overview

Scope is one cva variant map plus the call sites that need the new loud variant, and the documentation
that tells authors which is which:

- `packages/ui/src/primitives/button.tsx` — `destructive` becomes quiet; `destructive-solid` is added;
  `dark:` overrides are removed from the destructive family.
- `packages/ui/src/backend/confirm-dialog/ConfirmDialog.tsx` — maps `variant="destructive"` to
  `destructive-solid` for the confirm button.
- Nine production point-of-no-return confirmations across `core`, `search`, and `ui` opt into
  `destructive-solid`; the design-system dialog example demonstrates the same policy.
- 49 status/validation call sites move from `text-destructive` to `text-status-error-text`.
- `.ai/ds-rules.md`, `.ai/ui-components.md`, and the DS Guardian component guide record the policy.
- `scripts/check-token-parity.mjs` gains a `--root` flag and a CI-executed test.

Out of scope: `IconButton`'s destructive variant (still solid — icon-only controls have no text to carry
the quiet treatment), Alert/Badge status variants, and any change to the `--destructive` token value
itself.

## Problem Statement

Red is an attention budget, and the codebase was spending all of it. Over 70 call sites rendered a
solid red `Button variant="destructive"`: row actions, toolbar buttons, form-header Delete, edit-dialog
footers, and — indistinguishable from all of those — the actual confirmation button that commits an
irreversible delete.

Two consequences:

1. **Red stops meaning "stop".** When every list row carries a solid red button that merely opens a
   confirmation, users learn that red is safe to click. The one control where red must genuinely
   interrupt — the final confirm — has no way to stand out.
2. **No vocabulary for the difference.** There was no variant that said "this is the irreversible one",
   so authors reached for `className` overrides (`text-destructive border-red-200 hover:bg-red-50`) and
   hand-rolled the quiet treatment ad hoc, drifting away from the tokens.

## Proposed Solution

| Control | Variant | Rationale |
|---|---|---|
| Delete / Remove / Discard **trigger** — row action, toolbar, form header, edit-dialog footer | `destructive` (quiet) | Opening a confirmation is reversible; Escape gets you out. |
| The **confirm** button inside a confirmation dialog | `destructive-solid` (filled) | The single point of no return on the screen. |
| Inline destructive chip | `destructive-soft` | Unchanged. |
| Low-emphasis destructive menu item | `destructive-ghost` | Unchanged. |

`ConfirmDialog` with `variant="destructive"` resolves its confirm button to `destructive-solid`
internally, so the common path needs no per-call-site knowledge — a module author calling
`useConfirmDialog()` gets the correct loudness for free.

`destructive-outline` remains in the variant map as an alias of the quiet treatment for call sites that
predate the policy. New code uses `destructive`.

### Status vs action tokens

`.ai/ds-rules.md` already routes status indicators to `{property}-status-{status}-{role}`. The policy
makes the boundary explicit and enforceable:

- **Action** — `text-destructive`, `bg-destructive`: the label and icon of a control that deletes,
  removes, or discards something.
- **Status** — `text-status-error-text`: validation messages, load failures, withdrawn/overdue/error
  copy, required-field markers, and error cells in tables.

Using the action token for status copy reads as "click here to delete something" on text that is not
clickable at all.

## Architecture

Single change point: the `buttonVariants` cva map in
[`packages/ui/src/primitives/button.tsx`](../../packages/ui/src/primitives/button.tsx). Because every
consumer resolves its classes through that map, the ~70 quiet call sites are calmed with no per-file
edit; only the point-of-no-return confirmations needed an explicit opt-in to `destructive-solid`.

`dark:` overrides were dropped from the whole destructive family. `--destructive` already resolves per
theme, so a `dark:hover:bg-destructive/15` next to a light `hover:bg-destructive/10` was a hardcoded
theme divergence on a token that adapts on its own. The `aria-invalid:ring-destructive` /
`dark:aria-invalid:ring-destructive` pair is retained on `destructive` and `destructive-solid`: it is
not a colour override but an opacity normalisation against the base cva's `ring-destructive/20` and
`dark:ring-destructive/40`, so the invalid ring reaches full strength in both themes.

### Enforcement

| Guard | What it protects |
|---|---|
| `packages/ui/src/primitives/__tests__/button.test.tsx` | `destructive` stays quiet (border + text, no fill); `destructive-solid` stays filled with no `dark:bg-*` override. |
| `packages/ui/src/backend/confirm-dialog/__tests__/ConfirmDialog.test.tsx` | A destructive `ConfirmDialog` resolves its confirm button to the solid variant; the default variant does not. |
| `scripts/__tests__/check-token-parity.test.mjs` (runs in CI via `yarn test:scripts`) | `:root`/`.dark` token parity, create-app template sync, and WCAG contrast on every `--X`/`--X-foreground` pair in both themes. |
| `.ai/scripts/ds-health-check.sh` | Reports the `destructive-solid` usage count so a growing number is visible in review. |

## Data Models

None. No entity, migration, or persisted state is involved.

## API Contracts

No HTTP route, request schema, or response field changes.

The affected contract surface is the **UI primitive API**:

| Surface | Change | Classification |
|---|---|---|
| `Button` `variant` prop | `'destructive-solid'` added to the union | ADDITIVE |
| `Button` `variant="destructive"` | Rendered classes change (filled → quiet) | Visual behavior change, source-compatible |
| `Button` `variant="destructive-outline" \| "destructive-soft" \| "destructive-ghost"` | Retained | Unchanged |
| `ConfirmDialog` `variant` prop | Unchanged (`"default" \| "destructive"`) | Unchanged |
| `buttonVariants` export | Unchanged signature | Unchanged |

## Migration & Backward Compatibility

**Nothing breaks at build time.** No export, prop, or type is removed or narrowed; `variant="destructive"`
remains valid and additions are strictly additive. Existing code compiles and runs unchanged.

**What changes for module authors** is what their destructive buttons look like:

1. **Triggers need no change.** A `variant="destructive"` button that opens a confirmation, navigates,
   or sits in a form header is now quiet — which is the intended treatment. Leave it alone.
2. **Final confirmations need one edit.** If a button *is* the irreversible commit inside a confirmation
   dialog, change `variant="destructive"` to `variant="destructive-solid"`:

   ```diff
   - <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
   + <Button variant="destructive-solid" onClick={confirmDelete}>Delete</Button>
   ```

   Call sites built on `useConfirmDialog()` / `ConfirmDialog` require **no change** — the dialog maps the
   variant internally.
3. **Custom overrides can be deleted.** A hand-rolled quiet treatment
   (`variant="outline" className="text-destructive border-red-200 hover:bg-red-50"`) is now exactly what
   `variant="destructive"` renders. Drop the `className` and switch the variant.
4. **`destructive-outline` still works** and renders the same quiet treatment, so no forced sweep is
   needed. Prefer `destructive` in new code.
5. **Status copy moves off the action token.** If a module colours validation or failure text with
   `text-destructive`, switch it to `text-status-error-text`. Both tokens still exist, so this is a
   correctness/consistency fix rather than a compile-forcing change.

No deprecation bridge is required: no symbol was removed, so there is nothing to alias or dual-emit. The
one-way door is purely visual, and the recovery for an unwanted quiet button is a single-word variant
change.

## Risks & Impact Review

| # | Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|---|
| 1 | A third-party module's final confirmation stays on `destructive` and renders quiet, so an irreversible action loses its visual weight. | Medium | Any module with hand-rolled confirm dialogs | This spec's migration section; the policy is documented in `ds-rules.md`, `ui-components.md`, and the DS Guardian component guide, which module authors' agents read. | Cannot be enforced across repos — a module that never reads the guidance keeps a quiet confirm. The action still requires an explicit click in a dialog with a title stating the consequence. |
| 2 | An in-repo confirmation is missed during the audit and stays quiet. | Medium | Core/UI confirm dialogs | Full-repo audit of every `variant="destructive"` occurrence classified by dialog context; nine production point-of-no-return sites migrated and the design-system dialog example updated; `ds-health-check.sh` reports the solid usage count for ongoing review. | A future new confirm dialog can be written on the quiet variant; only review catches it. |
| 3 | `destructive-solid` spreads back onto triggers, restoring the wall of red. | Low | Any module | The variant name states its scope; MUST NOT rules in `ui-components.md`; usage count reported by the DS health check. | Requires reviewer attention; not machine-enforced. |
| 4 | The quiet treatment fails contrast in dark mode on an unusual surface. | Low | Theming | `scripts/check-token-parity.mjs` verifies WCAG ratios for every token pair in both themes and runs in CI. | The checker covers token pairs, not arbitrary custom surfaces a module paints underneath the button. |
| 5 | A module relies on `text-destructive` for status copy and the split makes its UI inconsistent with core. | Low | Any module | Both tokens remain valid; migration is advisory and mechanical. | Cosmetic inconsistency only. |

## Final Compliance Report

| Check | Result |
|---|---|
| `BACKWARD_COMPATIBILITY.md` contract surfaces | No exported symbol, signature, type field, route, event, DI key, ACL feature, CLI command, DB column, or config key removed or narrowed. `Button` variant union is additive. |
| Spec required for a public primitive behavior change | This document, with the Migration & Backward Compatibility section above. |
| Semantic tokens only, no hardcoded palette on touched lines | Verified: no `(text\|bg\|border)-(red\|green\|emerald\|amber\|yellow\|orange\|purple)-[0-9]+` remains in the changed source files. |
| No `dark:` overrides on semantic/status tokens | Dropped across the destructive family; the retained `aria-invalid` pair is an opacity normalisation, documented above. |
| Regression coverage for the new contracts | Button variant tests, ConfirmDialog variant-mapping tests, token parity/contrast test wired into `yarn test:scripts` (CI-executed). |
| Existing hardcoded-colour guards preserved | The `text-red-600` assertions in the product-SEO and dictionary tests were restored after an over-broad sweep replaced them. |
| i18n | No user-facing strings added or changed. |

## Changelog

- **2026-08-01** — Spec written to document the primitive behavior change requested in code review on PR #4652. Records the loudness policy, the status-vs-action token boundary, the enforcement guards, and the migration path for external module authors. Implementation prepared in the same change: quiet `destructive` + additive `destructive-solid`, nine production point-of-no-return confirmations migrated, the design-system dialog example updated, 49 status-copy call sites moved from `text-destructive` to `text-status-error-text`, `dark:` overrides dropped from the destructive family, and `check-token-parity.mjs` promoted from an advisory script to a CI-executed gate.
