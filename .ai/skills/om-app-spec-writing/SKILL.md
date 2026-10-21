> **Repo-local override.** Supplies Open Mercato's capability catalog sources, license tier, and enterprise App Spec location to the base skill's context, initialize, and Phase 3 steps.

## Step 1 — platform knowledge: catalog sources and license tiers (add)

In this repository the platform the app builds on is Open Mercato itself. Build the catalog from these files; the root `AGENTS.md` Task Router is the index (`core` = `packages/core/AGENTS.md`, `ui` = `packages/ui/AGENTS.md`, `core:<module>` = `packages/core/src/modules/<module>/AGENTS.md`, `ui:backend` = `packages/ui/src/backend/AGENTS.md`; `→ X` names the heading to read).

| Catalog kind | Source |
|---|---|
| capability / module | `core:<module>` for every module the app touches (e.g. `customers`, `sales`, `catalog`, `workflows`, `integrations`); `.ai/docs/official-modules.md` plus `external/official-modules/` when that submodule is present |
| extension point | `core` → Widget Injection, API Interceptors, Response Enrichers, Component Replacement, Custom Fields, Extensions, Cross-Module Coupling |
| identity & access primitive | `core` → Access Control (RBAC) (features in `acl.ts`); `core:auth` (staff users and roles); `core:customer_accounts` (customer-portal identities) |
| surface (internal / external) | internal = the backend admin (`ui:backend`); external = the customer portal (`ui` → Portal Extension, `core:customer_accounts`) |
| UI building block | `ui` → CrudForm Guidelines, DataTable Guidelines; `.ai/ui-backend-components.md` (check it before proposing any new component family) |
| workflow / notification primitive | `core:workflows`; `core` → Events, Notifications; `packages/queue/AGENTS.md`; `core:progress` |
| seed / init command | `core` → Module Setup Convention (`setup.ts` defaults and examples); `packages/onboarding/AGENTS.md` (tenant setup hooks); `yarn initialize` |

The §2 decision tree maps directly: internal personas are staff users on the backend, external personas are customer accounts on the portal.

### License tiers

| Path prefix | Tier |
|---|---|
| `packages/enterprise/` | enterprise |

Everything outside that prefix is the open-source tier. An enterprise-tier capability needs a commercial license (`packages/enterprise/LICENSE.md`), so the Phase 4 business case must carry it as a cost.

## Step 2 — initialize: App Spec location (add)

- An App Spec for an open-source scope goes in `.ai/specs/` (the configured `paths.specs`).
- An App Spec whose scope depends on enterprise-tier capabilities, or describes a commercial offering, goes in `.ai/specs/enterprise/`: use that directory as `SPECS_DIR` for the whole run (notes, catalog, and briefs land beside it). Ask when the scope is unclear.
- Follow `.ai/specs/AGENTS.md` for naming and changelog rules; never use a `SPEC-*` filename prefix.

## Phase 3 — map to platform: grounding (add)

`platform.repo` is not set in `.ai/agentic.config.json`, so Phase 3 rows default to `docs-only`. When the user wants a decisive mapping grounded, run `om-gap-analysis` in single-capability mode: its repo-local override supplies the Open Mercato platform profile. Record the verdict line in the row's Notes.
