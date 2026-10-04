# Open Mercato Accessibility — WCAG 2.2 AA and EN 301 549

## TLDR

The goal is WCAG 2.2 AA accessibility across the entire delivered application: the backoffice, authentication, customer portal, checkout, and all other active interfaces. Fix shared components, then verify complete processes and product configurations. New features must include an accessibility contract, tests, and evidence in the same PR.

WCAG covers web content only. The standard a deployer is measured against, EN 301 549, and the European directives under which it is or will be referenced as a harmonised standard add requirements for authoring capability, generated documents and e-mail, user preferences, documentation, and the information a service must publish. Those requirements are part of the target; see [Normative Basis and Version Policy](#normative-basis-and-version-policy).

Status: **draft proposed for review; product implementation has not been approved**. The standard, full scope, and document split are agreed. Application changes, skill installation/routing, Storybook changes, and CI integration are separate stages requiring approval of concrete changes. This document is neither a product conformance claim nor an assessment of legal obligations.

This master specification defines the product outcome. Two independently deployable capabilities have separate specifications: [WCAG Guardian](2026-10-01-wcag-guardian-pr-review.md) and [Storybook and automated testing](2026-10-01-storybook-wcag-quality-gates.md). Deploying either capability does not establish application conformance.

## Open Questions

Q1. The 2026-10-04 extension adds requirements whose implementation is eight separate capabilities (see Dependent Specifications). This document keeps the target and the evaluation program and defers each capability to its own specification. The alternative is to move the requirements themselves out with them, which would leave no single place that states the whole target. Does the maintainer accept the split as written?

Q2. Three readings go beyond the literal clause and are marked in the text: forced-colors visibility under `ENS-13`, scaffolds as templates under `ENS-19`, and the “every combination” rule for accessibility-supported technologies. Does the accessibility/QA lead confirm them?

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

### Normative Basis and Version Policy

Verified against the published texts on 2026-10-04. This section states which requirements the program implements and where they come from. It does not decide whether a law applies to a particular deployment; the deployer and its counsel decide that.

Terms: a **deployer** is the organisation that runs Open Mercato to offer a service. A **service provider** is the EAA's term for whoever provides a service to consumers; where the Directive applies to a deployment, that is the deployer. A **tenant** is a data-isolation unit inside one deployment and has no meaning in the directives.

| Source | Status on 2026-10-04 | Use in this program |
|---|---|---|
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/), W3C Recommendation; identical to ISO/IEC 40500:2025 | In force | The target: all 55 Level A and AA success criteria and the five [conformance requirements](https://www.w3.org/TR/WCAG22/#conformance-reqs). W3C states that content conforming to WCAG 2.2 also conforms to WCAG 2.0 and 2.1, with one caveat: WCAG 2.2 removed SC 4.1.1 Parsing, and a policy that cites 2.0 or 2.1 may still require reporting it (`ENS-26`). |
| [EN 301 549 V3.2.1 (2021-03)](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_60/en_301549v030201p.pdf) | The reference version until V4.1.1 is cited in the Official Journal, according to [AccessibleEU](https://accessible-eu-centre.ec.europa.eu/content-corner/news/european-accessibility-standard-en-301-549-has-been-updated-2026-09-07_en) | Clause 9 is WCAG 2.1 AA: the target's criteria without the six that WCAG 2.2 added, plus SC 4.1.1 Parsing (clause 9.4.1.1). Table A.1 also applies clauses 5.2 to 5.4, 6, 7, 10 (documents downloadable from a web page), 11.7, 11.8, and 12 to web content; 11.7 and clause 12 unconditionally, the others each under its own condition. |
| [EN 301 549 V4.1.1 (2026-09)](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf) | Published by ETSI; not yet cited in the Official Journal | Clause 9 is WCAG 2.2 AA with the conformance requirements (9.6) and a web-specific user-preference requirement (9.7); clause 9.4.1.1 is void. The functional performance criteria of clause 4.2 became requirements. Authoring tools moved from 11.8 to 5.10; clause 12 became “Information about products and services”; clause 14 defines conformance. Annex ZA maps the standard to Directive (EU) 2016/2102, and Annex ZB and clause A.2 (Tables A.1 to A.5) to Directive (EU) 2019/882. |
| [Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj), the European Accessibility Act (EAA) | Applies to services provided to consumers after 28 June 2025, including e-commerce services | Annex I Section III (all services) and Section IV(g) (e-commerce), Article 13 (service providers), and Annex V (information on the service). The Directive does not name EN 301 549; the standard gives presumption of conformity once cited under it. |
| [Directive (EU) 2016/2102](https://eur-lex.europa.eu/eli/dir/2016/2102/oj), the Web Accessibility Directive (WAD) | In force for public sector bodies | Article 7: accessibility statement, feedback mechanism, and link to the enforcement procedure. Relevant when a public sector body deploys the product. |
| Other jurisdictions and customer contracts | Not assessed in this document | A deployer determines them. The technical target stays WCAG 2.2 AA plus the supplement below. |

Level AAA is not part of the target. W3C does not recommend requiring it for entire sites, and EN 301 549 lists the AAA criteria in an informative clause (9.5). An AAA criterion adopted as a product recommendation is labelled as such and never reported as an A/AA failure.

Requirements outside the 55 criteria are indexed in the [EN 301 549 and directive supplement](../qa/accessibility/en-301-549-supplement.csv) under stable identifiers (`ENS-*`, `EAA-*`, `WAD-*`) with the clause numbers of both standard versions, because the numbering changed between them. Evaluation uses the WCAG 2.2 AA criteria for clause 9 and the supplement for everything else. Where the two versions word a requirement differently, the contract in this specification follows the stricter text and says so.

Where a sentence in this specification goes beyond the clause it cites, it is marked *(product decision)*. A product decision is part of the product target, but its failure is reported as such and not as a failure of the standard.

**Who does the work.** Under the EAA the obligations rest on the service provider. The supplement's `implementedBy` column says who has to act for a requirement to be met: `product` (the interfaces, generated output, authoring capability, and documentation the project ships), `deployer with product support` (the deployer acts and the product must make that possible, for example by offering a place to publish information), or `product and deployer` (both have their own part). The product cannot make a deployment conformant by itself: tenant content, custom themes, extensions, and the deployer's own procedures remain the deployer's.

**No reliance on exemptions.** The microenterprise exemption (Article 4(5) EAA), disproportionate burden (Article 14), and the content exclusions of Article 2(4), such as pre-recorded media and office files published before 28 June 2025 or third-party content outside the operator's control, are determinations a deployer makes about its own service. The program does not use them to reduce the product target.

**Version policy.** The accessibility/QA lead owns a standards watch: at every release, record the cited version of EN 301 549, any change to WCAG, and the resulting mapping changes in the scope manifest and the upgrade notes. Article 13(3) EAA requires service providers to take changes in harmonised standards into account, so deployers need this record. When V4.1.1 is cited, re-evaluate every supplement row whose two clause columns differ or whose text changed between the versions: 4.2, 5.3, 5.6 to 5.8, 5.10, clause 6, 7.3, 9.7, 10.7, 12, and 14.3.

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

### Source Observations for the Supplement — 2026-10-04

Read from the source of develop `7f0ebf65398fbf75a3f2485cc79d31da92a108b3` on 2026-10-04; the optional official-modules checkout was not present and is not covered. Every row is a method `source` observation that tells the baseline where to look. None is a ledger result: each needs confirmation in the browser, a document checker, or a mail client on the selected build, and several areas may have changed since. Line references are omitted on purpose; the evaluation record pins the file and line on the build it tests.

| Area | Observation | Requirement to evaluate |
|---|---|---|
| Flash messages | Every message, including errors, is removed after 3 seconds with no way to pause it (`packages/ui/src/backend/FlashMessages.tsx`) | SC 2.2.1, 3.3.1, 4.1.3 |
| Session expiry | The staff access token lasts 8 hours and the session 8 hours, or 30 days with “remember me”. Nothing warns before expiry or offers to extend. On a 401 an untranslated English message is shown and the page is sent to the session refresh endpoint about 20 ms later (`packages/ui/src/backend/utils/api.ts`); whether unsaved input survives is not established | SC 2.2.1, 3.1.1 |
| Single-key shortcuts | The agent caseload, the customers calendar, and the workflow editor bind single keys page-wide; no setting turns them off or remaps them | SC 2.1.4, `ENS-01` |
| Forced colors | No style or script refers to forced colors. Shared primitives pair `focus-visible:outline-none` with a `box-shadow` focus ring; in Tailwind 4 `outline-none` sets `outline-style: none` without the forced-colors fallback that `outline-hidden` has, so the focus indicator is probably invisible in a contrast theme | `ENS-13`, SC 2.4.7 in that mode |
| Dragging | DataTable column reorder and the staff time-tracking board register a pointer sensor only; dashboard widget reorder uses native drag and drop without a keyboard path | SC 2.1.1, 2.5.7 |
| Charts | Bar, line, and pie charts render without a text alternative or data table | SC 1.1.1, 1.4.1 |
| Rich-text editor | Images are inserted from a URL prompt without alternative text; inserted tables have no header cells (`packages/ui/src/primitives/rich-editor.tsx`) | `ENS-16`, SC 1.1.1, 1.3.1 in the produced content |
| Documents editor | Uploaded images are inserted with a source only | `ENS-16` |
| Product media | The attachment entity has no alternative-text field. An AI tool writes `altText` into storage metadata, no form edits it, and product image renders use the file name as `alt` | `ENS-16`, SC 1.1.1 |
| Sanitizers and imports | The rich-text sanitizer keeps `img[alt]` and `th` but drops `lang`, `dir`, `scope`, and `caption`; the Akeneo import converts HTML to Markdown and creates media without alternative text | `ENS-17`, `ENS-03`, SC 3.1.2 |
| Checkout link templates | Brand colours are validated as hex values only; text colour is chosen by a brightness threshold, not a contrast ratio. The brand style studio enforces 4.5:1 and can be reused | `ENS-16`, SC 1.4.3 on the produced page; `ENS-18` for the studio's own check |
| E-mail | The React Email templates (22 files) use `<Html>` without `lang`. Copy is resolved in the locale of the request that triggered the send, and notification e-mails in the default locale, not the recipient's. The plain-text part is produced by stripping tags, which loses link targets and alternative text | `ENS-14`, `ENS-03`, SC 3.1.1 |
| PDF and DOCX | The documents module prints HTML without `lang` through Chromium with default options (no bookmarks; tagging not verified). Timesheet PDFs come from a hand-written writer with no structure tree or language. DOCX images have no description | `ENS-14` |
| Payment fields | The Stripe payment element is mounted without a locale, so its language can differ from the page | `EAA-05`, SC 3.1.2 |
| Error page | The global error boundary renders `<html>` without `lang` | SC 3.1.1 |
| Documentation | The documentation site has no accessibility page and does not describe assistive-technology support; keyboard shortcuts are documented for a few features only | `ENS-20` |
| Service information | There is no accessibility information page or feedback route; shell footers link to terms and privacy only | `EAA-01`, `WAD-01` |
| Notice bars | The first-party cookie and demo notice bars are rendered on every page of the application and its template | Part of every full page; all criteria |
| Telephony | Call records from telephony integrations are listed; the API withholds the recording URL and nothing plays audio | `ENS-24` |
| Not found | No media player, audio or video element, sound, call, real-time text, CAPTCHA, native or packaged application, or third-party chat | Evidence for the phase 0 applicability decisions on `ENS-08` to `ENS-11`, `ENS-25`, `ENS-30` to `ENS-32`, `ENS-34`, and `ENS-38` |

### Scope Manifest and Acceptance Roles

Full scope means every delivered product surface, not only modules that happen to be active in a local build. Phase 0 produces a versioned manifest: release/commit/build, editions, all delivered modules and versions, activation variants, route templates and complete flows, roles/feature profiles, locales, supported themes/brand presets, mobile/desktop, generated/exported documents, external steps, and ownership boundaries. It also records the standards baseline, the accessibility-support baseline, every time limit the product sets, every outbound message template and its channel, authoring surfaces and the content they produce, templates and scaffolds, media and real-time communication features, documentation and support channels, third-party embeds, and an applicability decision with evidence for every row of the supplement. A module disabled in one build must still be evaluated in a configuration that delivers it to users.

We do not claim evaluation of arbitrary customer extension code, user data, or CSS overrides. The manifest distinguishes delivered/supported configurations from unrestricted modifications outside project control. Project-owned extension hosts and editing tools remain in scope; officially supported extensions/themes require evaluation cases. An external step in a complete flow receives a result and owner rather than automatic N/A. A known provider barrier prevents a pass for that process.

The product owner and accessibility/QA lead approve the manifest before baseline evaluation. Every proposed exclusion needs its own rationale, owner, and explicit product-owner approval to change scope; no exclusions have been approved. Module owners own fixes and fixtures; the accessibility/QA lead owns results and missing evidence; the maintainer owns contracts/merge; the design owner owns DS governance. Final evaluation requires acceptance by the accessibility/QA lead and product owner; automation cannot approve on their behalf. Assign named people in phase 0.

## Problem Statement

The DS standardizes appearance and selected interactions but does not document complete WCAG coverage across real processes. An accessible component can lose its label, error message, or keyboard behavior in a particular consumer. An initial-render scan does not evaluate a later-opened dialog, validation errors, data changes, or focus loss after deleting a record.

This program has no browser audit on the identified version, criterion–process–evidence matrix, or documented screen-reader evaluation yet. The first deliverable must be a reliable baseline rather than a scanner-based “100% accessible” claim.

## Proposed Solution

Use one product contract, shared fixes at real call sites, complete-process audits, and durable evidence. New and changed features define accessibility requirements during specification and design; PRs supply appropriate component, interaction, and process tests. Confirmed A/AA violations and failures of applicable supplement requirements in new features, and regressions of either, require fixes. Existing violations remain visible in the remediation ledger and do not exempt the product from its conformance goal.

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
| Recipient of a message or document | Read and act on an e-mail, a confirmation, or an exported document with assistive technology |
| Author of content | Produce content, media, and templates that the readers above can use, with guidance from the tool |
| Deployer | Publish how the service meets the requirements and receive reports of barriers |

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

This specification adds no business entities, migrations, or persistent tenant preferences, and the audit ledger is a QA artifact rather than a database table. Several requirements cannot be met without stored data or configuration; they are listed under Dependent Specifications. Each needs its own specification with the data model, migration, encryption review, and backward-compatibility analysis before implementation; this document does not approve those changes. Each evaluation record contains criterionId, surfaceId, flowId, routePattern, module/role/theme/locale configuration, state, method, status, evidence reference, inspected commit/build, date, owner, and rationale.

Statuses: `not_evaluated`, `pass`, `fail`, `not_applicable`. `not_applicable` requires evidence that the relevant functionality is absent from that surface. Absence of video in the backoffice does not automatically imply N/A for checkout or injected widgets. Missing tests mean `not_evaluated`.

Methods: `source`, `automated`, `browser`, `measurement`, `manual`, `manual_at`. The criterion index, the evaluation ledger, and the Guardian report share this vocabulary, defined in the [report contract](../skills/om-wcag-guardian/references/review.md#methods).

The [55-criterion CSV](../qa/accessibility/wcag-22-aa-matrix.csv) and the [supplement](../qa/accessibility/en-301-549-supplement.csv) are **normative indexes and evaluation-method plans**, not records of every screen's evaluation; they carry no status or evidence columns. The ledger's `criterionId` holds a success criterion number or a supplement identifier, and a supplement row whose condition is false is recorded as `not_applicable` with the evidence for that. Three rows are umbrellas and are recorded more finely: a document or message that fails a clause 10 requirement is recorded under the WCAG criterion it mirrors with the document as the surface, while `ENS-14` records applicability and the document-specific clauses; each of the five conformance requirements gets its own `ENS-12` record, named in `requiredCheckId`; and `ENS-08` and `ENS-38` are single records while their condition is false and are split by clause when it becomes true. The conformance report presents results per clause using the index's clause columns. The actual ledger has a separate row for each criterion × surface × process × configuration × state × method × build tuple; the [evaluation template](../qa/accessibility/evaluation-records.template.csv) defines its fields. The [manifest template](../qa/accessibility/scope-manifest.template.json) defines scope structure. Empty templates are not evaluation evidence. QA maintains manifest and ledger sources under `.ai/qa/accessibility/`; large anonymized evidence belongs in an approved artifact store with hashes and references. Local operational files are not automatically committed upstream.

Each record links criterionId to a Guardian check ID or a Storybook run/story/state and, when required, separate manual AT evidence. Only required manifest methods and actually executed checks can close a record. A skill report does not automatically replace a product evaluation entry.

The remediation ledger also records reproduction, affected users, severity, criteria, source/confidence, due date, fix evidence, and regression test. Acceptance of process debt does not turn `fail` into `pass`. Evidence must exclude real customer data, secrets, and tokens; use controlled fixtures and anonymized artifacts.

## API Contracts

This specification adds or changes no endpoints. The capabilities listed under Dependent Specifications will expose new fields through existing resources; their API contracts belong to those specifications. Evaluation covers UI behavior after existing API responses: success, validation error, forbidden, not-found, timeout, version conflict, and interrupted connection. Assign exact paths and payloads in the inventory before each PR; do not invent endpoints.

Create fixtures with existing API helpers. Mutations preserve `apiCall`, CRUD helpers, and `useGuardedMutation`; required `updatedAt` and the conflict bar stay active. Status announcements must not bypass guards, expose cross-tenant data, or repeat mutations.

## UI/UX — Acceptance Contracts

The implementation requirements below define the Open Mercato profile. WCAG references identify the normative basis; additional product requirements are identified separately. The [matrix](../qa/accessibility/wcag-22-aa-matrix.csv) contains all 55 A/AA criteria and their evaluation plan.

### Semantics, Navigation, and Keyboard

Every page has an appropriate title, language, heading hierarchy, and recognizable landmarks. Provide a way to bypass repeated navigation. Links navigate; buttons act. Every mouse action has a keyboard path; positive tabindex must not determine order. Accessible names include visible labels. Decorative icons must not add redundant names. Every image that carries information, every icon-only control, and every image used as a button has a text alternative that serves the same purpose ([SC 1.1.1](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)). Headings and labels describe the topic or purpose of what they introduce ([SC 2.4.6](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)).

When the order of content affects its meaning, the order in the DOM is the reading order: visual reordering with CSS, portaled content, and multi-column layouts do not make a screen reader or a linearised view present steps, labels, or messages out of sequence ([SC 1.3.2](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html)).

Tab/Shift+Tab moves logically between controls; Arrow/Home/End keys operate only the relevant composite widgets. Shortcuts must not intercept typing in inputs/editors. Single-character shortcuts can be disabled, remapped, or restricted to focus. [ARIA APG](https://www.w3.org/WAI/ARIA/apg/) provides implementation guidance rather than a separate WCAG certificate. Do not convert an ordinary table into a grid without a real need and a complete interaction model.

### Focus and Overlays

Focus is visible in light/dark themes and hover/selected states. Opening a modal moves focus to a meaningful element; the modal manages focus and prevents background interaction. Escape closes the appropriate layer. Closing restores focus to the trigger or an explicitly selected successor if the trigger was removed. Nonmodal popovers must not trap focus.

Sticky headers/footers, menus, and the conflict bar must not completely obscure the active control: [SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). Full focus visibility is a product goal; do not present AAA criteria 2.4.12/2.4.13 as AA requirements. Dialogs have names/descriptions and buttons usable without shortcuts. Preserve repository Cmd/Ctrl+Enter and Escape behavior; shortcuts must not bypass validation, submit twice, or interrupt IME composition.

### Forms and Authentication

Every field has a programmatic label, an unambiguous stable id, and associated descriptions/errors. Errors are identifiable through text and field state; instructions specify format and required data. Checkbox/radio groups have group names. Placeholders do not replace labels. Validation preserves values; after failed submission, focus and announcements lead to the summary/first error according to the agreed pattern, including hidden sections and custom fields.

Autofill/password managers work; password and complete-code pasting are not blocked. Evaluate every MFA/SSO/re-authentication step without removing security controls. CAPTCHA or transcription challenges require assessment of assistance mechanisms or permitted alternatives: [SC 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html). Previously supplied information needed again in the same process is selectable or prefilled unless a documented exception applies.

Fields that collect information about the person filling in the form carry the matching `autocomplete` token: staff and customer sign-in, signup, a user's own profile, password and address forms in the backoffice and the portal, and the contact fields of the pay page. Backoffice forms in which staff enter another person's data are outside [SC 1.3.5](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html).

A biological characteristic is never the only means of identifying a user or operating the product (`ENS-02`). V3.2.1 clause 5.3 forbids relying on one particular characteristic and accepts another biometric as the alternative; V4.1.1 requires a means that does not rely on a biological characteristic at all, and this contract follows V4.1.1. A passkey unlocked with a device PIN meets it, so the enterprise security module must not restrict passkeys to authenticators that offer only biometric unlock, and an account whose only passkey is of that kind keeps another sign-in method.

For an e-commerce service the EAA names identification, security, payment, and electronic signature steps explicitly (`EAA-05`, `EAA-06`). The Directive concerns services provided to consumers, so in this product those are the customer-facing steps: signup, verification, invitation, sign-in and password reset in the portal, the pay page with its provider fields and status pages, terms acceptance, and quote acceptance through the public quote link. Each is a complete process in the manifest, including the steps a payment provider renders. Staff sign-in, MFA, SSO, and step-up challenges are held to the same criteria through WCAG, not through the Directive.

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

Kanban, column reordering, calendars, sliders, and visual editors provide a single-pointer alternative to dragging, such as “Move to…” or position selection. Keyboard support alone does not meet this requirement: [SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

A function operated with a multipoint or path-based gesture, such as a pinch or a swipe along a route, can also be operated with a single pointer without a path-based gesture, unless the gesture is essential ([SC 2.5.1](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html)). A function operated with a single pointer does not fire on the down-event; or it completes on the up-event with a way to abort before completion or to undo afterwards; or the up-event reverses what the down-event did; unless firing on the down-event is essential ([SC 2.5.2](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)).

Information shown in tooltips/popovers on hover/focus is dismissible, hoverable, and persistent under the applicable conditions. Audio/video receives required alternatives, captions, and audio descriptions according to medium. Customer-supplied content has explicit control boundaries; it does not exempt the project's editor/UI. Honouring `prefers-reduced-motion` is a product-quality requirement with separate tests, because the corresponding criterion is AAA; do not imply every recommendation is an AA criterion. Forced colors and the other user-agent settings are a requirement of EN 301 549 and are specified under User Preferences and Platform Settings.

### User Preferences and Platform Settings

The two versions of EN 301 549 word this requirement differently (`ENS-13`). V3.2.1 clause 11.7 says a user interface follows the user's platform settings for units of measurement, colour, contrast, font type, font size, and focus cursor, except where the user overrides them; for web content the platform is the browser. V4.1.1 clause 9.7 says a web page does not block the browser's modes of operation that present it according to user preference settings, and does not explicitly override those settings for documented platform accessibility features unless that is essential; its notes name colour filters, contrast, text size, pointer size, and text cursor, and give `forced-color-adjust` as an example of an explicit override. The contract below covers both lists.

| Setting | Acceptance |
|---|---|
| Colour and contrast, including forced colors | The page does not disable the browser's forced-colors mode or colour filters. `forced-color-adjust: none` is used only where the colour is the information, such as a colour swatch or a brand preview. This program also reads the requirement as covering what the user gets in that mode: content, focus, selection, and control state remain visible and operable. A focus indicator or state drawn only with `box-shadow` or a background colour is not painted in forced colors, so removing the outline without a fallback leaves the user with no indicator. The accessibility/QA lead confirms or narrows this reading in phase 0; until then it is evaluated and reported under `ENS-13` as a program reading. |
| Text size and zoom | No viewport setting restricts scaling. Text sizes follow the browser's default font size, and a minimum-font-size setting does not clip content. |
| Font type | A font chosen by the user in the browser does not break layout or hide content; meaning never depends on a particular typeface, including icon fonts. |
| Focus indicator, text cursor, pointer | The page does not hide the text cursor, replace the pointer with a custom cursor that ignores the user's pointer size, or remove the browser's focus indicator without providing its own. |
| Colour scheme | The “system” theme follows the operating system. A theme the user picked in the product is a user override and is allowed by both versions. |
| Units of measurement | Dates, numbers, and units follow the locale the user selected. Where the browser exposes no further preference, nothing more applies. |

A documented accessibility feature can be switched on without relying on a method the user cannot use (`ENS-01`). Once the documentation lists features such as turning single-key shortcuts off, changing the theme, or opening a shortcut legend, the controls for them are reachable by keyboard and screen reader and are not available only through a shortcut or a hover.

The state of a switch, toggle button, or pressed control is visible and is exposed programmatically (`ENS-04`); conforming to SC 1.3.1 and 4.1.2 and not relying on colour alone normally satisfies it. Any action bound to a key combination or a multi-finger gesture also has a path that needs one action at a time, in practice a visible control (`ENS-07`). `ENS-05` and `ENS-06` apply only to a product that implements its own key repeat or key acceptance timing; phase 0 records whether any component does.

### Timing, Predictability, and Error Prevention

These criteria have no component that owns them, so each needs an explicit rule for this product.

- **Time limits** ([SC 2.2.1](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html)). The manifest lists every limit the product sets: session expiry, verification and one-time code expiry, payment sessions, undo windows, and messages that dismiss themselves. For each, the user can turn the limit off, adjust it, or is warned and can extend it with a simple action, unless one of the criterion's exceptions applies (a real-time event, an essential limit, or a limit longer than 20 hours). The exception claimed is recorded with its reasoning; a limit that exists for security is not treated as essential without that reasoning *(product decision)*. An error message, and any message that is the only notice of a failure or of something the user must do, stays until the user dismisses it *(product decision; the criterion requires that the limit can be turned off, adjusted, or extended)*.
- **Automatic updates** ([SC 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)). Information that starts updating automatically and is shown next to other content, such as polled lists, counters, and background progress, can be paused, stopped, or hidden, or its frequency controlled, unless the updating is part of an activity where it is essential. Moving or blinking content that starts automatically and lasts more than five seconds follows the same rule. Output the user asked for, such as a streamed assistant answer, does not start automatically; it is covered by the status-message rules instead.
- **Flashing and sound** ([SC 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html), [SC 1.4.2](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html)). Nothing the product renders flashes more than three times in any one-second period above the thresholds. Audio that plays automatically for more than three seconds can be paused or stopped, or its volume controlled independently of the system volume.
- **No surprise changes of context** ([SC 3.2.1](https://www.w3.org/WAI/WCAG22/Understanding/on-focus.html), [SC 3.2.2](https://www.w3.org/WAI/WCAG22/Understanding/on-input.html)). Receiving focus never changes the context: it does not navigate, submit, open a dialog, or move focus elsewhere. Changing the setting of a control does not change the context either, unless the user was advised of that behaviour before using the control. Filters that update results in place do not change the context. A language, organisation, or tenant switcher that reloads the page on selection needs a confirming action or an advance notice in its label or description.
- **Consistency** ([SC 3.2.3](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html), [SC 3.2.4](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html), [SC 3.2.6](https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html)). Navigation repeated on several pages keeps its relative order within each shell unless the user changes it. Components with the same function are identified the same way in every module. Help mechanisms that repeat across pages, including the link to the accessibility information page once it exists, keep the same relative order unless the user changes it.
- **Finding pages** ([SC 2.4.5](https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html), [SC 2.4.4](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html)). A page is reachable in more than one way, for example navigation and search, except where it is the result of, or a step in, a process. The purpose of a link can be determined from its text together with its programmatically determined context, such as the table row it sits in. Repeated row actions additionally carry the row's name in their accessible name *(product decision)*.
- **Instructions and text** ([SC 1.3.3](https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html), [SC 1.4.5](https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html)). Instructions do not depend on shape, colour, size, position, or sound alone. Interfaces, e-mails, and generated documents use text, not pictures of text, except in logos and where a particular presentation is essential.
- **Language of parts** ([SC 3.1.2](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html)). A passage in a language other than the page's, such as a tenant's translated field value or the language names in the language switcher, carries `lang`. Proper names, technical terms, and words that have become part of the surrounding language are excepted. This depends on the preservation rule under Authoring Capability.
- **Error suggestion and prevention** ([SC 3.3.3](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html), [SC 3.3.4](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html)). When the system knows what would be valid, the message says so, unless that would jeopardise security or the purpose of the content. A submission that commits the user legally or financially, or changes or deletes data the user controls, is reversible, checked with a chance to correct, or confirmed after review. That covers the pay page, quote acceptance, single and bulk deletion, bulk updates, and account changes in the portal. An undo that is offered only for a few seconds counts as “reversible” only if its window meets the time-limit rule *(product decision)*; otherwise a check or a confirmation step is needed.
- **Device motion** ([SC 2.5.4](https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html)). A function triggered by moving the device or the user can also be operated through the interface, and the motion response can be disabled.

Whether the product has any sound, device-motion input, or moving content is established in phase 0; the source observations record what was found.

## Requirements Beyond the Web Interface

The requirements in this section come from EN 301 549 and the directives, not from the 55 criteria. Each is indexed in the [supplement](../qa/accessibility/en-301-549-supplement.csv). Several cannot be met without new stored fields or new screens; this specification defines the requirement and its acceptance, and each such capability needs its own specification and approval before implementation (see Dependent Specifications).

### Authoring Capability

Parts of the backoffice are authoring tools as EN 301 549 defines them: software that can be used to create or modify content. Other people then read that content in the portal, on public pages, in e-mails, in exported documents, or in a sales channel. An authoring tool must enable and guide the production of content that conforms to clause 9 or clause 10, to the extent the output format supports the information required for accessibility (`ENS-15` to `ENS-19`: V3.2.1 clause 11.8, V4.1.1 clause 5.10).

The manifest lists every authoring surface with the content it produces and where that content is shown. The source survey found the rich-text editor for HTML fields, the Markdown editor used for product descriptions, notes and messages, the editor of the documents module, product media and other attachments, checkout link templates (texts, colours, logo), organisation branding, the brand style studio, per-locale field translations, and custom field definitions, whose labels and help texts become the accessible names and descriptions of generated forms.

| Requirement | Acceptance |
|---|---|
| Enable (`ENS-16`) | Every editor can produce what the criteria require of the content: headings, lists, tables with header cells, link text that states the link's purpose, a text alternative for an image with an explicit “decorative” choice, and the language of a passage. Media has a stored text alternative that a person can edit where the media is managed, and every interface, API, document, and message that outputs the media uses it; a file name is not a text alternative. Storing the alternative per locale is a *(product decision)* that follows from the product's translation model. |
| Guide (`ENS-16`) | The clause requires that the tool guides the author; how is a *(product decision)*: inserting an image asks for its text alternative, inserting a table creates a header row, a field definition cannot be saved without a label, colours chosen for a template are checked against SC 1.4.3 for the page they produce, and hints appear where the author works. Whether a missing alternative blocks saving or only warns is recorded in the feature specification. |
| Preserve (`ENS-17`, `ENS-03`) | Where the product restructures or re-codes authored content, and wherever it converts information, the accessibility information the destination format can hold is kept: `alt`, `lang`, `dir`, table headers with `scope`, `caption`, heading levels, and link targets. That applies to sanitizers, importers, exporters, format converters, and the generator of the plain-text part of e-mails. A sanitizer is a security control, so an allow-list change goes through security review; the attributes and elements above carry no script. |
| Repair (`ENS-18`) | The clause applies only where the tool already detects a failure: it must then offer a repair suggestion. The brand style studio detects insufficient contrast and must therefore suggest a passing value. Adding further detection, for example of an image without a text alternative, an empty link, or a table without headers, is a *(product decision)*; the standard calls detection of easily found failures best practice. |
| Templates (`ENS-19`) | Where the product provides templates, at least one template that supports the creation of conforming content is available and identified as such. This program applies that to each family separately *(product decision)*: checkout link templates, document templates, content pages, and message templates. “Identified” means a visible label in the place where the author picks the template and a line in the documentation. Whether the application and module scaffolds that third parties build on are templates in the sense of the clause is a reading the accessibility/QA lead confirms or rejects in phase 0. |

Content a tenant writes remains the tenant's responsibility. The product's responsibility is that accessible content is possible, guided, and not damaged on the way to the reader.

### Generated Documents, Exports, and Messages

Clause 10 of EN 301 549 applies the WCAG-derived requirements to documents that are not web pages (`ENS-14`). The basis differs by version and regime. Under V3.2.1 Table A.1, which maps the WAD, clause 10 applies to documents and forms that can be downloaded from a web page. Under V4.1.1 clause A.2, which maps the EAA, it applies whenever the product is or includes a non-web document, and Annex I Section III(b) of the Directive requires the electronic information needed to provide the service to be perceivable, operable, understandable, and robust. The standard's definition of a document names e-mail messages as an example. This program therefore treats generated documents and e-mail alike.

The manifest lists every generator and template: document export to PDF and DOCX, report export to PDF, XLSX and CSV, table export to CSV, JSON, XML and Markdown, and every e-mail template with its channel.

- **PDF.** Tagged structure with headings, lists, and tables with headers in reading order; a document title and language; text alternatives for images; real text; contrast as on screen. The document does not block or override the reader's user-preference modes (V4.1.1 clause 10.7). Bookmarks and embedded fonts are a *(product decision)*: clause 10 does not require them. Evidence is a document checker result that names the tool, plus a screen reader pass.
- **DOCX and XLSX.** Heading styles, table header rows, text alternatives for images, document language, named sheets with a header row.
- **Data exports.** CSV, JSON, XML, and Markdown files are data for other software to read. Using headers or keys that match the interface labels and declaring the encoding is a *(product decision)*; clause 10 adds nothing specific.
- **E-mail.** The message declares its language, has a heading structure, link text that states the purpose, text alternatives, sufficient contrast, no pictures of text, and reflows at 320 CSS px. As *(product decisions)*: the message is written in the recipient's language, not the sender's; codes and links can be selected and copied; contrast is checked in light and dark mail clients; and the plain-text part keeps link targets and text alternatives, which also follows from `ENS-03`. A message that states a time limit follows the time-limit rule.
- **Conversion** (`ENS-03`). Turning HTML into PDF, DOCX, or plain text keeps the information listed under Preserve above.

Push notification text is not a document; it follows the service-information row of the deployer kit. Documents a tenant uploads are tenant content. The product's generators and templates are not.

### Media and Real-Time Communication

Clause 7 of EN 301 549 applies to a product that displays video with synchronised audio, and clause 6 to one that provides two-way voice communication (`ENS-08` to `ENS-11`). Two clause 6 requirements have their own conditions: caller identification must be available as text and programmatically (`ENS-24`), and voice mail, auto-attendant, or interactive voice response needs an alternative that requires neither hearing nor speech (`ENS-25`). Phase 0 decides the applicability of each row with evidence. The source survey found no media player, no audio or video element, and no call or real-time text; it found call records from telephony integrations listed without playback, which makes `ENS-24` the row to examine first.

A feature that plays a recording, previews an uploaded video, shows an instructional or product video, or places a call makes the corresponding rows applicable. Its specification must then include the WCAG media criteria (1.2.1 to 1.2.5) and the clause 7 requirements: captions and audio description are displayed, stay synchronised, and survive transmission, conversion, and recording, and the user can switch them with a single operation at the same level as the primary media controls (V3.2.1) and the volume control (V4.1.1). For calls, it must include clause 6.

### Functional Performance, Parsing, and Product Type

**Functional performance criteria** (`ENS-27` to `ENS-37`). In V3.2.1 clause 4.2 holds functional performance statements that describe the user needs behind the technical requirements of clauses 5 to 13. In V4.1.1 they are requirements listed for all ICT, and Annex ZB cites them for every service requirement of the EAA. Most are met by meeting the technical requirements; the program still records each one so that nothing falls between clauses:

- Usage without vision, with limited vision, and without perception of colour (`ENS-27` to `ENS-29`) and with limited manipulation or strength (`ENS-33`) are evaluated through complete processes with a screen reader, at 400% zoom, without colour cues, and with keyboard only or a single pointer.
- Minimising photosensitive seizure triggers (`ENS-35`) is evaluated with SC 2.3.1 and must hold in the default mode.
- Usage with limited cognition, language, or learning (`ENS-36`) requires features or presentation that make the product simpler to understand, operate, and use. The standard gives timings, error indication and suggestion, logical focus order, and tasks presented in steps as examples. The contracts for errors, time limits, consistency, and redundant entry are this product's means; the accessibility/QA lead judges per process whether they suffice.
- Privacy (`ENS-37`): using an accessibility feature does not expose the user's data. Masked input is not announced character by character unless the user chooses it, and one-time codes, payment data, and personal data are not sent to a global live region.
- Usage without hearing, with limited hearing, without vocal capability, and with limited reach (`ENS-30` to `ENS-32`, `ENS-34`) apply only to products with auditory modes, vocal input, or stationary hardware; phase 0 records the evidence.

**Parsing** (`ENS-26`). V3.2.1 clause 9.4.1.1 requires WCAG 2.1 SC 4.1.1, which WCAG 2.2 removed and V4.1.1 voids. The current WCAG 2.1 text notes that the criterion is always satisfied for HTML and XML content, because browsers now handle malformed markup in a defined way; the 2018 text that V3.2.1 cites has no such note. Until V4.1.1 is cited, the program reports the row using the automated checks for duplicate IDs and malformed nesting it runs anyway, and treats a markup error that breaks another criterion under that criterion.

**Requirements that depend on the type of product** (`ENS-38`). Closed functionality (clause 5.1), hardware (5.5 and clause 8), non-web software such as a native application (clause 11), electronic programme guides (12.4, 12.5), and relay or emergency services (clause 13) apply only to a product that is or includes such ICT. The source survey found none: the project ships no native or packaged application, only server-side support for external applications' push notifications. Phase 0 records the decision; a native client or a kiosk mode would make the corresponding clauses applicable.

### Documentation and Support

Product documentation lists the accessibility and compatibility features and explains how to use them (`ENS-20`), is itself accessible (`ENS-21`), and under V4.1.1 clause 12.3 also says how to get support for those features. The documentation site therefore gets an accessibility page, linked from the product. The clauses require the list of features, how to use them, and how to get support. As *(product decisions)* the page also covers the keyboard model and every shortcut, how to turn single-key shortcuts off, theme and contrast options, the supported browser and assistive-technology combinations from the accessibility-support baseline, the known limitations from the remediation ledger for the release, and how to report a barrier. The documentation site is in the manifest and is evaluated like any other surface, including its search, code samples, diagrams, and linked videos.

Support services provide the information on accessibility and compatibility features that the documentation mentions, accommodate the communication needs of people with disabilities directly or through a referral point, and provide their own documentation in an accessible format (`ENS-22`). The communication requirement exists in V3.2.1 (clause 12.2.3) only; under V4.1.1 it follows from Annex I Section III(d) of the EAA (`EAA-03`). This applies to the project's own channels and, through the deployer kit below, to a deployer's. Keeping at least one text-based channel available is a *(product decision)* about how to meet it.

### Information a Deployer Must Be Able to Publish

A service provider under the EAA prepares information on how its service meets the accessibility requirements, keeps the service conformant as it changes, and can demonstrate conformity on request (Article 13 and Annex V). A public sector body under the WAD publishes an accessibility statement with a feedback mechanism (Article 7). The EAA itself does not require a feedback mechanism or a document called an accessibility statement. The product cannot meet these obligations for a deployer, but a deployer cannot meet them without the product. The product therefore ships a deployer kit:

| Capability | Acceptance |
|---|---|
| Accessibility information page (`EAA-01`, `WAD-01`) | A content page of the same kind as the existing privacy and terms pages, with places for what Annex V requires: a general description of the service in accessible formats, the explanations needed to understand how it operates, a description of how the requirements of Annex I are met, and information showing that the delivery process and its monitoring ensure compliance. For a public sector body it follows the Commission's model accessibility statement: the parts that are not accessible and why, with alternatives; a description of and link to the feedback mechanism; a link to the enforcement procedure; and regular updates. The product pre-fills the technical part from the latest conformance report, or from the known limitations in the remediation ledger until a report exists; the deployer owns the content. The kit's guidance tells the deployer what the product cannot do for it: Annex V places this information in the general terms and conditions or an equivalent document, and Article 13(2) requires it in written and oral format and for as long as the service operates. |
| Link to the page | Linking the page from the backoffice footer, the portal footer, the pay page, and public pages, with the same text and position, is a *(product decision)*; SC 3.2.6 then requires that position to be consistent. |
| Feedback route (`WAD-01`) | Required of public sector bodies, which must also answer within a reasonable period. The page leads to a contact route that reaches a recipient the deployer configures; the route is accessible. Offering the same route to every deployer, and without an account, is a *(product decision)*. |
| Support information (`EAA-03`) | Where a deployer has support services, they give information on the accessibility of the service and its compatibility with assistive technologies in accessible modes of communication. The product supplies that information through the page above and the documentation. |
| Accessibility information about goods and services sold (`EAA-04`) | Required when the responsible economic operator provides the information. The catalog can then hold it for an offer, and the customer-facing surfaces the product delivers show it as text wherever they present the offer. Holding it per locale, exposing it through the API to sales channels, and mapping it in imports are *(product decisions)* that follow from how the product delivers offers. |
| Service information (`EAA-02`) | Information about how the service works that the product generates, such as confirmations, account messages, push notification text, and help texts, is available through more than one sensory channel, understandable, and perceivable; in practice it is text that meets the same requirements as the interface and never relies on an image or colour alone. Information about the accessibility of products used to provide the service is the deployer's to add. |
| Products used to provide the service (`EAA-09`) | Terminals or devices a deployer operates as part of the service fall under Section I of Annex I. The product ships none; the kit's guidance names the obligation. |
| Continuity (`EAA-07`) | The upgrade notes of each release list accessibility-relevant changes and changes to the standards mapping. |
| Evidence (`EAA-08`) | The release conformance report and the list of known limitations give a deployer what it needs to inform an authority about a non-conformity and to answer a request for evidence. |

## Internationalization

Accessible names, error descriptions, skip links, sorting status, and announcements are user-facing: use i18n keys and `useT`/`resolveTranslations`. Minimum regression coverage includes PL/EN, longest DE/ES strings, and KO layouts; final evaluation covers every delivered locale. Page/content language metadata must match the content. Keep personal data out of global announcements. Storybook uses real application dictionaries rather than test-only aria-labels designed to make a scanner pass.

## Integration Test Coverage

| ID | Surface / path | Interactions and states | Evidence |
|---|---|---|---|
| A11Y-AUTH | Login, reset, MFA/SSO/re-auth when active; passkey with its non-biometric alternative | Tab, paste/autofill, invalid credentials, timeout, redirect | E2E + NVDA/VoiceOver; no account disclosure |
| A11Y-SHELL | Backend and portal chrome | Skip link, mobile sidebar, Cmd+K, scope switch, dropdown | Focus/Escape/return, reflow, reader landmarks |
| A11Y-CRUD | Customers reference + every distinct host | Create/edit/delete, custom fields, sections, errors, 409 conflict | Field relationships, focus, announcements, data round-trip |
| A11Y-TABLE | Backend/portal lists | Filters, sort, pagination, select/bulk, empty/loading/error | Keyboard, data relationships, results without focus theft |
| A11Y-DIALOG | Modal, confirm, drawer, nested popups | Open/cancel/submit/retry, removed trigger | Focus lifecycle; one submit and preserved guards |
| A11Y-SALES | Quotes/orders/payments | Line items, financial confirmations, validation | E2E and reader; verify mutation effects |
| A11Y-PORTAL | Login, dashboard, profile, list/detail | Public/authenticated, viewer/buyer, no permission | Actual ACL, every access variant |
| A11Y-CHECKOUT | Pay page and active provider flows; public quote acceptance | Amount, terms, retry, pending/success/failure; review and confirm before commitment; language of provider fields | Complete path; provider sandbox without live payments |
| A11Y-COMPLEX | Kanban, scheduler, workflow/canvas, editor | Reorder, date/time selection, text, upload | Keyboard + single pointer; equivalent data |
| A11Y-LIVE | Notifications, AI/chat, progress, conflict | Updates, errors, completion, streaming | Reader speech transcript/manual evidence; no announcement flooding |
| A11Y-THEME | Default light/dark + supported custom themes | Actual controls and portaled states | Pair measurements, zoom, spacing, high contrast |
| A11Y-EXT | Injected fields/actions/replacements | Slots, custom labels, order, errors | Host composition, UMES preserved |
| A11Y-PREF | Every shell in forced colors, at 200% text and 400% zoom, with an enlarged default font, a user font, and the system colour scheme; documented accessibility controls; toggles; shortcuts | Focus, selection, and state visibility; no blocked scaling; each documented feature reachable by keyboard and reader; toggle state exposed; every key combination has a single-action path | Browser emulation and measurement; screenshots per mode; reader for toggle state |
| A11Y-TIME | Session expiry, code expiry, self-dismissing messages, polled and streamed surfaces | Warning and extension, message persistence, pause | Browser + reader; each time limit listed in the manifest |
| A11Y-AUTHOR | Editors, media manager, template and branding forms, custom field definitions, imports | Insert image, table, link, heading; sanitize, import, and export round trip | The produced content inspected in the surface that shows it; reader |
| A11Y-DOC | Generated PDF, DOCX, XLSX, data exports, every e-mail template and push text | Each generator and template in every delivered locale | Document checker named in evidence + reader; mail client matrix |
| A11Y-INFO | Accessibility information page, feedback route, offer accessibility information, documentation site, the project's support channels | Publish, link presence in every shell, submit feedback, obtain accessibility information from support | Browser + reader; manual record for support |

This table defines test families; it does not claim they have been written or run. Each implementation PR assigns concrete routes/API paths, fixtures, case IDs, expected results, and teardown in its file manifest. Every affected API path receives an existing or new regression test; changed form UI must still save/read correct data. Integration tests ship with the fix in the module's `__integration__`; shared UI tests belong in `packages/ui`.

Create fixtures per test through API helpers and remove them in finally/teardown, without demo-data dependencies. Select role/state combinations by risk while recording unevaluated combinations. Automated coverage uses Chromium and relevant Firefox/WebKit regressions. Manual coverage uses NVDA with Firefox/Chrome on Windows, VoiceOver with Safari on macOS/iOS, and TalkBack with Chrome for critical mobile processes. Pin versions/settings in evidence. An unavailable device/reader means unevaluated scope, not pass. Participation by people with disabilities is planned as an additional check of real processes.

### Sampling, Evidence Freshness, and Aggregation

Baseline evaluation selects every distinct interaction/layout type, each critical process end to end, relevant roles/editions, and supported configuration versions. Equivalence between similar hosts must identify shared implementation, semantic DOM, keyboard/focus/async behavior, and props/content/permission differences; a shared component import alone is insufficient. A host differing in any of these receives its own evaluation. Any finding expands the audit to potentially affected consumers and states.

The QA lead approves justified equivalence groups and required retests. Sampling starts evaluation; it does not automatically transfer passes to untested scope. Final evaluation covers every required manifest tuple through direct evidence or approved explicit equivalence reasoning. Known defects cannot be replaced by that reasoning.

Roll-up: any applicable fail means fail. Without failures, any missing/unverified/stale required check means not_evaluated. Pass requires every required check to pass or have justified N/A. Whole-surface N/A requires all relevant criteria to be genuinely inapplicable. Do not average results or severity. Product completeness means closing required scope and meeting conformance conditions, not filling 55 cells.

Every evidence item is pinned to a snapshot containing commit, build, and dirty digest. Code/theme/locale/dependency or configuration changes invalidate affected evidence until retest or explicit reviewer confirmation of unchanged relevance. Merge/rebase requires binding evidence to the resulting snapshot. A new finding reopens previously closed checks according to the impact graph.

### Conformance Requirements and Reporting

The five WCAG conformance requirements, which EN 301 549 repeats as clause 9.6 (`ENS-12`), are evaluated as requirements with their own ledger records. Passing the 55 criteria on sampled pages does not satisfy them.

| Requirement | What the program has to show |
|---|---|
| 1. Conformance level | Every A and AA criterion is met on the page, or a conforming alternate version exists. WCAG defines such a version: it conforms at the level, has the same information and functionality in the same language, is as up to date, and either can be reached from the non-conforming page through an accessibility-supported mechanism, or the non-conforming version can only be reached from the conforming one, or only from a conforming page that also offers a way to the conforming version. EN 301 549 V4.1.1 clause 14.3 (`ENS-23`) adds for any alternative mode that it provides all the same information and functionality, can be reached through a path that fully meets the requirements, and is the default mode for safety and security requirements (three flashes) and, where a failure could stop a user from choosing the accessible mode, for the assistive-technology non-interference requirements (no keyboard trap; pause, stop, hide; activation of accessibility features). No alternate versions are planned; proposing one needs product-owner approval and its own ledger records. |
| 2. Full pages | No part of a page is excluded. Injected widgets, replacement components, notice bars, and third-party embeds (payment fields, maps) are part of the page. EN 301 549 V4.1.1 clause 14.1 notes that when a site incorporates an add-on or overlay, the addition becomes part of the product and the combination is what is evaluated. An overlay therefore cannot be left out of an evaluation. This program also does not accept an overlay as the means of meeting a requirement *(product decision)*. |
| 3. Complete processes | Every page of a process conforms; see the sampling rules above. An external step is part of the process. |
| 4. Accessibility-supported technologies | The manifest declares an accessibility-support baseline: the web technologies relied upon (HTML, CSS, WAI-ARIA, JavaScript) and the browser and assistive-technology combinations, with minimum versions, in which they are relied upon. W3C does not define how much support is enough, so the rule is a *(product decision)*: a technique counts only if it works in every combination of the approved baseline. The combinations listed under Integration Test Coverage are the starting point; the accessibility/QA lead approves the list. |
| 5. Non-interference | Criteria 1.4.2, 2.1.2, 2.2.2, and 2.3.1 apply to all content on a page, including content that is not relied upon and third-party embeds, and the page continues to meet the conformance requirements when a technology that is not relied upon is turned on, turned off, or not supported by the user agent. |

**Reports.** Phase 5 produces the first accessibility conformance report, and every later release in the declared scope produces one. It is generated from the ledger: scope and snapshot, the result for every WCAG 2.2 A and AA criterion and every applicable supplement row, presented per clause, the evaluation methods, and the open findings with their impact and planned fix. Before the first report exists, the remediation ledger's list of known limitations is what the documentation and the deployer kit publish. Use a recognised template that covers both WCAG 2.2 and EN 301 549 so that deployers and procurement can read it without translation. The report is the product's input to a deployer's own statement; it is not a statement about any deployment.

A public conformance claim, if the product owner decides to make one, contains the components WCAG requires: date, guideline title, version and URI, level, the pages and processes covered, and the technologies relied upon. WCAG allows a statement of partial conformance only for third-party content outside the author's control and for languages without accessibility support; known defects in the product's own code are reported as non-conformities, not as partial conformance.

## Implementation Plan — Phases

| Phase | Deliverable | Completion condition |
|---|---|---|
| 0. Base and inventory | Selected commit, surfaces/modules/configurations, owners | No implicit exclusions; base commit agreed |
| 1. Baseline | Audit representative pages, complete processes, and distinct states | All 55 criteria and every applicable supplement row considered; every failure has reproduction/owner |
| 2. Shared layer | Small PRs for fields, focus, tables, overlays, messages, and tokens | Fix and consumer tests; no public-contract regressions |
| 3. Core processes | Auth, CRUD, sales, portal, checkout | Complete processes usable by keyboard and screen reader |
| 4. Remaining surfaces | Enterprise/official modules, complex widgets, media, extensions | Every configuration in declared scope evaluated |
| 5. Final evaluation | Repeat audit; first conformance report with scope, results, and remaining limitations | Every applicable A/AA criterion and supplement requirement passes, the five conformance requirements are met, and the dependent specifications below are implemented or their rows are reported as open non-conformities |

The supplement follows the same phases. Phase 0 records the standards baseline, the accessibility-support baseline, and an applicability decision for every supplement row. Phase 1 evaluates the applicable rows next to the criteria, starting from the source observations. Phase 2 includes the user-preference, time-limit, and preservation fixes in shared code. Phase 3 includes the messages and documents that belong to the core processes. Phase 4 includes the dependent specifications below.

### Dependent Specifications

The requirements above define a target. Some of it is met by fixing existing code under this program; the rest needs capabilities the product does not have, and each of those is a separate, independently deployable specification that this document depends on and does not replace. None exists yet.

| Capability | Requirements it serves | Needs |
|---|---|---|
| Text alternatives for media | `ENS-16`, SC 1.1.1 | Stored alternative on attachments, a form to edit it, every renderer and API response to use it |
| Editor guidance and preservation | `ENS-16`, `ENS-17`, `ENS-03` | Image and table dialogs, sanitizer and importer allow-lists (with security review) |
| Accessible messages and documents | `ENS-14`, `ENS-03` | Language and recipient locale for e-mail, a plain-text part that keeps links, tagged and titled PDF, DOCX image descriptions |
| User settings for shortcuts and time limits | SC 2.1.4, SC 2.2.1, `ENS-01` | A setting to turn single-key shortcuts off, a warning and extension before session expiry, messages that stay until dismissed |
| Accessibility information page and feedback route | `EAA-01`, `EAA-03`, `WAD-01` | A content page, its links in each shell, a configurable feedback recipient |
| Accessibility information on offers | `EAA-04` | A catalog field, its API exposure, its display on customer-facing surfaces |
| Conforming-template marker | `ENS-19` | A way to identify a template as conforming where it is picked |
| Documentation accessibility page | `ENS-20`, `ENS-21` | A page on the documentation site and a link from the product |

Phase 5 can report a row as an open non-conformity when its capability has not shipped; it cannot report the row as passing.

Entry conditions: baseline follows an approved manifest and available configurations; shared fixes follow assignment of reproducible findings/module owners; processes require a stable test build; final evaluation follows ledger closure and affected-scope retests. The QA lead accepts phases 1–4; the product owner and QA lead accept phase 5. Unavailable tools/configurations remain explicit limitations preventing evaluation of the relevant required scope.

Guardian and Storybook capabilities are deployed independently through companion specifications. They can begin protecting new changes before all remediation finishes, without establishing whole-application conformance. Set timing/estimates after baseline rather than inventing a completion date before the number of violations is known.

Remediation priority: inability to log in/purchase/save, focus traps, and inaccessible modals are highest; missing names/relationships/errors and inaccessible primary actions are high; other confirmed A/AA violations require fixes according to human impact. Criterion level does not determine severity. A/AA defects are not cosmetic merely because axe does not classify them critical.

### Governance and Continuity

Conformance is lost by ordinary changes unless someone owns keeping it. Phase 0 assigns each item below to a named person.

- **Competence.** Evaluators know the criteria and the test methods; `manual_at` evidence comes from someone proficient with the screen reader used. Design handoffs state names, roles, focus order, and states for new components, so the contract exists before code.
- **Third-party intake.** A dependency or provider that renders user-facing UI is adopted only with accessibility evidence: the supplier's conformance report or the project's own evaluation of the integrated result. Existing ones are evaluated in place, including the payment element, the map, the editors, the chart library, the calendar, the command palette, and the flow canvas.
- **Feedback intake.** Barrier reports from users, deployers, and the issue tracker reach the accessibility/QA lead, are classified by human impact, and enter the remediation ledger. The product owner sets the response deadline in phase 0.
- **Release cadence.** Every release in scope updates the manifest, re-tests what its changes affect, and publishes the conformance report and known limitations with the upgrade notes.
- **Standards watch.** As defined under Version Policy.

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

### Product conformance is mistaken for service conformance

- **Scenario**: A deployer publishes the product's conformance report as its own statement although its content, theme, or extensions fail.
- **Severity**: High
- **Affected area**: Deployments and legal exposure of deployers
- **Mitigation**: The report states its scope and the deployer's remaining responsibilities; the information page separates product facts from deployer content.
- **Residual risk**: The project cannot verify a deployment.

### Authoring surface produces inaccessible customer-facing content

- **Scenario**: Staff insert images without alternative text or tables without headers, and the portal, e-mails, or a sales channel show them to customers.
- **Severity**: High
- **Affected area**: Catalog, content, messages, documents
- **Mitigation**: Enable, guide, preserve, and repair requirements with tests on the produced content.
- **Residual risk**: Authors can still write poor alternatives; guidance cannot judge meaning.

### Generated document or e-mail is unreadable with assistive technology

- **Scenario**: An order confirmation, a verification code, or an exported document has no language, structure, or usable plain-text part.
- **Severity**: High
- **Affected area**: Messages and documents in complete processes
- **Mitigation**: Templates and generators are in the manifest with their own evidence; conversion keeps accessibility information.
- **Residual risk**: Mail clients and document readers differ; the matrix covers the declared baseline only.

### Standard version changes invalidate the mapping

- **Scenario**: EN 301 549 V4.1.1 is cited in the Official Journal, or WCAG changes, and requirement numbers or wording no longer match the evidence.
- **Severity**: Medium
- **Affected area**: Supplement index, reports, deployer statements
- **Mitigation**: Stable identifiers with both clause numberings and a standards watch at every release.
- **Residual risk**: A later revision can add requirements that need new work.

### Sanitizer change for accessibility weakens security

- **Scenario**: Allowing more attributes so that accessibility information survives lets through markup that executes script.
- **Severity**: High
- **Affected area**: Rich-text storage and rendering
- **Mitigation**: Only inert attributes and elements are added; security review and the existing sanitizer tests gate the change.
- **Residual risk**: Future allow-list edits need the same review.

DB atomicity, cache invalidation, and new commands/events are N/A for this document because it introduces no business operations; the dependent specifications assess them for the capabilities they add. Regression evaluation of existing mutations covers interruption, retry, and version conflicts; their guards/undo remain unchanged.

## Final Compliance Report — 2026-10-04

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
| root AGENTS.md | Tenant/RBAC/encryption/optimistic locking | Preservation required | No new storage in this document; the dependent specifications that add fields carry their own tenant, encryption, and locking review. Existing-process regression coverage |
| .ai/qa/AGENTS.md | Same-PR integration coverage | Required before implementation merge | Test families defined; concrete file/API manifests required per phase |
| Frontend architecture contract | Boundaries and performance evidence | Required before implementation merge | Zero runtime audit tooling; client/bundle ledger |
| Product accessibility contract | Complete WCAG evaluation | Not evaluated | No evaluation records exist; the ledger template is empty |
| EN 301 549 and directive supplement | Every applicable requirement outside the 55 criteria is indexed, scoped, and has an acceptance contract | Compliant in design; not evaluated | 48 rows indexed with both clause numberings; applicability decisions and evidence are phase 0 and phase 1 work. Source observations are hypotheses, not results |
| Normative basis | Requirements trace to a published source and version | Compliant after review | Standards and directive texts read on 2026-10-04 and re-checked by an independent review; sentences that go beyond a clause are marked as product decisions, and three readings await confirmation (Q2). Legal applicability per deployment is out of scope |
| Version/evidence contract | Identified current implementation basis | Partially established | Main/develop sources compared on 2026-10-02; execution base and runtime audit pending |
| Existing Skills Tiers Lint / Guardian contract | Registered skill and reliable verdict | Non-compliant prototype | Registered in the opt-in `analysis` tier; false-green gaps R2–R5 remain; see readiness report |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | QA artifacts only in this document; entities and endpoints for new capabilities are deferred to the dependent specifications |
| API contracts match UI/UX | Pass in design | Existing responses/guards preserved; actual flow evidence pending |
| Risks cover write operations | Pass in design | Existing mutation interruption/retry/conflict regressions; no new operations |
| Commands defined for mutations | N/A for new commands | Existing command/guard/undo behavior preserved |
| Cache strategy covers read APIs | N/A for new APIs | No new read API/cache layer |
| Scope and evaluation semantics agree | Pass after review | Manifest, perimeter, sample/roll-up, evaluation ledger, acceptance roles, and retests clarified |
| Related work and issues are linked | Pass for inspected snapshots | Existing owners and 22 issues; refresh before each implementation PR |
| Evidence establishes current product conformance | Not evaluated | No product/runtime/AT audit executed |
| Supplement rows match acceptance contracts and test families | Pass | Every `ENS-*`, `EAA-*`, and `WAD-*` row is referenced by a contract and covered by a test family, a release deliverable, or an explicit not-applicable rule |
| Data Models section matches the new requirements | Pass | The capabilities that need stored data or configuration are listed under Dependent Specifications |
| Scope cohesion after the extension | Open | An independent review found a split signal: the new requirements imply eight separately deployable capabilities. They are deferred to dependent specifications; the maintainer decides Q1 |

### Non-Compliant Items

- **Rule**: The Guardian report can assess every requirement in the target.
  **Source**: This specification and the Guardian contract.
  **Gap**: The report validator accepts only WCAG success criterion numbers, so supplement requirements cannot be reported as assessments (readiness finding R10).
  **Recommendation**: Extend the report contract to supplement identifiers before G2; until then they are evaluated in the product ledger only.
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
- 2026-10-04 — Added the normative basis (WCAG 2.2, EN 301 549 V3.2.1 and V4.1.1, Directive (EU) 2019/882, Directive (EU) 2016/2102) and the requirements outside the 55 criteria: user preferences, authoring capability, generated documents and e-mail, media and real-time communication triggers, documentation and support, and the information a deployer must be able to publish. Added the supplement index, the conformance requirements and reporting rules, contracts for criteria that had none (timing, predictability, error prevention, input purpose, language of parts), source observations as evaluation leads, five test families, governance, and five risks. Forced-colors support moved from a product recommendation to a requirement. No product change is approved by this revision.
- Review 2026-10-04 — Independent fresh-context review of the extension against the standard and directive texts. Corrected eighteen statements that misread or narrowed a source, among them the overlay note, the accessibility-supported rule, SC 3.2.1, the basis for e-mail, the feedback mechanism (WAD only), and the scope of the EAA rows (consumer-facing steps). Added 16 supplement rows: the eleven functional performance criteria that V4.1.1 made requirements, Parsing under V3.2.1, caller ID and alternatives to voice services, the product-type clauses, and Annex I Section III(a). Added acceptance for SC 1.1.1, 1.3.2, 2.4.6, 2.5.1, and 2.5.2. Marked every sentence that goes beyond its clause as a product decision, moved survey facts out of normative text, listed eight dependent specifications, and opened Q1 (scope split) and Q2 (three readings).
