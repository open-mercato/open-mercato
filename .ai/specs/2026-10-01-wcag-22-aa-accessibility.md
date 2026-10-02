# Open Mercato Accessibility — WCAG 2.2 AA

## TLDR

The goal is WCAG 2.2 AA accessibility across the entire delivered application: the backoffice, authentication, customer portal, checkout, and all other active interfaces. Fix shared components, then verify complete processes and product configurations. New features must include an accessibility contract, tests, and evidence in the same PR.

Status: **draft proposed for review; product implementation has not been approved**. The standard, full scope, and document split are agreed. Application changes, skill installation/routing, Storybook changes, and CI integration are separate stages requiring approval of concrete changes. This document is neither a product conformance claim nor an assessment of legal obligations.

This master specification defines the product outcome. Two independently deployable capabilities have separate specifications: [WCAG Guardian](2026-10-01-wcag-guardian-pr-review.md) and [Storybook and automated testing](2026-10-01-storybook-wcag-quality-gates.md). Deploying either capability does not establish application conformance.

## Overview — Scope and Version Baseline

Verified on 2026-10-02:

| Item | Finding | Implication |
|---|---|---|
| Upstream develop | `7f0ebf65398fbf75a3f2485cc79d31da92a108b3`, 2026-10-02 | Base this specification was verified against; remap call sites on the chosen implementation base |
| Upstream main | `fefc71d09efe2aa8c732dc6fafaa084a0e0dae3c`, 2026-09-23 | Compared for existing work |
| PR policy | `.ai/agentic.config.json` specifies `develop` as baseBranch | Select the implementation/PR base explicitly |
| Storybook | Confirmed on main and develop on 2026-10-02 | See the update below |

Before coding, agree with the maintainer on the base. Audit evidence must identify the commit, build version, and any uncommitted overlay. Hypotheses from an outdated checkout must not be presented as confirmed defects in the current release.

The product scope includes all active OSS modules, delivered enterprise and official modules, their interfaces, custom fields, injected widgets, permission variants, themes, five supported locales, and mobile layouts. Commercial implementation details belong in linked `.ai/specs/enterprise/` documents; the accessibility policy remains shared. Inventory public pages, documentation, and marketing surfaces when delivered as part of the assessed product. Exclusions require explicit boundaries rather than silent omission.

### Upstream Verification and Existing Work — 2026-10-02

Compared main `fefc71d09efe2aa8c732dc6fafaa084a0e0dae3c` and develop `7f0ebf65398fbf75a3f2485cc79d31da92a108b3`. These identifiers describe the inspected material, not a later HEAD or a release audit.

**WCAG specifications already exist for individual application areas.** No equivalent whole-application program with a ledger of 55 criteria × process × configuration × state × method × build was identified in the searched OSS/implemented/enterprise specifications, skills, UI, harness, and CI on either snapshot. This master adds scope and evidence coordination while preserving existing owners. The [readiness report](analysis/ANALYSIS-2026-10-01-wcag-22-aa-accessibility.md) also records gaps in this package.

Source links are pinned to develop unless marked main. A specification defines requirements; its presence does not prove implementation.

| Existing material | Scope and decision |
|---|---|
| [Storefront §18, main](https://github.com/open-mercato/open-mercato/blob/fefc71d09efe2aa8c732dc6fafaa084a0e0dae3c/.ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md) | WCAG 2.2 AA for the storefront. Preserve processes, fixtures, and ownership; avoid duplicate requirements. |
| [Storefront app, develop](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/.ai/specs/2026-08-14-storefront-app.md) | The newer document has Specification status. Its serious/critical axe threshold must be supplemented with assessment of all applicable A/AA requirements. |
| [CRM detail UX](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/.ai/specs/2026-04-06-crm-detail-pages-ux-enhancements.md) | Area-specific WCAG 2.1 AA; extend evaluation to 2.2 and complete processes. |
| [DS foundation](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/.ai/specs/implemented/2026-04-25-ds-foundation.md) | Reuse primitives and tests, including DS foundation v5 and the historical docs/design-system/audit.md. Historical defect counts are not a new baseline. |
| [Storybook/native catalogue](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/.ai/specs/2026-09-12-local-design-system-storybook.md) | Specification, generator, smoke runner, and addon-a11y exist on both branches. Preview uses test: todo; smoke does not run axe. Extend existing sources. |
| [check:tokens](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/scripts/check-token-parity.mjs) | App/template parity and literal light/dark contrast pairs. The real CSS test in scripts/__tests__/check-token-parity.test.mjs runs in CI through test:scripts. Preserve the gate; add rendered opacity, gradients, and states. |
| [Destructive/token policy](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/.ai/specs/2026-08-01-destructive-button-loudness-policy.md) | Existing policy owner and CI contrast gate; reuse without competing rules. |
| [DS theming](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/.ai/specs/2026-07-05-ds-theming-and-brand-customization.md) | Theme/brand palette design and shared contrast ownership. A specification does not prove implementation of the theme CLI. |
| [DS Guardian](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/.ai/skills/om-ds-guardian/SKILL.md) | Selected label/focus/color rules. Reuse DS canon, the PR checklist, and seven DS lint rules; the new guardian adds scope, evidence, and process review. |
| [Standalone harness](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/packages/create-app/agentic/shared/ai/harness/cases.json) | Existing accessibility routing and backend-ui-design quality states. Reuse OMH-092/115/137/176; add separate cases only for validator/caller gaps. |
| [Enterprise UX consistency](https://github.com/open-mercato/open-mercato/blob/7f0ebf65398fbf75a3f2485cc79d31da92a108b3/.ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-consistency-pass.md) | Area-specific keyboard/row/tab/accordion patterns, also in ux-navigation-pass and ux-caseload-operator-throughput. Include surfaces in the master manifest; retain commercial details with enterprise owners. |

The older storefront specification on main assigns 44×44 to SC 2.5.8 and “Focus Appearance” to SC 2.4.11. Agree on corrections with its owner: [SC 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum) at AA requires 24×24 CSS px subject to exceptions; 44×44 is enhanced AAA or a product requirement. [SC 2.4.11](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum) at AA concerns focus not being obscured; appearance is SC 2.4.13 at AAA. Do not copy outdated numbering or lower the existing 44×44 product requirement.

### Existing Issue Links

Issue/PR bodies, states, and history were read on 2026-10-02. This is a backlog/regression map, not a new audit. The criteria below define an **evaluation plan**; violations require confirmation on the selected build. Open does not prove a fix is absent: merging to develop may leave an issue open when main is the default branch. Closed/completed does not prove a pass. These are reference links; documentation does not close issues.

| Existing issue | State / related work | Criteria to evaluate; owner and evidence |
|---|---|---|
| [#5511 — bug: [UI] CrudForm labels are not associated with their inputs, on every form in the product](https://github.com/open-mercato/open-mercato/issues/5511) | Open; [PR #5536](https://github.com/open-mercato/open-mercato/pull/5536) open — review the existing diff | 1.3.1, 3.3.2, 4.1.2; UI CrudForm; getByLabel/click-label focus, standard/injected/custom fields and consumers |
| [#5478 — Wire ARIA on CrudForm's wrapper error node so field validation is announced](https://github.com/open-mercato/open-mercato/issues/5478) | Open; wrapper-error follow-up | 1.3.1, 3.3.1, 4.1.3; UI forms; invalid submit → error/input relationship → AT → correction |
| [#6425 — bug: Deal create form "Status" label points at a missing id, so the status select has no accessible name](https://github.com/open-mercato/open-mercato/issues/6425) | Open; [PR #6737](https://github.com/open-mercato/open-mercato/pull/6737) merged to develop on 2026-10-02; retest | 1.3.1, 3.3.2, 4.1.2; customers; status combobox name, focus, and selection |
| [#5086 — a11y(staff): timesheet duration cell errors are only reachable through the `title` attribute](https://github.com/open-mercato/open-mercato/issues/5086) | Open; duration error available only through title | 3.3.1, 3.3.3; staff; cell-specific message, AT, and keyboard/touch without hover |
| [#6379 — staff: task-list DataTable lost its accessible caption/name](https://github.com/open-mercato/open-mercato/issues/6379) | Open; regression from DataTable migration | 1.3.1, 4.1.2; staff/UI; actual table name and relationships, AT |
| [#5683 — Clean up accessible names for page-level headings](https://github.com/open-mercato/open-mercato/issues/5683) | Open; follow-up to [PR #5543](https://github.com/open-mercato/open-mercato/pull/5543) | 2.4.6; messages/sales; h1 name excludes badge/subtitle, supplemental content remains accessible |
| [#6445 — bug: ActionsDropdown menu items are reachable by keyboard only after tabbing through the page footer](https://github.com/open-mercato/open-mercato/issues/6445) | Open; [PR #6792](https://github.com/open-mercato/open-mercato/pull/6792) open; related [PR #6318](https://github.com/open-mercato/open-mercato/pull/6318) open | 2.1.1, 2.4.3; UI ActionsDropdown; Enter/Arrow/Escape, portal, and return focus |
| [#6771 — bug: Row actions menu — moving the mouse over "⋯" while typing in a list's search field takes the focus away — the next typed characters are lost](https://github.com/open-mercato/open-mercato/issues/6771) | Open; history also references [PR #6792](https://github.com/open-mercato/open-mercato/pull/6792) | 2.4.3; UI row actions; search typing + hover preserves focus and text |
| [#6853 — bug: [UI / date picker] — With the month/year grid open, Tab moves focus to the hidden day view underneath — the focused day number shows through the month grid](https://github.com/open-mercato/open-mercato/issues/6853) | Open; separate Calendar regression | 2.1.1, 2.4.3, 2.4.11; UI Calendar; month/year grid prevents focus entering the hidden day view |
| [#5751 — fix(channel-discord, channel-imap): restore focus when a connect dialog closes instead of dropping it on <body>](https://github.com/open-mercato/open-mercato/issues/5751) | Open; provider dialogs | 2.4.3; channel-discord/channel-imap; Escape/close returns focus to a live trigger |
| [#5947 — a11y(ui): InlineEditors edit/cancel buttons have no aria-label and are unreachable on touch devices (no hover:none fallback)](https://github.com/open-mercato/open-mercato/issues/5947) | Open; [PR #5966](https://github.com/open-mercato/open-mercato/pull/5966) open | 4.1.2, 2.1.1; UI InlineEditors; translated edit/cancel names, real touch/hover:none, and focus |
| [#6327 — i18n/a11y(ui,calendar): the Calendar caption and month grid hardcode English aria-labels, ignoring both the `labels` prop and the app locale](https://github.com/open-mercato/open-mercato/issues/6327) | Open; [PR #6487](https://github.com/open-mercato/open-mercato/pull/6487) merged to develop on 2026-10-02; retest | 2.4.6, 4.1.2, locale; UI Calendar; labels override and PL/EN/DE/ES/KO after month/year changes |
| [#6079 — a11y(workflows): the visual editor has no keyboard path for connecting two steps](https://github.com/open-mercato/open-mercato/issues/6079) | Open; existing workflows UX specification | 2.1.1 and separately 2.5.7; workflows; connect steps by keyboard and a single pointer without dragging |
| [#5011 — bug: MFA verification screen — "Zweryfikuj" and "Wyślij ponownie kod" buttons have very low contrast against the dark card background](https://github.com/open-mercato/open-mercato/issues/5011) | Open; reported MFA contrast defect | 1.4.3, 1.4.11; auth; computed colors/compositing in dark theme and the real OTP flow |
| [#4651 — DS: quiet destructive by default, solid status role, token parity/contrast gate](https://github.com/open-mercato/open-mercato/issues/4651) | Open; part of the token gate already exists in code/CI | 1.4.3, 1.4.11; DS/UI; reuse check:tokens, verify the full issue scope and rendered states |

Tooling links and historical cases:

| Issue | State / application |
|---|---|
| [#5094 — chore(ds-tooling): the two ds-health-check.sh copies have drifted — make one canonical](https://github.com/open-mercato/open-mercato/issues/5094) | Open; canonical DS checker — do not add another copy. |
| [#5131 — Sync om-ds-guardian's ds-health-check.sh copy with the #4919 additions](https://github.com/open-mercato/open-mercato/issues/5131) | Open; measurements in the DS Guardian copy; shared ownership with #5094. |
| [#5096 — chore(ds-tooling): om-ds-guardian hard-codes Open Mercato paths and is not liftable to another repo](https://github.com/open-mercato/open-mercato/issues/5096) | Open; Guardian portability; reuse existing configuration/harness without a fork. |
| [#4670 — Expand standalone harness generative runner coverage](https://github.com/open-mercato/open-mercato/issues/4670) | Open; standalone harness certification, separate from product conformance. |
| [#5502 — bug: [a11y] backoffice pages missing an h1, and no skip link anywhere](https://github.com/open-mercato/open-mercato/issues/5502) | Closed/completed; [PR #5543](https://github.com/open-mercato/open-mercato/pull/5543) merged. Reuse h1/skip-link tests; follow-up #5683. |
| [#1820 — bug: CrudForm forces autofocus on first field causing flicker on combobox and relation controls](https://github.com/open-mercato/open-mercato/issues/1820) | Closed/completed; historical CrudForm autofocus fixes. Preserve the regression fixture. |
| [#6223 — storybook-catalogue-scope.test.mjs fails on main: missing docs/design-system/figma-audit/*.json evidence files](https://github.com/open-mercato/open-mercato/issues/6223) | Closed/completed; historical missing catalogue evidence. Verify integrity on the selected base; closure proves neither axe/AT results nor identification of the fix PR. |

Before an implementation PR, refresh issue/PR state, compare the latest develop and existing diffs, and record the build and reproduction. First test or extend the related fix. Create a new issue only for a distinct confirmed gap after deduplication and with authorization for tracker writes. Record issue IDs in evaluation records and regression evidence. This program does not establish a competing forms, focus, or DS backlog.

### Scope Manifest and Acceptance Roles

Full scope means every delivered product surface, not only modules that happen to be active in a local build. Phase 0 produces a versioned manifest: release/commit/build, editions, all delivered modules and versions, activation variants, route templates and complete flows, roles/feature profiles, locales, supported themes/brand presets, mobile/desktop, generated/exported documents, external steps, and ownership boundaries. A module disabled in one build must still be evaluated in a configuration that delivers it to users.

We do not claim evaluation of arbitrary customer extension code, user data, or CSS overrides. The manifest distinguishes delivered/supported configurations from unrestricted modifications outside project control. Project-owned extension hosts and editing tools remain in scope; officially supported extensions/themes require evaluation cases. An external step in a complete flow receives a result and owner rather than automatic N/A. A known provider barrier prevents a pass for that process.

The product owner and accessibility/QA lead approve the manifest before baseline evaluation. Every proposed exclusion needs its own rationale, owner, and explicit product-owner approval to change scope; no exclusions have been approved. Module owners own fixes and fixtures; the accessibility/QA lead owns results and missing evidence; the maintainer owns contracts/merge; the design owner owns DS governance. Final evaluation requires acceptance by the accessibility/QA lead and product owner; automation cannot approve on their behalf. Assign named people in phase 0.

## Problem Statement

The DS standardizes appearance and selected interactions but does not document complete WCAG coverage across real processes. An accessible component can lose its label, error message, or keyboard behavior in a particular consumer. An initial-render scan does not evaluate a later-opened dialog, validation errors, data changes, or focus loss after deleting a record.

This program has no browser audit on the identified version, criterion–process–evidence matrix, or documented screen-reader evaluation yet. The first deliverable must be a reliable baseline rather than a scanner-based “100% accessible” claim.

## Proposed Solution

Use one product contract, shared fixes at real call sites, complete-process audits, and durable evidence. New and changed features define accessibility requirements during specification and design; PRs supply appropriate component, interaction, and process tests. Confirmed A/AA violations in new features and regressions require fixes. Existing violations remain visible in the remediation ledger and do not exempt the product from its conformance goal.

Automated scans, expert evaluation, and screen-reader sessions are separate evidence sources. A scanner result does not establish the other two. Full-page and complete-process requirements come from [WCAG 2.2](https://www.w3.org/TR/WCAG22/#conformance-reqs); representative sampling follows [WCAG-EM](https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/). Sampling starts the audit; it does not permit ignoring known defects outside the sample.

### Users and Outcomes

| User / need | Process that must work |
|---|---|
| Keyboard user | Login, navigation, search, edit, confirm, and cancel without a mouse |
| Blind user | Read labels, states, errors, results, and table relationships; complete the process |
| User with low vision | Zoom and spacing changes without loss of content or functionality |
| User with limited motor control | Usable touch targets and alternatives to dragging/complex gestures |
| User with cognitive accessibility needs | Predictable interactions, error correction, and assisted authentication |
| Deaf user / user sensitive to motion | Text alternatives to audio information and control of nonessential motion |

## Architecture

Fix ownership: packages/ui owns shared primitives and backend/portal components; the relevant module owns screen composition; the canonical stylesheet and create-app template own the global visual layer. Reuse this structure rather than introducing a new accessibility business module, form system, or separate component set.

Preserve `CrudForm`, `DataTable`, `FormField`, `Button`/`IconButton`, `Dialog`, `Drawer`, `Alert`, loading/error/empty primitives, and existing mutation guards, optimistic locking, RBAC, and UMES. The audit also covers injected fields/actions and replacement components. Radix or DS primitives support implementation but do not prove call-site accessibility.

### Frontend Architecture Contract

| Surface | Boundary and responsibility | Plan |
|---|---|---|
| Backend shell | Existing AppShell as a shared client island in the current layout | Focus/navigation without a new global provider |
| Forms / tables | Existing interactive CrudForm/DataTable leaves | Semantics and local focus effects |
| Portal | Existing PortalShell and module routing | Preserve auth metadata, spots, and replacement handles |
| Checkout | Existing interactive PayPage | UI fixes preserving payment behavior |
| Storybook / scanners | Development/test tooling only | Keep axe and runners out of the product runtime |

Budgets: zero unjustified new client page roots, zero new heavy libraries at the page/provider root, and zero accessibility runtime dependencies. For each touched file with top-level `use client`, record the DOM/focus/state reason, importers, cleanup risk, and alternative in the ledger. Avoid unrelated splitting of existing large files and do not increase their monolithic scope. A new island change exceeding 300 LOC requires justification or a split.

Before merge: run `check:client-boundaries` for route/shell/provider changes, hydration and interaction smoke tests for every changed route, and a before/after build/bundle comparison. Audit tooling must add zero runtime JS; any other increase needs explanation. Interaction checks must verify no extra listeners after unmount and no duplicate announcements after rerender.

## Data Models

No new business entities, migrations, or persistent tenant preferences. The audit ledger is a QA artifact rather than a database table. Each evaluation record contains criterionId, surfaceId, flowId, routePattern, module/role/theme/locale configuration, state, method, status, evidence reference, inspected commit/build, date, owner, and rationale.

Statuses: `not_evaluated`, `pass`, `fail`, `not_applicable`. `not_applicable` requires evidence that the relevant functionality is absent from that surface. Absence of video in the backoffice does not automatically imply N/A for checkout or injected widgets. Missing tests mean `not_evaluated`.

Methods: `source`, `automated`, `browser`, `measurement`, `manual`, `manual_at`. The criterion index, the evaluation ledger, and the Guardian report share this vocabulary, defined in the [report contract](../skills/om-wcag-guardian/references/review.md#methods).

The [55-criterion CSV](../qa/accessibility/wcag-22-aa-matrix.csv) is a **normative index and evaluation-method plan**, not a record of every screen's evaluation; it carries no status or evidence columns. The actual ledger has a separate row for each criterion × surface × process × configuration × state × method × build tuple; the [evaluation template](../qa/accessibility/evaluation-records.template.csv) defines its fields. The [manifest template](../qa/accessibility/scope-manifest.template.json) defines scope structure. Empty templates are not evaluation evidence. QA maintains manifest and ledger sources under `.ai/qa/accessibility/`; large anonymized evidence belongs in an approved artifact store with hashes and references. Local operational files are not automatically committed upstream.

Each record links criterionId to a Guardian check ID or a Storybook run/story/state and, when required, separate manual AT evidence. Only required manifest methods and actually executed checks can close a record. A skill report does not automatically replace a product evaluation entry.

The remediation ledger also records reproduction, affected users, severity, criteria, source/confidence, due date, fix evidence, and regression test. Acceptance of process debt does not turn `fail` into `pass`. Evidence must exclude real customer data, secrets, and tokens; use controlled fixtures and anonymized artifacts.

## API Contracts

No endpoints are added or changed. Evaluation covers UI behavior after existing API responses: success, validation error, forbidden, not-found, timeout, version conflict, and interrupted connection. Assign exact paths and payloads in the inventory before each PR; do not invent endpoints.

Create fixtures with existing API helpers. Mutations preserve `apiCall`, CRUD helpers, and `useGuardedMutation`; required `updatedAt` and the conflict bar stay active. Status announcements must not bypass guards, expose cross-tenant data, or repeat mutations.

## UI/UX — Acceptance Contracts

The implementation requirements below define the Open Mercato profile. WCAG references identify the normative basis; additional product requirements are identified separately. The [matrix](../qa/accessibility/wcag-22-aa-matrix.csv) contains all 55 A/AA criteria and their evaluation plan.

### Semantics, Navigation, and Keyboard

Every page has an appropriate title, language, heading hierarchy, and recognizable landmarks. Provide a way to bypass repeated navigation. Links navigate; buttons act. Every mouse action has a keyboard path; positive tabindex must not determine order. Accessible names include visible labels. Decorative icons must not add redundant names.

Tab/Shift+Tab moves logically between controls; Arrow/Home/End keys operate only the relevant composite widgets. Shortcuts must not intercept typing in inputs/editors. Single-character shortcuts can be disabled, remapped, or restricted to focus. [ARIA APG](https://www.w3.org/WAI/ARIA/apg/) provides implementation guidance rather than a separate WCAG certificate. Do not convert an ordinary table into a grid without a real need and a complete interaction model.

### Focus and Overlays

Focus is visible in light/dark themes and hover/selected states. Opening a modal moves focus to a meaningful element; the modal manages focus and prevents background interaction. Escape closes the appropriate layer. Closing restores focus to the trigger or an explicitly selected successor if the trigger was removed. Nonmodal popovers must not trap focus.

Sticky headers/footers, menus, and the conflict bar must not completely obscure the active control: [SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). Full focus visibility is a product goal; do not present AAA criteria 2.4.12/2.4.13 as AA requirements. Dialogs have names/descriptions and buttons usable without shortcuts. Preserve repository Cmd/Ctrl+Enter and Escape behavior; shortcuts must not bypass validation, submit twice, or interrupt IME composition.

### Forms and Authentication

Every field has a programmatic label, an unambiguous stable id, and associated descriptions/errors. Errors are identifiable through text and field state; instructions specify format and required data. Checkbox/radio groups have group names. Placeholders do not replace labels. Validation preserves values; after failed submission, focus and announcements lead to the summary/first error according to the agreed pattern, including hidden sections and custom fields.

Autofill/password managers work; password and complete-code pasting are not blocked. Evaluate every MFA/SSO/re-authentication step without removing security controls. CAPTCHA or transcription challenges require assessment of assistance mechanisms or permitted alternatives: [SC 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html). Previously supplied information needed again in the same process is selectable or prefilled unless a documented exception applies.

### Tables and Dynamic Data

Header/cell relationships, sorting state, and filter/row-selection names are programmatic. Row clicks have an equivalent keyboard action without intercepting nested controls. Pagination/filter changes communicate results without moving focus while typing. Deletion and bulk actions establish a meaningful focus destination after the result set changes.

Loading, saving, validation, upload, asynchronous operation, and conflict statuses are recognizable to screen readers without incidental focus changes. The announcement channel groups excessive SSE/streaming updates; progress must not announce every token/percentage. Critical messages remain available to read; aria-live does not replace message history or error handling.

### Measurable Visual Requirements

Text contrast is at least 4.5:1, or 3:1 for large text. Large text is at least 24 CSS px regular or approximately 18.67 CSS px bold. Do not round ratios upward. Measure actual pairs after opacity/gradient compositing in both themes, including placeholders/hints/hover. Apply appropriate exceptions for decoration, logos, and truly inactive controls; read-only content, help, and active adjacent actions are not automatically disabled: [SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Meaningful nontext elements and state indicators need at least 3:1 contrast against adjacent colors, subject to the criterion's scope/exceptions. Color is not the only carrier of meaning. Charts require text summaries and access to equivalent data/meaningful interactions: [SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Text resizing to 200% must preserve content and functionality. Evaluate reflow at 320 CSS px width, or 256 CSS px height for horizontally scrolling content, and 400% zoom from a 1280 px baseline viewport. Exceptions for necessary two-dimensional layouts such as tables/maps do not extend to the surrounding page. Do not lock orientation without necessity: [SC 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

For applicable scripts, spacing overrides of line-height 1.5×, paragraph spacing 2×, letter spacing 0.12×, and word spacing 0.16× font size must preserve content/functionality. These are not mandatory DS defaults: [SC 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html).

### Pointer Input, Gestures, and Complex Surfaces

Pointer targets are at least 24×24 CSS px or satisfy an applicable spacing, equivalent-control, inline, user-agent, or essential exception. For spacing, evaluate circles of 24 CSS px diameter; do not require unconditional visual enlargement of every small icon. 44×44 is a product recommendation for primary mobile actions, not the AA minimum: [SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Kanban, column reordering, calendars, sliders, and visual editors provide a single-pointer alternative to dragging, such as “Move to…” or position selection. Keyboard support alone does not meet this requirement. Evaluate keyboard, multipoint gestures, and pointer cancellation separately: [SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

Information shown in tooltips/popovers on hover/focus is dismissible, hoverable, and persistent under the applicable conditions. Audio/video receives required alternatives, captions, and audio descriptions according to medium. Customer-supplied content has explicit control boundaries; it does not exempt the project's editor/UI. Evaluate automatic motion and time limits. Reduced-motion and forced-colors are additional product-quality requirements with separate tests; do not imply every recommendation is an AA criterion.

## Internationalization

Accessible names, error descriptions, skip links, sorting status, and announcements are user-facing: use i18n keys and `useT`/`resolveTranslations`. Minimum regression coverage includes PL/EN, longest DE/ES strings, and KO layouts; final evaluation covers every delivered locale. Page/content language metadata must match the content. Keep personal data out of global announcements. Storybook uses real application dictionaries rather than test-only aria-labels designed to make a scanner pass.

## Integration Test Coverage

| ID | Surface / path | Interactions and states | Evidence |
|---|---|---|---|
| A11Y-AUTH | Login, reset, MFA/SSO/re-auth when active | Tab, paste/autofill, invalid credentials, timeout, redirect | E2E + NVDA/VoiceOver; no account disclosure |
| A11Y-SHELL | Backend and portal chrome | Skip link, mobile sidebar, Cmd+K, scope switch, dropdown | Focus/Escape/return, reflow, reader landmarks |
| A11Y-CRUD | Customers reference + every distinct host | Create/edit/delete, custom fields, sections, errors, 409 conflict | Field relationships, focus, announcements, data round-trip |
| A11Y-TABLE | Backend/portal lists | Filters, sort, pagination, select/bulk, empty/loading/error | Keyboard, data relationships, results without focus theft |
| A11Y-DIALOG | Modal, confirm, drawer, nested popups | Open/cancel/submit/retry, removed trigger | Focus lifecycle; one submit and preserved guards |
| A11Y-SALES | Quotes/orders/payments | Line items, financial confirmations, validation | E2E and reader; verify mutation effects |
| A11Y-PORTAL | Login, dashboard, profile, list/detail | Public/authenticated, viewer/buyer, no permission | Actual ACL, every access variant |
| A11Y-CHECKOUT | Pay page and active provider flows | Amount, terms, retry, pending/success/failure | Complete path; provider sandbox without live payments |
| A11Y-COMPLEX | Kanban, scheduler, workflow/canvas, editor | Reorder, date/time selection, text, upload | Keyboard + single pointer; equivalent data |
| A11Y-LIVE | Notifications, AI/chat, progress, conflict | Updates, errors, completion, streaming | Reader speech transcript/manual evidence; no announcement flooding |
| A11Y-THEME | Default light/dark + supported custom themes | Actual controls and portaled states | Pair measurements, zoom, spacing, high contrast |
| A11Y-EXT | Injected fields/actions/replacements | Slots, custom labels, order, errors | Host composition, UMES preserved |

This table defines test families; it does not claim they have been written or run. Each implementation PR assigns concrete routes/API paths, fixtures, case IDs, expected results, and teardown in its file manifest. Every affected API path receives an existing or new regression test; changed form UI must still save/read correct data. Integration tests ship with the fix in the module's `__integration__`; shared UI tests belong in `packages/ui`.

Create fixtures per test through API helpers and remove them in finally/teardown, without demo-data dependencies. Select role/state combinations by risk while recording unevaluated combinations. Automated coverage uses Chromium and relevant Firefox/WebKit regressions. Manual coverage uses NVDA with Firefox/Chrome on Windows, VoiceOver with Safari on macOS/iOS, and TalkBack with Chrome for critical mobile processes. Pin versions/settings in evidence. An unavailable device/reader means unevaluated scope, not pass. Participation by people with disabilities is planned as an additional check of real processes.

### Sampling, Evidence Freshness, and Aggregation

Baseline evaluation selects every distinct interaction/layout type, each critical process end to end, relevant roles/editions, and supported configuration versions. Equivalence between similar hosts must identify shared implementation, semantic DOM, keyboard/focus/async behavior, and props/content/permission differences; a shared component import alone is insufficient. A host differing in any of these receives its own evaluation. Any finding expands the audit to potentially affected consumers and states.

The QA lead approves justified equivalence groups and required retests. Sampling starts evaluation; it does not automatically transfer passes to untested scope. Final evaluation covers every required manifest tuple through direct evidence or approved explicit equivalence reasoning. Known defects cannot be replaced by that reasoning.

Roll-up: any applicable fail means fail. Without failures, any missing/unverified/stale required check means not_evaluated. Pass requires every required check to pass or have justified N/A. Whole-surface N/A requires all relevant criteria to be genuinely inapplicable. Do not average results or severity. Product completeness means closing required scope and meeting conformance conditions, not filling 55 cells.

Every evidence item is pinned to a snapshot containing commit, build, and dirty digest. Code/theme/locale/dependency or configuration changes invalidate affected evidence until retest or explicit reviewer confirmation of unchanged relevance. Merge/rebase requires binding evidence to the resulting snapshot. A new finding reopens previously closed checks according to the impact graph.

## Implementation Plan — Phases

| Phase | Deliverable | Completion condition |
|---|---|---|
| 0. Base and inventory | Selected commit, surfaces/modules/configurations, owners | No implicit exclusions; base commit agreed |
| 1. Baseline | Audit representative pages, complete processes, and distinct states | All 55 criteria considered; every failure has reproduction/owner |
| 2. Shared layer | Small PRs for fields, focus, tables, overlays, messages, and tokens | Fix and consumer tests; no public-contract regressions |
| 3. Core processes | Auth, CRUD, sales, portal, checkout | Complete processes usable by keyboard and screen reader |
| 4. Remaining surfaces | Enterprise/official modules, complex widgets, media, extensions | Every configuration in declared scope evaluated |
| 5. Final evaluation | Repeat audit and scope/results/remaining-limitations report | Every applicable A/AA requirement passes and conformance conditions are met |

Entry conditions: baseline follows an approved manifest and available configurations; shared fixes follow assignment of reproducible findings/module owners; processes require a stable test build; final evaluation follows ledger closure and affected-scope retests. The QA lead accepts phases 1–4; the product owner and QA lead accept phase 5. Unavailable tools/configurations remain explicit limitations preventing evaluation of the relevant required scope.

Guardian and Storybook capabilities are deployed independently through companion specifications. They can begin protecting new changes before all remediation finishes, without establishing whole-application conformance. Set timing/estimates after baseline rather than inventing a completion date before the number of violations is known.

Remediation priority: inability to log in/purchase/save, focus traps, and inaccessible modals are highest; missing names/relationships/errors and inaccessible primary actions are high; other confirmed A/AA violations require fixes according to human impact. Criterion level does not determine severity. A/AA defects are not cosmetic merely because axe does not classify them critical.

## Migration & Backward Compatibility

Preserve exports, variants, import paths, field/group/UMES IDs, and public props. DOM semantics fixes may change reader behavior but must preserve events, focus hooks, controlled/uncontrolled state, and consumer contracts. New props are optional. Changes to default dialog/menu behavior or primitive APIs require approval under UI AGENTS; this specification alone does not approve them. Contract-breaking fixes follow deprecation, bridges, and upgrade notes rather than an accessibility exception.

Mirror changes to `apps/mercato/src/app/**`, locales, or example environment configuration into create-app according to the router; update generated files only through generators. Run `yarn generate` when the affected surface relies on discovery. Update standalone harness/rules through the approved failure-first procedure without fabricating coverage. Do not apply DB migrations or change official-module submodule pointers as part of this program.

## Risks & Impact Review

### Outdated checkout duplicates upstream work

- **Scenario**: A fix written against an outdated checkout duplicates a newer upstream solution.
- **Severity**: High
- **Affected area**: Entire rollout
- **Mitigation**: Remap on the selected commit before coding.
- **Residual risk**: Deployment configuration differences remain.

### Scanner pass conceals an inaccessible process

- **Scenario**: Automated checks pass while a form or checkout cannot be completed.
- **Severity**: High
- **Affected area**: Forms and checkout
- **Mitigation**: Separate E2E, keyboard, and AT evidence; no automatic conformance claim.
- **Residual risk**: Unexpected AT combinations remain possible.

### Shared focus or ID change breaks a consumer

- **Scenario**: A shared focus/id fix breaks a consuming screen or injected widget.
- **Severity**: High
- **Affected area**: UI and UMES
- **Mitigation**: Consumer regression tests, stable IDs, and StrictMode/unmount checks.
- **Residual risk**: Customer extensions outside the repository need separate evaluation.

### Duplicate announcements or saves

- **Scenario**: A shortcut or rerender emits duplicate announcements or saves.
- **Severity**: High
- **Affected area**: Financial and CRUD processes
- **Mitigation**: One announcement channel, interaction tests, and preserved mutation guards.
- **Residual risk**: AT timing varies.

### Custom theme reduces contrast

- **Scenario**: A custom theme makes actual foreground/background pairs inaccessible.
- **Severity**: High
- **Affected area**: Themes
- **Mitigation**: Measure actual pairs and validate supported tokens.
- **Residual risk**: Arbitrary customer overrides need separate evaluation.

### Live region leaks data or overwhelms the reader

- **Scenario**: A live region exposes sensitive information or excessive updates mask important messages.
- **Severity**: High
- **Affected area**: AI, SSE, and notifications
- **Mitigation**: Minimal scoped messages, controlled fixtures, and grouped updates.
- **Residual risk**: Reader queueing strategies differ.

### Payment or SSO provider is inaccessible

- **Scenario**: An external payment/SSO step prevents completion of the process.
- **Severity**: High
- **Affected area**: Complete processes
- **Mitigation**: Inventory external steps, use sandboxes, and coordinate with providers.
- **Residual risk**: External code is outside project control; no full-pass claim without evidence.

### Temporary debt becomes a permanent exclusion

- **Scenario**: Legacy debt remains indefinitely and is treated as exempt from conformance.
- **Severity**: High
- **Affected area**: Governance
- **Mitigation**: Owner, deadline, retest, and an explicit matrix failure.
- **Residual risk**: Resource delays do not remove requirements.

### Token fix regresses dark mode

- **Scenario**: A token change improves light mode but worsens dark mode.
- **Severity**: Medium
- **Affected area**: Entire DS
- **Mitigation**: Evaluate both themes, states, and gradients in the same tests.
- **Residual risk**: Custom palettes need their own evidence.

### Audit tooling increases runtime weight

- **Scenario**: Test tooling enters the runtime bundle or increases application cost.
- **Severity**: Medium
- **Affected area**: Performance
- **Mitigation**: Development-only tooling and build/bundle comparisons.
- **Residual risk**: CI execution cost is assessed separately.

DB atomicity, cache invalidation, and new commands/events are N/A because no new business operations are introduced. Regression evaluation of existing mutations covers interruption, retry, and version conflicts; their guards/undo remain unchanged.

## Final Compliance Report — 2026-10-02

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/core/src/modules/design_system/AGENTS.md`
- `packages/create-app/AGENTS.md`

Supporting references: BACKWARD_COMPATIBILITY, spec-writing/checklist/frontend contract, backend-ui-design, DS Guardian, skill-creator, and PR workflow. Reread each module's closest AGENTS before implementation; this report does not claim every module has been reviewed.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Changes require the agreed scope and approvals | Compliant for documentation | Documentation, templates, and skill sources only; product implementation remains unapproved |
| .ai/specs/AGENTS.md | Spec-first, required sections, dated names | Compliant | Master and two independent companion specifications; English documentation |
| UI/backend AGENTS | Canonical UI and HTTP helpers | Compliant in design | Architecture/API contracts preserve helpers; implementation has not run |
| root/UI AGENTS | i18n, DS tokens, stable contracts | Compliant in design | UI/UX and compatibility requirements |
| root AGENTS.md | Tenant/RBAC/encryption/optimistic locking | Preservation required | No new storage; existing-process regression coverage |
| .ai/qa/AGENTS.md | Same-PR integration coverage | Required before implementation merge | Test families defined; concrete file/API manifests required per phase |
| Frontend architecture contract | Boundaries and performance evidence | Required before implementation merge | Zero runtime audit tooling; client/bundle ledger |
| Product accessibility contract | Complete WCAG evaluation | Not evaluated | No evaluation records exist; the ledger template is empty |
| Version/evidence contract | Identified current implementation basis | Partially established | Main/develop sources compared on 2026-10-02; execution base and runtime audit pending |
| Existing Skills Tiers Lint / Guardian contract | Registered skill and reliable verdict | Non-compliant prototype | Registered in the opt-in `analysis` tier; false-green gaps R2–R5 remain; see readiness report |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | QA artifacts only; no new business entities/endpoints |
| API contracts match UI/UX | Pass in design | Existing responses/guards preserved; actual flow evidence pending |
| Risks cover write operations | Pass in design | Existing mutation interruption/retry/conflict regressions; no new operations |
| Commands defined for mutations | N/A for new commands | Existing command/guard/undo behavior preserved |
| Cache strategy covers read APIs | N/A for new APIs | No new read API/cache layer |
| Scope and evaluation semantics agree | Pass after review | Manifest, perimeter, sample/roll-up, evaluation ledger, acceptance roles, and retests clarified |
| Related work and issues are linked | Pass for inspected snapshots | Existing owners and 22 issues; refresh before each implementation PR |
| Evidence establishes current product conformance | Not evaluated | No product/runtime/AT audit executed |

### Non-Compliant Items

- **Rule**: A ready verdict requires complete, current, applicable evidence and executed required checks.
  **Source**: Guardian contract and product evaluation requirements.
  **Gap**: Current validator permits false-ready cases and cannot express unavailable provenance honestly.
  **Recommendation**: Close readiness findings R2–R5 and prove caller behavior before enforcement.

### Verdict

**Ready for product and technical review; blocked for Guardian enforcement.** Product implementation has not been authorized and conformance has not been established. A module/contract audit is required before each implementation PR. No application builds/tests, migrations, or CI changes were performed for this specification.

## Changelog

- 2026-10-01 — Drafted after approval of WCAG 2.2 AA, full application scope, and companion documents. Added the UI profile, 55-criterion matrix, coverage plan, phases, compatibility requirements, and evidence boundaries.
- Review 2026-10-01 — Independent fresh-context review passed scope cohesion without further splitting. Clarified four gaps in manifest, aggregation, ledger, and phase acceptance. Implementation security/AT/performance evaluation remains pending.
- 2026-10-02 — Reviewed main/develop, linked 22 existing issues and related PRs, and identified reuse across storefront/CRM/enterprise, Storybook, CI token checks, and harness. Corrected Storybook provenance and added the Guardian readiness report.
- 2026-10-02 — Translated documentation into English and aligned risk/compliance sections with the Open Mercato specification template. Scope, issue links, and unresolved implementation blockers are preserved.
- 2026-10-02 — Rebased the baseline table on upstream develop. Unified the evaluation method vocabulary with the Guardian report contract and reduced the criterion CSV to an index without status columns. Recorded the opt-in tier registration of the Guardian source; R2–R5 remain open.
