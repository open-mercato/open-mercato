# Finance accountant prototype — specification coverage

## TLDR

Extend the existing `finance_previews` module from the linked specification index in [issue 6061](https://github.com/open-mercato/open-mercato/issues/6061). Deliver a traceable gap map and accountant click-through workflows with validation, persistent document identity, calculated outcomes, and recovery paths. Screen count is not specification acceptance.

## Scope and architecture

This is the existing authenticated browser prototype, not implementation of the proposed production modules. Keep the `finance_previews.view` feature, route, and existing 43 screen IDs. Add domain-specific client leaves using the existing `DataTable`, `CrudForm`, buttons, status adapter, and navigation. Session-local fictional fixtures are the only write target. No database migrations, production integrations, new dependencies, or shared primitive contracts change.

New workflow components own versioned, validated session state; each family has explicit restart keys in the scenario launcher. State-changing actions must validate before saving, preserve source references, and prevent repeated posting. Reloading and navigating away must not silently discard confirmed outcomes. Dates and amounts are scenario data, not live rates or legal tax calculations.

## Plan

1. Read the current PR-head specifications linked by issue 6061; record source revision, phase, dependencies, conflicts, and actual UI scope.
2. Map requirements to existing screens, fields, actions, state transitions, failure paths, and tests. Separate backend-only and deferred requirements from missing UI.
3. Add missing ledger/contractor, operational, and tax/reporting workflows. Correct existing behaviors that contradict the detailed specs.
4. Integrate every new screen into domain navigation and task launcher, including contextual shortcuts from related existing screens.
5. Verify calculations and invalid/repeated actions, then run browser scenarios, reload/restart, visual and clipping checks. Build and leave the correct local runtime available.

## Visual contract

Figma file `qCq9z6q1if0mpoRstV5OEA`, invoice frame `200618:12071`, header `200618:12298`, and compact table `200660:13282` provide the inspected design vocabulary. Preserve the existing dashboard reference `200524:1401`. Use neutral stroke statuses with semantic icons, consistent 36px action controls, readable section spacing, table separators, numeric alignment, and restrained color. New flows without a Figma frame compose these established patterns; they are not claimed as exact matches to nonexistent frames.

## Data and API contracts

The contribution adds the authenticated `/backend/finance-preview` page and the additive `finance_previews.view` ACL feature with an admin setup grant. No new HTTP API contracts. Browser simulation state is versioned and separate from real application entities. Exported sample reports must identify their demonstration nature and must not masquerade as signed legal filings or official UPO. Real posting, provider verification, KSeF, tax transport, and bank execution remain outside the prototype runtime.

## Migration and backward compatibility

Existing platform contracts remain unchanged. The new module adds standard discovery metadata, a guarded backend page and one ACL feature; it does not rename or remove any existing contract. Generated registries are regenerated through the standard command. New screen fragments are additive. Existing scenario storage is read defensively; new optional fields must have defaults. No generated files are edited manually.

## Verification contract

Existing six journeys remain regression gates. New browser tests cover starter chart import and duplicate prevention; posting-rule reconciliation and period close blocking; contractor checks and approval; trial-balance drill-down; asset/depreciation; prepaid/deferred schedules; FX revaluation/reversal; bank allocation; tax calculation/post/payment; KSeF duplicate handling; nonblocking VAT reconciliation; JPK validation/export; annual-statement validation/export. No tests send real financial actions.

## Risks and unresolved requirements

- WMS posting and inter-warehouse transfers are listed in issue 6061 without a detailed spec. Record them as unresolved design scope rather than asserting production semantics.
- Current PRs contain phase boundaries and some conflicting contracts. The coverage map must state these conflicts rather than invent resolution.
- Backend-only requirements, concurrency/RBAC enforcement, actual tax validation, and external delivery cannot be accepted through browser simulation.

## Implementation status

Source audit and the implemented prototype expansion are delivered in the [coverage report](analysis/2026-10-15-finance-prototype-gap-map.md) and module README. There are 57 views and 18 guided tasks. Before publication, 33 distinct Playwright cases and two production-build smoke cases passed in the original development checkout, together with scoped lint, app typecheck and build. These historical results do not validate the publication branch; fresh-develop verification is tracked in the publication plan.

Fresh-develop verification subsequently passed the ordered repository gate (including all 48 unit-test tasks and the production app build), 54 focused prototype unit tests, template parity and the final 36-case isolated browser suite with no skipped or flaky cases. The verification fixes remain local: the author requires approval before any further push or PR update. The local template checker correction also requires explicit governance review before publication.

The prototype remains partial against the full set of production specifications. The report explicitly tracks disconnected contractor/KSeF/AP families, controlled report fixtures, full mapping/CRUD extensions, later-phase work, WMS without a spec, and unresolved domain contracts. This document stays outside `implemented/`; no production module acceptance or deployment is claimed.

## Changelog

- 2026-10-15: Started source-driven prototype expansion and accountant workflow verification.

- 2026-10-15: Added s44–s57, source and gap map, ledger/contractor/operations/tax/report workflows, AP posting and dated payment verification, shared batch-to-bank continuity, asset lifecycle, local form styling/locale adapter, and regression/layout evidence.
- 2026-10-15: Verified on fresh develop; fixed same-origin locale recovery, ACL catalog coverage and template compatibility, added persistence/locale regression coverage, and recorded the publication approval hold.
- 2026-10-23: Kept the prototype usable when the locale update fails, removed the bank account number from session storage, switched submit buttons to the DS primary variant, and re-ran the complete integration suite.
