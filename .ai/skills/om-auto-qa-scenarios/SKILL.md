> **Repo-local override.** Adds Open Mercato's QA area vocabulary, path-to-area map, route-resolution conventions, label-inference source, and report coexistence with the `TC-*` scenario files to the base `om-auto-qa-scenarios` skill.

## Step 4 — route knowledge (add)

Resolve where-to-click from the module routing conventions (`packages/core/AGENTS.md` → Auto-Discovery / Portal Pages / Page Metadata; `.ai/docs/module-development.md`):

- Backend pages: `<module>/backend/<path>/page.tsx` → `/backend/<path>`; `backend/page.tsx` → `/backend/<module>`. Use the sibling `page.meta.ts` for the menu label and required features (the role a tester needs).
- Storefront / public pages: `<module>/frontend/<path>.tsx` → `/<path>`.
- Customer portal: `<module>/frontend/[orgSlug]/portal/<path>/page.tsx` → `/{orgSlug}/portal/<path>`; `requireCustomerFeatures` in `page.meta.ts` names the customer-role feature to grant.
- API-only changes: the module's `api/` files map to `/api/...` per Auto-Discovery; take the exact path and method from the route's `openApi` export (an API client call is the route).
- Widgets injected into other pages: name the host page and the injection spot, not the widget file.

## Step 5 — areas and priorities (add)

Name areas the way the product does. Preferred area names, from the merged-PR history of this repo:

- Auth, Access Control, Sessions, Organization / Tenant Scope
- Sales, Checkout, Quotes, Orders, Payments, Shipments
- Workflows, Webhooks, Events, Notifications, Scheduler, Queue
- Customers, Customer Accounts, Custom Fields, Business Rules
- Catalog, Attachments, Shared Backend UI, Visual Regressions
- No direct manual QA — broad smoke only (docs, tooling, tests, CI, DX)

Path → area hints (refine from titles; the root `AGENTS.md` Task Router stays the first lookup):

| Changed path | Area |
|---|---|
| `packages/core/src/modules/{auth,directory,api_keys,feature_toggles,audit_logs}/` | Auth / Access Control / Organization Scope |
| `packages/core/src/modules/{sales,currencies,payment_gateways,shipping_carriers}/`, `packages/checkout/`, `packages/gateway-*/` | Sales / Checkout / Payments |
| `packages/core/src/modules/workflows/`, `packages/{events,queue,scheduler,webhooks}/`, `packages/core/src/modules/notifications/` | Workflows / Events / Webhooks / Queue |
| `packages/core/src/modules/{customers,customer_accounts,customer_groups,entities,business_rules,portal}/` | Customers / Custom Fields / Portal |
| `packages/core/src/modules/{catalog,attachments}/`, `packages/ui/` | Catalog / Attachments / Shared Backend UI |
| `packages/enterprise/` | the base area the overlay extends, flagged "enterprise" |
| `packages/create-app/`, `apps/docs/`, `.ai/`, `scripts/`, `.github/` | broad smoke only |

Priority and risk inference for PRs without a `priority-*` / `risk-*` label: [`.ai/docs/pr-workflow.md`](../../docs/pr-workflow.md) → Priority / Risk. The same file defines the `needs-qa` / `qa-approved` / `qa-self-verified` gate and the self-QA exception that the appendix QA-state column reflects.

## Step 6 — route content (add)

Open Mercato cross-cutting checks, added where the area's changes make them relevant:

- Organization and tenant isolation — a second organization must not see or edit the record; superadmin vs admin vs employee role differences.
- Optimistic locking on edit/delete forms — two tabs editing the same record surface the conflict bar, not a silent overwrite.
- Custom fields on the touched entity — create, edit, filter, and list rendering.
- i18n — untranslated keys or a feature that only works in one locale.
- Enterprise overlays — behaviour with and without the `packages/enterprise` module enabled.
- UI surfaces built from Next.js routes and Client Islands — the perceived-performance checks apply to the changed routes.

## Step 7 — artifacts next to `TC-*` scenarios (add)

`<paths.qa>/scenarios/` (= `.ai/qa/scenarios/`) already holds the optional markdown test cases `TC-{CATEGORY}-{NNN}-{slug}.md` consumed by `om-integration-tests` (see `.ai/qa/AGENTS.md` → "How to Manage Scenarios").

- Window reports keep the `qa-scenarios-<date>` (or `--slug`) naming. Never give a report a `TC-*` name, never number it in a TC category, and never convert it into a `.spec.ts`.
- Executable tests are not this skill's output: they live in module-local `__integration__/` directories and are written by `om-integration-tests`, never under `.ai/qa/tests/` (that folder holds only the Playwright config).
- When a route maps to an existing `TC-*.md` scenario or `__integration__/TC-*.spec.ts`, cite its path in "What human QA should verify" so testers can reuse it.
