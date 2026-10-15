# Finance previews

The app route `/backend/finance-preview` is an authenticated, feature-gated preview of the planned finance module in SPEC-024. It is enabled as an app-specific module to avoid claiming the future `financial` module ID.

- `finance_previews.view` grants read access to the preview. New admin roles receive it by default.
- The 43-screen fixture in `data/screens.json` was extracted from `.ai/prototypes/finance/finance.js`. `data/special-content.json` adds structured examples for key workflows. Both files contain fictional records only.
- Navigation, filters, tables, charts and forms run in the browser. Demonstration actions do not call finance APIs or post ledger entries. Scenario decisions and draft records persist in browser `sessionStorage` until the tab session ends or the scenario is reset.
- Eighteen guided tasks cover the original six workflows plus ledger setup, contractor checks, asset acquisition and lifecycle, prepaid/deferred schedules, FX valuation, bank allocation, tax liability, KSeF, VAT reconciliation, and annual reporting. The 14 added views compose shared DS families. They are accountant click-test paths, not production accounting flows.
- Other screens remain navigable previews of the planned module. A list-row preview shows that row's own values before offering navigation to an illustrative process, so a sample detail page is not presented as the selected record.
- The original standalone design artifact is not a runtime dependency or part of this contribution. Its HTML and CSS are not copied into the app module. The JSON fixtures needed by this module are included here.

## Accountant handoff scope

The prototype has **57 views and 18 guided journeys**. The detailed [specification gap map](../../../../../.ai/specs/analysis/2026-10-15-finance-prototype-gap-map.md) records inspected PR revisions, phases, implemented examples, unresolved source conflicts, and remaining partial flows. Screen count is not a percentage of specification completion.

The prototype preserves local document identity and outcomes, validates inputs, and prevents duplicate operations within its implemented workflows. It does not implement financial posting, data integration, legal filing or permission enforcement. In particular, KSeF drafts and the contractor registry are not yet connected to the full AP workflow, reports use controlled fixtures, and WMS/inter-warehouse semantics have no detailed specification in the supplied index.

After changing module metadata, routes or translations, run `yarn generate`. After enabling the module or changing its sidebar entry, run `yarn mercato configs cache structural --all-tenants` against a reachable local app database. Existing tenants may also need `yarn mercato auth sync-role-acls` to receive the new admin grant.

## Journey continuity and visual checks

The scenario launcher has separate start, resume, and restart actions. Restart clears that workflow family’s session data and remounts its current screen, including when the start screen is already open. Its task list describes actions to perform; it does not jump past prerequisites. Direct screen browsing remains available separately.

| Journey | Verified simulated outcome |
| --- | --- |
| Vendor invoice | The same invoice is checked and posted with expense/VAT/payable accounts, then included in a single-vendor payment batch. Failed dated bank verification blocks progression; sending and subsequent bank matching cannot post the payment twice. |
| Customer payment | Allocation validation rejects excess amounts; only confirmed allocations update invoice balances. |
| Currency invoice | Issuing enables settlement; posting creates a balanced journal preview for the entered rates and updates the remaining currency balance. |
| Bank reconciliation | Import enables reconciliation; posting the 42 PLN correction enables approval. |
| Month-end close | Trial balance, recurring entries, reconciliation, adjustments, and report approval enable period locking. |
| Budget | Submitting requires an explicit director decision; approval updates commitments, rejection preserves them and requires a reason. |

All finance badges use the neutral DS stroke appearance, and feedback uses DS stroke alerts. Browser tests distinguish 57-screen render coverage from complete CTA journeys. No test treats a successful screen jump as a completed accounting task.

### Dashboard and editable previews

The dashboard follows Figma frame `200524:1401`: balance and supporting figures, task queue, shortcuts, paired monthly cashflows, and recent operations. Original decorative SVG assets are stored under `assets/dashboard`. The shared chart uses the application chart palette. Range selection changes the months shown, and recent-operation details retain the selected reference and amount. Dashboard values are fictional and do not aggregate live records.

Generic forms persist submitted drafts per screen in the tab session. Allocation s31 validates both shares and their 100% total before s32 calculates the split of the 84,000 PLN example pool. Direct access to s32 without a valid saved rule offers a return to editing. This is separate from the guided workflow families.

## Review language

The accountant prototype is authored in Polish. Entry selects Polish through the existing `/api/auth/locale` preference endpoint so the application shell and shared controls use the same language as the fixtures. Budget and currency components read the React locale context. A deployment-level forced locale is respected without a redirect loop; a scoped Polish provider keeps the prototype content Polish in that case. No existing English translation catalog is overwritten.

### Status presentation reference

Finance status badges use the mapped `StatusBadge` with a local `FinanceStatusBadge` adapter. Geometry is based on the visible invoice-list instances in [DS Open Mercato](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=200701-226609): 24px height, 6px radius, 4px icon gap, 4px/8px horizontal padding, 12px medium text with 16px line height. Borders and text use shared semantic tokens. Icons preserve the exported SVG paths from Figma instances `200701:226609`, `200701:226613`, `200701:226617` and the `171:5100` status family; color is applied through DS tokens. Status color stays on the icon. Counts and step numbers retain the ordinary Badge primitive.

## Source-driven additions (15 October 2026)

- **s44–s47:** starter chart, fiscal periods, 4 → 5 posting rules, contractor registry and computed trial balance.
- **s48–s52:** acquisition/depreciation and asset lifecycle, proposed prepaid-cost UX, deferred revenue, period-end currency valuation/reversal, and statement matching including partial EUR receipt and PLN overpayment.
- **s53–s57:** tax liabilities, KSeF receipt/duplicate link, informational VAT reconciliation, proposed JPK_KR_PD workflow, annual statements and result allocation.

The local `FinanceCrudForm` adapter preserves shared form validation/submission while applying the existing purple DS primary tokens, Polish dates and stable initial focus. New tables scroll inside their cards on narrow screens. Context links provide navigation between related tasks; the compact scenario dialog holds task instructions.

New tests `TC-FIN-PREVIEW-010` through `014` cover calculated outcomes, refusal and recovery, repeat operations, reload persistence, immutable posted data, and desktop/mobile layout. The complete validation result is recorded in the linked gap map. No new dependencies, API routes, migrations or shared DS contracts are introduced.
