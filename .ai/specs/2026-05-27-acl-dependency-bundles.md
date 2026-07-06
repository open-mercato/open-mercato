# ACL Dependency Bundles

**Date:** 2026-05-27
**Status:** in-implementation (customers module — this PR)
**Source incident:** PR #2073 review comment by @alinadivante
**Owner:** auth / shared / ui platform; per-module rollout owned by each module maintainer

## 1. Problem

The bug fixed by PR #2073 (`fix(auth): break 403 redirect loop on staff login`) closed an *acute* failure mode: when an employee role had enough features to load a page but not enough to satisfy that page's secondary API calls, the UI fell into a redirect/login loop. The loop is gone — but the *underlying* misconfiguration is still trivial to create.

@alinadivante captured it in their re-review:

> An employee may have `sales.orders.view` but not `sales.channels.manage` or `sales.settings.manage`. The main Orders page becomes accessible, dependent widgets/requests fail with 403, and the UI degrades into toast spam.
>
> It may be worth defining clearer "minimum required permission bundles" for complex modules like Sales Orders. … Consider feature dependency mapping for composite pages.

This is a **silent partial-access UX problem**. The system cannot prevent it because feature dependencies are not declared anywhere — they live as undocumented assumptions in page code.

## 2. Goals

1. Let every feature declare which other features it **depends on**. A dependency means: "if a role/user has this feature, they will reasonably expect that feature to work, which requires the listed features too."
2. At role-edit / user-edit time, surface **diagnostics** when:
   - A feature is granted whose declared dependencies are NOT in the effective granted set (wildcard-aware).
   - A feature is being removed but other still-granted features declare it as a dependency (orphaning).
3. Make the diagnostics **actionable** — one click to add the missing dep or remove the orphaned dependents.
4. Keep the dependency declaration **local to each module's `acl.ts`** so module owners curate their own bundles. No central dependency registry to drift.
5. Keep the runtime semantics **unchanged**. RBAC checks (`hasFeature`, `userHasAllFeatures`, wildcards) behave exactly as today. This spec only adds *advisory* metadata + an editor warning surface.

## 3. Non-goals

- **No server-side enforcement.** Saving a role/user ACL that violates dependencies still succeeds. Enforcement (auto-inherit, hard-reject, dual-mode) is intentionally deferred — see §11 Open Questions.
- **No DB schema changes.** `dependsOn` lives in code, next to each feature descriptor.
- **No changes to `hasFeature` / wildcard semantics.**
- **No changes to `setup.ts` `defaultRoleFeatures`.** Default seeding is orthogonal.
- **No customer portal changes.** Portal RBAC (`CustomerRbacService`) gets a parallel rollout in a separate spec.

## 4. Design overview

### 4.1 Feature descriptor — extended shape

Today every module's `acl.ts` exports:

```typescript
export const features = [
  { id: 'customers.people.view', title: 'View people', module: 'customers' },
  // ...
]
```

After this spec:

```typescript
export const features = [
  { id: 'customers.people.view', title: 'View people', module: 'customers' },
  {
    id: 'customers.people.manage',
    title: 'Manage people',
    module: 'customers',
    dependsOn: ['customers.people.view'],
  },
  // ...
]
```

`dependsOn` is **optional** and **additive**. Every existing `acl.ts` keeps compiling unchanged. The field is a flat string array — no graph topology, no severity, no human-readable reason field in v1. Nesting and richer metadata are deferred.

### 4.2 Where the declarations land

Dependencies are declared in each module's `acl.ts` because:
- `acl.ts` already owns feature IDs and titles — keeps the declaration co-located with the thing it documents.
- The aggregation pipeline (`getModules()` → `/api/auth/features`) already iterates `m.features` and passes whatever fields are present through to consumers.
- Per-module maintainers curate their own bundles without touching a shared file (avoids merge conflicts and ownership drift).

Cross-module dependencies are allowed and expected. Example: `sales.orders.view` can declare `dependsOn: ['sales.channels.view', 'sales.settings.view', 'currencies.view']` (assuming view-grained features exist; see per-module sections).

### 4.3 Resolver contract

A new helper in `@open-mercato/shared/security/aclDependencies.ts`:

```typescript
export type FeatureDescriptor = {
  id: string
  title: string
  module: string
  dependsOn?: readonly string[]
}

export type AclDependencyDiagnostics = {
  /**
   * For each granted feature whose declared dependencies are NOT covered by
   * the effective granted set (after wildcard expansion).
   */
  missingDependencies: Array<{
    feature: string          // the granted feature
    missing: string[]        // declared deps that are not satisfied
  }>
  /**
   * For each NOT-granted feature whose dependents ARE still granted.
   * Surfaced when the operator deselects a parent but leaves children behind.
   */
  orphanedDependents: Array<{
    dependency: string       // the not-granted feature that others need
    dependents: string[]     // granted features that declare `dependency` in dependsOn
  }>
  /**
   * `dependsOn` ids that don't resolve to any registered feature.
   * Dev hint — points at typos and stale references.
   */
  unknownReferences: Array<{
    feature: string
    missing: string[]
  }>
}

export function resolveAclDependencyDiagnostics(
  granted: readonly string[],
  catalog: readonly FeatureDescriptor[],
): AclDependencyDiagnostics
```

Key semantics:

- **Wildcard-aware.** A granted `customers.*` satisfies a `dependsOn` entry of `customers.people.view`. The resolver uses `hasFeature(granted, dep)` internally (same helper as RBAC runtime).
- **No transitive closure pre-computed.** If `A` depends on `B` and `B` depends on `C`, granting only `A` produces TWO diagnostic rows (missing `B`; missing `C` — once `B` is added, the second row resolves). This is intentional — keeps the resolver simple and lets the UI show every actionable gap rather than collapsing them.
- **Symmetry.** `missingDependencies` answers "what's broken right now?"; `orphanedDependents` answers "what will break if you save?" The UI surfaces both, with different copy.
- **Unknown references** never block — they are diagnostic-only and only surfaced in dev / a hidden admin view.
- **Pure function.** No I/O, no DI. Safe to run client-side or server-side. Trivially unit-testable.

### 4.4 Wire shape — `/api/auth/features`

The existing endpoint returns:

```json
{ "items": [{ "id": "customers.people.view", "title": "View people", "module": "customers" }], "modules": [...] }
```

After this spec, `dependsOn` is included when present:

```json
{ "items": [{ "id": "customers.people.manage", "title": "Manage people", "module": "customers", "dependsOn": ["customers.people.view"] }], "modules": [...] }
```

OpenAPI schema gets `dependsOn: z.array(z.string()).optional()` on the feature item schema. The change is purely additive — old clients ignore the field.

### 4.5 UI — `AclEditor` diagnostics panel

`AclEditor` (`packages/core/src/modules/auth/components/AclEditor.tsx`) is the **single** component used by both:
- `/backend/roles/[id]/edit` — role permission editing
- `/backend/users/[id]/edit` — per-user permission overrides

Wiring the warnings here covers both surfaces with one implementation.

Mockup (component-level):

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠ Permission dependency gaps (2)                           │
│                                                             │
│  • "Manage people" needs "View people"                      │
│      [ Add "View people" ]                                  │
│                                                             │
│  • "Use customer todos widget" needs "View activities"      │
│      [ Add "View activities" ]                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ⚠ Removing a feature that other granted features need (1)  │
│                                                             │
│  • "View deals" is required by:                             │
│      – "Manage deals"                                       │
│      – "Use customer new deals widget"                      │
│      [ Restore "View deals" ]  [ Drop dependents ]          │
└─────────────────────────────────────────────────────────────┘
```

Behaviour:

- Panel renders above the module feature grid.
- Recomputes synchronously on every grant change (the granted set is already in component state).
- Hidden when the effective granted set is `*` (global super wildcard), `isSuperAdmin`, or when no diagnostics resolve.
- Quick-action buttons:
  - `Add "X"` — adds the missing dep to `granted`.
  - `Restore "Y"` — re-adds the deselected feature to `granted`.
  - `Drop dependents` — removes every dependent of the deselected feature. Confirmation modal (Cmd+Enter / Escape).
- Severity is **warning** only. Users can still save.

i18n keys: `auth.acl.deps.missing.title`, `auth.acl.deps.missing.item`, `auth.acl.deps.missing.add`, `auth.acl.deps.orphaned.title`, `auth.acl.deps.orphaned.item`, `auth.acl.deps.orphaned.restore`, `auth.acl.deps.orphaned.drop`, `auth.acl.deps.unknown.title` (dev-only).

### 4.6 Why not server-side?

The PR is intentionally a **warning UX**, not an enforcement boundary. Reasons:

1. The 13 contract surfaces in `BACKWARD_COMPATIBILITY.md` include ACL features. A breaking enforcement change would need a deprecation cycle.
2. Some tenants knowingly grant `manage` without `view` to back-office automation accounts (RPA scripts, partner integrations). Hard rejection breaks them on upgrade.
3. The cost of being wrong about a dependency declaration is high — a bad dep blocks every save.
4. Per-tenant policy ("strict" / "warn-only" / "off") belongs in `configs`, not in the platform default.

Server-side enforcement is filed as the §11 Open Question.

## 5. Audit — current ACL surface

Snapshot of every module that ships an `acl.ts` (48 modules total, 4 templates included). Features that already follow the view↔manage pattern are obvious candidates for intra-module deps; widget features need explicit data-source declarations; cross-module deps require careful curation.

See §6 for the per-module proposed dependency tables. The full feature inventory is in `.ai/runs/2026-05-27-acl-dependency-bundles/PLAN.md` and in the agent audit attached to the run NOTIFY log.

## 6. Per-module dependency proposals

Each table is the **proposed default** for the matching module's `dependsOn` rollout. Only the `customers` table is enacted by this PR. All others are pre-filed as GitHub issues so the per-module owner can refine before merging.

Each row shows `feature → dependsOn`. Empty `dependsOn` means: no declared dependencies (likely a root view feature or a self-contained capability).

### 6.1 `customers` (THIS PR)

Reference module — enacted in this spec's PR.

| Feature | dependsOn |
|---------|-----------|
| `customers.people.view` | — |
| `customers.people.manage` | `customers.people.view` |
| `customers.companies.view` | — |
| `customers.companies.manage` | `customers.companies.view` |
| `customers.deals.view` | `customers.people.view` |
| `customers.deals.manage` | `customers.deals.view` |
| `customers.activities.view` | — |
| `customers.activities.manage` | `customers.activities.view` |
| `customers.settings.manage` | — |
| `customers.pipelines.view` | — |
| `customers.pipelines.manage` | `customers.pipelines.view` |
| `customers.widgets.todos` | `customers.activities.view` |
| `customers.widgets.next-interactions` | `customers.interactions.view` |
| `customers.widgets.new-customers` | `customers.people.view` |
| `customers.widgets.new-deals` | `customers.deals.view` |
| `customers.interactions.view` | — |
| `customers.interactions.manage` | `customers.interactions.view` |
| `customers.roles.view` | — |
| `customers.roles.manage` | `customers.roles.view` |

Notes:
- `customers.deals.view` depends on `customers.people.view` because the deal detail surface inlines person summaries; without people-view, deal cards render but key fields 403.
- `customers.settings.manage` is left as a root because the settings UI is self-contained; the admin who has settings.manage doesn't need people.view to function.

### 6.2 `sales` (per-module follow-up)

This is the headline case from PR #2073. Proposed:

| Feature | dependsOn |
|---------|-----------|
| `sales.orders.view` | `sales.channels.view`*, `sales.settings.view`*, `customers.people.view`, `catalog.products.view`, `currencies.view` |
| `sales.orders.manage` | `sales.orders.view` |
| `sales.orders.approve` | `sales.orders.view` |
| `sales.quotes.view` | `sales.channels.view`*, `sales.settings.view`*, `customers.people.view`, `catalog.products.view` |
| `sales.quotes.manage` | `sales.quotes.view` |
| `sales.documents.number.edit` | `sales.orders.view`, `configs.manage` |
| `sales.shipments.manage` | `sales.orders.view`, `shipping_carriers.view` |
| `sales.payments.manage` | `sales.orders.view`, `payment_gateways.view` |
| `sales.returns.view` | `sales.orders.view` |
| `sales.returns.create` | `sales.returns.view`, `sales.orders.manage` |
| `sales.invoices.manage` | `sales.orders.view` |
| `sales.credit_memos.manage` | `sales.invoices.manage` |
| `sales.channels.manage` | `sales.channels.view`* |
| `sales.settings.manage` | `sales.settings.view`* |
| `sales.widgets.new-orders` | `sales.orders.view` |
| `sales.widgets.new-quotes` | `sales.quotes.view` |

`*` denotes features that **do not yet exist** in `sales/acl.ts` and that the per-module issue MUST introduce alongside the dependency declarations:

- `sales.channels.view` — split out of `sales.channels.manage` so dependent pages can ask for read access without escalating.
- `sales.settings.view` — same rationale for settings metadata.

Introducing the new view features is BC-safe (additive) and requires updating `setup.ts` `defaultRoleFeatures` plus running `yarn mercato auth sync-role-acls`. The per-module issue covers this.

### 6.3 `catalog`

| Feature | dependsOn |
|---------|-----------|
| `catalog.products.view` | `currencies.view`, `dictionaries.view` |
| `catalog.products.manage` | `catalog.products.view` |
| `catalog.categories.view` | — |
| `catalog.categories.manage` | `catalog.categories.view` |
| `catalog.variants.manage` | `catalog.products.view` |
| `catalog.pricing.manage` | `catalog.products.view`, `currencies.view` |
| `catalog.settings.manage` | — |

### 6.4 `auth` (self-referencing)

| Feature | dependsOn |
|---------|-----------|
| `auth.users.list` | — |
| `auth.users.create` | `auth.users.list` |
| `auth.users.edit` | `auth.users.list` |
| `auth.users.delete` | `auth.users.list` |
| `auth.roles.list` | — |
| `auth.roles.manage` | `auth.roles.list` |
| `auth.acl.manage` | `auth.users.list`, `auth.roles.list` |
| `auth.sidebar.manage` | `auth.roles.list` |

### 6.5 `configs`

| Feature | dependsOn |
|---------|-----------|
| `configs.system_status.view` | — |
| `configs.cache.view` | — |
| `configs.cache.manage` | `configs.cache.view` |
| `configs.manage` | `configs.system_status.view` |

### 6.6 `inbox_ops` (also listed by alinadivante)

| Feature | dependsOn |
|---------|-----------|
| `inbox_ops.proposals.view` | `messages.view`, `customers.people.view`, `sales.orders.view`* |
| `inbox_ops.proposals.manage` | `inbox_ops.proposals.view` |
| `inbox_ops.settings.manage` | — |
| `inbox_ops.log.view` | `inbox_ops.proposals.view` |
| `inbox_ops.replies.send` | `inbox_ops.proposals.view`, `messages.compose` |

`*` Inbox proposals reference sales orders; cross-module dep follows the pattern.

### 6.7 `customer_accounts` (admin-side; portal RBAC out of scope)

| Feature | dependsOn |
|---------|-----------|
| `customer_accounts.view` | — |
| `customer_accounts.manage` | `customer_accounts.view` |
| `customer_accounts.roles.manage` | `customer_accounts.view` |
| `customer_accounts.invite` | `customer_accounts.view` |
| `customer_accounts.domain.manage` | `customer_accounts.view` |

### 6.8 `integrations`

| Feature | dependsOn |
|---------|-----------|
| `integrations.view` | — |
| `integrations.manage` | `integrations.view` |
| `integrations.credentials.manage` | `integrations.manage` |

### 6.9 `data_sync`

| Feature | dependsOn |
|---------|-----------|
| `data_sync.view` | `integrations.view` |
| `data_sync.run` | `data_sync.view`, `integrations.view` |
| `data_sync.configure` | `data_sync.view`, `integrations.manage` |

### 6.10 `workflows`

| Feature | dependsOn |
|---------|-----------|
| `workflows.view` | — |
| `workflows.manage` | `workflows.view` |
| `workflows.view_logs` | `workflows.view` |
| `workflows.view_tasks` | `workflows.view` |
| `workflows.definitions.view` | `workflows.view` |
| `workflows.definitions.create` | `workflows.definitions.view` |
| `workflows.definitions.edit` | `workflows.definitions.view` |
| `workflows.definitions.delete` | `workflows.definitions.view` |
| `workflows.instances.view` | `workflows.view` |
| `workflows.instances.create` | `workflows.instances.view`, `workflows.definitions.view` |
| `workflows.instances.cancel` | `workflows.instances.view` |
| `workflows.instances.retry` | `workflows.instances.view` |
| `workflows.instances.signal` | `workflows.instances.view` |
| `workflows.tasks.view` | `workflows.view` |
| `workflows.tasks.claim` | `workflows.tasks.view` |
| `workflows.tasks.complete` | `workflows.tasks.view` |
| `workflows.signals.send` | `workflows.view` |
| `workflows.events.view` | `workflows.view` |

### 6.11 `dashboards`

| Feature | dependsOn |
|---------|-----------|
| `dashboards.view` | — |
| `dashboards.configure` | `dashboards.view` |
| `dashboards.admin.assign-widgets` | `dashboards.view`, `auth.roles.list` |
| `analytics.view` | `dashboards.view` |

### 6.12 `attachments`

| Feature | dependsOn |
|---------|-----------|
| `attachments.view` | — |
| `attachments.manage` | `attachments.view` |

### 6.13 `messages`

| Feature | dependsOn |
|---------|-----------|
| `messages.view` | — |
| `messages.compose` | `messages.view` |
| `messages.attach` | `messages.compose` |
| `messages.attach_files` | `messages.compose`, `attachments.view` |
| `messages.email` | `messages.compose` |
| `messages.actions` | `messages.view` |
| `messages.manage` | `messages.view` |

### 6.14 `api_keys`

| Feature | dependsOn |
|---------|-----------|
| `api_keys.view` | — |
| `api_keys.create` | `api_keys.view` |
| `api_keys.delete` | `api_keys.view` |

### 6.15 `audit_logs`

| Feature | dependsOn |
|---------|-----------|
| `audit_logs.view_self` | — |
| `audit_logs.view_tenant` | `audit_logs.view_self` |
| `audit_logs.undo_self` | `audit_logs.view_self` |
| `audit_logs.undo_tenant` | `audit_logs.view_tenant`, `audit_logs.undo_self` |
| `audit_logs.redo_self` | `audit_logs.view_self` |
| `audit_logs.redo_tenant` | `audit_logs.view_tenant`, `audit_logs.redo_self` |

### 6.16 `notifications`

| Feature | dependsOn |
|---------|-----------|
| `notifications.view` | — |
| `notifications.create` | `notifications.view` |
| `notifications.manage` | `notifications.view` |

### 6.17 `perspectives`

| Feature | dependsOn |
|---------|-----------|
| `perspectives.use` | — |
| `perspectives.role_defaults` | `perspectives.use`, `auth.roles.list` |

### 6.18 `feature_toggles`

| Feature | dependsOn |
|---------|-----------|
| `feature_toggles.view` | — |
| `feature_toggles.manage` | `feature_toggles.view` |

### 6.19 `dictionaries`

| Feature | dependsOn |
|---------|-----------|
| `dictionaries.view` | — |
| `dictionaries.manage` | `dictionaries.view` |

### 6.20 `business_rules`

| Feature | dependsOn |
|---------|-----------|
| `business_rules.view` | — |
| `business_rules.manage` | `business_rules.view` |
| `business_rules.execute` | `business_rules.view` |
| `business_rules.view_logs` | `business_rules.view` |
| `business_rules.manage_sets` | `business_rules.view` |

### 6.21 `translations`

| Feature | dependsOn |
|---------|-----------|
| `translations.view` | — |
| `translations.manage` | `translations.view` |
| `translations.manage_locales` | `translations.view` |

### 6.22 `staff`

| Feature | dependsOn |
|---------|-----------|
| `staff.view` | — |
| `staff.manage_team` | `staff.view` |
| `staff.leave_requests.send` | `staff.my_leave_requests.view` |
| `staff.leave_requests.manage` | `staff.view` |
| `staff.my_availability.view` | — |
| `staff.my_availability.manage` | `staff.my_availability.view` |
| `staff.my_availability.unavailability` | `staff.my_availability.view` |
| `staff.my_leave_requests.view` | — |
| `staff.my_leave_requests.send` | `staff.my_leave_requests.view` |

### 6.23 `planner`

| Feature | dependsOn |
|---------|-----------|
| `planner.view` | — |
| `planner.manage_availability` | `planner.view` |

### 6.24 `shipping_carriers`

| Feature | dependsOn |
|---------|-----------|
| `shipping_carriers.view` | — |
| `shipping_carriers.manage` | `shipping_carriers.view` |

### 6.25 `payment_gateways`

| Feature | dependsOn |
|---------|-----------|
| `payment_gateways.view` | — |
| `payment_gateways.manage` | `payment_gateways.view` |
| `payment_gateways.capture` | `payment_gateways.view` |
| `payment_gateways.refund` | `payment_gateways.view` |

### 6.26 `webhooks`

| Feature | dependsOn |
|---------|-----------|
| `webhooks.view` | — |
| `webhooks.manage` | `webhooks.view` |
| `webhooks.secrets` | `webhooks.manage` |
| `webhooks.test` | `webhooks.view` |

### 6.27 `scheduler`

| Feature | dependsOn |
|---------|-----------|
| `scheduler.jobs.view` | — |
| `scheduler.jobs.manage` | `scheduler.jobs.view` |
| `scheduler.jobs.trigger` | `scheduler.jobs.view` |

### 6.28 `search`

| Feature | dependsOn |
|---------|-----------|
| `search.view` | — |
| `search.manage` | `search.view` |
| `search.reindex` | `search.view` |
| `search.embeddings.view` | `search.view` |
| `search.embeddings.manage` | `search.embeddings.view` |
| `search.global` | — |

### 6.29 `ai_assistant`

| Feature | dependsOn |
|---------|-----------|
| `ai_assistant.view` | — |
| `ai_assistant.settings.manage` | `ai_assistant.view` |
| `ai_assistant.conversations.manage` | `ai_assistant.view` |
| `ai_assistant.mcp.serve` | `ai_assistant.view` |
| `ai_assistant.tools.list` | `ai_assistant.view` |
| `ai_assistant.mcp_servers.view` | `ai_assistant.view` |
| `ai_assistant.mcp_servers.manage` | `ai_assistant.mcp_servers.view` |

### 6.30 `checkout`

| Feature | dependsOn |
|---------|-----------|
| `checkout.view` | — |
| `checkout.create` | `checkout.view`, `sales.orders.view`, `customers.people.view` |
| `checkout.edit` | `checkout.view` |
| `checkout.delete` | `checkout.view` |
| `checkout.viewPii` | `checkout.view`, `customers.people.view` |
| `checkout.export` | `checkout.view` |

### 6.31 `content`

(No `acl.ts` features audited yet — placeholder; per-module issue confirms.)

### 6.32 `onboarding`

| Feature | dependsOn |
|---------|-----------|
| `onboarding.access` | — |
| `onboarding.submit` | `onboarding.access` |
| `onboarding.verify` | `onboarding.access` |

### 6.33 `enterprise/security`

| Feature | dependsOn |
|---------|-----------|
| `security.profile.view` | — |
| `security.profile.password` | `security.profile.view` |
| `security.profile.manage` | `security.profile.view` |
| `security.mfa.manage` | `security.profile.view` |
| `security.admin.manage` | `security.profile.view`, `auth.users.list` |
| `security.sudo.view` | — |
| `security.sudo.manage` | `security.sudo.view` |

### 6.34 `enterprise/record_locks`

| Feature | dependsOn |
|---------|-----------|
| `record_locks.view` | — |
| `record_locks.manage` | `record_locks.view` |
| `record_locks.force_release` | `record_locks.manage` |
| `record_locks.override_incoming` | `record_locks.view` |

### 6.35 `enterprise/sso`

| Feature | dependsOn |
|---------|-----------|
| `sso.config.view` | — |
| `sso.config.manage` | `sso.config.view` |
| `sso.scim.manage` | `sso.config.manage` |

### 6.36 `gateway_stripe`

| Feature | dependsOn |
|---------|-----------|
| `gateway_stripe.view` | `payment_gateways.view` |
| `gateway_stripe.configure` | `gateway_stripe.view`, `payment_gateways.manage` |

### 6.37 `storage_s3`

| Feature | dependsOn |
|---------|-----------|
| `storage_providers.manage` | — |

### 6.38 `directory`

| Feature | dependsOn |
|---------|-----------|
| `directory.tenants.view` | — |
| `directory.tenants.manage` | `directory.tenants.view` |
| `directory.organizations.view` | — |
| `directory.organizations.manage` | `directory.organizations.view` |

### 6.39 `entities`

| Feature | dependsOn |
|---------|-----------|
| `entities.definitions.view` | — |
| `entities.definitions.manage` | `entities.definitions.view` |
| `entities.records.view` | — |
| `entities.records.manage` | `entities.records.view` |

### 6.40 `currencies`

| Feature | dependsOn |
|---------|-----------|
| `currencies.view` | — |
| `currencies.manage` | `currencies.view` |
| `currencies.rates.view` | `currencies.view` |
| `currencies.rates.manage` | `currencies.rates.view` |
| `currencies.fetch.view` | `currencies.view` |
| `currencies.fetch.manage` | `currencies.fetch.view` |

### 6.41 `progress`

| Feature | dependsOn |
|---------|-----------|
| `progress.view` | — |
| `progress.create` | `progress.view` |
| `progress.update` | `progress.view` |
| `progress.cancel` | `progress.view` |
| `progress.manage` | `progress.view` |

### 6.42 `query_index`

| Feature | dependsOn |
|---------|-----------|
| `query_index.status.view` | — |
| `query_index.reindex` | `query_index.status.view` |
| `query_index.purge` | `query_index.status.view` |

### 6.43 `resources`

| Feature | dependsOn |
|---------|-----------|
| `resources.view` | — |
| `resources.manage_resources` | `resources.view` |

### 6.44 `sync_excel`

| Feature | dependsOn |
|---------|-----------|
| `sync_excel.view` | — |
| `sync_excel.run` | `sync_excel.view` |

### 6.45 `apps/mercato/example` and templates

Marked as `(template)` modules — example modules MUST exercise the convention end-to-end so create-app templates ship with declared deps. Same view↔manage and widget↔owner patterns.

| Feature | dependsOn |
|---------|-----------|
| `example.backend` | — |
| `example.view` | — |
| `example.todos.view` | — |
| `example.todos.manage` | `example.todos.view` |
| `example.widgets.injection` | `example.view` |
| `example.widgets.todo` | `example.todos.view` |
| `example.widgets.welcome` | `example.view` |
| `example.widgets.notes` | `example.view` |
| `example_customers_sync.view` | `customers.people.view` |
| `example_customers_sync.manage` | `example_customers_sync.view` |

## 7. Implementation phasing

Phasing maps 1:1 onto the per-module follow-up issues so different teams can pick up modules in parallel without conflict.

| Phase | Module(s) | Owner | Notes |
|-------|-----------|-------|-------|
| 0 | infra (shared resolver, /api/auth/features, AclEditor) | platform | this PR |
| 1 | `customers` | platform | this PR — reference impl |
| 2 | `sales` | sales team | original §1 case |
| 3 | `auth`, `configs`, `directory`, `entities` | platform | self-referencing modules |
| 4 | `catalog`, `currencies`, `dictionaries` | catalog team | catalog cluster |
| 5 | `inbox_ops`, `messages`, `attachments` | comms team | inbox cluster |
| 6 | `customer_accounts` | accounts team | admin side only |
| 7 | `workflows`, `business_rules`, `progress` | platform | automation cluster |
| 8 | `integrations`, `data_sync`, `webhooks`, `gateway_stripe`, `storage_s3` | integrations team | provider cluster |
| 9 | `audit_logs`, `feature_toggles`, `notifications`, `query_index`, `search`, `perspectives` | platform | operations cluster |
| 10 | `staff`, `planner`, `resources`, `dashboards` | platform | misc cluster |
| 11 | `shipping_carriers`, `payment_gateways`, `checkout` | sales team | order-fulfillment cluster |
| 12 | `api_keys`, `api_docs`, `ai_assistant`, `scheduler`, `sync_excel`, `onboarding`, `translations` | platform | DX/admin cluster |
| 13 | `enterprise/security`, `enterprise/sso`, `enterprise/record_locks` | enterprise team | enterprise overlay |
| 14 | templates (`example`, `example_customers_sync`) | platform | regenerate from production patterns |

Each phase is independent. Merge order matters only when a module's dependencies cross into another module that hasn't declared its features yet — in which case the dependency rows resolve to `unknownReferences` (dev-only diagnostic) until both modules are done. No runtime impact.

## 8. Backward compatibility

This is a **STABLE / ADDITIVE-ONLY** change per `BACKWARD_COMPATIBILITY.md`:

- **Feature descriptor type:** new optional field. Existing `acl.ts` exports keep compiling. No removed/renamed fields.
- **`/api/auth/features` response:** new optional field on each item. Old clients ignore it.
- **OpenAPI schema:** the new field is declared as `.optional()`; consumers using strict schemas keep working.
- **Runtime RBAC:** unchanged. `hasFeature`, `matchFeature`, `userHasAllFeatures`, wildcard handling all stay verbatim.
- **`setup.ts` `defaultRoleFeatures`:** unchanged.
- **No DB migration.**
- **No event ID, DI name, ACL feature ID, notification ID, CLI command, widget spot ID, page URL, or import path changes.**

If a future spec introduces server-side enforcement (§11), THAT is the breaking change — gated by the deprecation protocol.

## 9. Testing

This PR ships:

- Unit tests for `resolveAclDependencyDiagnostics`:
  - empty granted set → empty diagnostics
  - granted feature with all deps satisfied → empty diagnostics
  - granted feature with one missing dep → `missingDependencies` populated
  - wildcard coverage (`customers.*` granted, feature requires `customers.people.view`) → no diagnostic
  - global wildcard (`*` granted) → no diagnostic
  - dependency on a non-existent feature id → `unknownReferences` populated
  - orphaned dependents: parent removed from granted but child still present → `orphanedDependents` populated
  - intersection: a removed parent with both granted and not-granted children → only granted children listed as dependents
- jsdom tests for the `AclEditor` diagnostics panel:
  - panel hidden when `isSuperAdmin` or `*` granted
  - panel surfaces both missing and orphaned diagnostics
  - "Add missing" click adds the feature to granted
  - "Restore" click re-adds the deselected parent
  - "Drop dependents" click respects Cmd+Enter confirmation
- One integration coverage line per role-edit and user-edit flow is documented (manual smoke; full integration test follows when the suite has time-budget).

Per-module follow-up issues do NOT need new resolver tests — the resolver is module-agnostic. They DO ship updated unit tests asserting their `acl.ts` declarations resolve cleanly against the catalog (no `unknownReferences` for the module's own features).

## 10. Risks (carried from PLAN.md)

- **Stale declarations** — see §11.
- **Cross-module coupling friction** — declaring `sales.orders.view` as depending on `customers.people.view` means every order-using role must include people-view. Backed by the §6.5 audit (the orders page genuinely needs people data) but worth a per-module gut check.
- **Wildcard sprawl** — if every dep eventually resolves through `module.*` grants, the warnings become noise. Acceptable: wildcard grants are typically admin-only, where warnings are irrelevant.
- **Diagnostic UX overload** — a brand-new role with all features enabled produces zero diagnostics; a brand-new role with only one feature might produce dozens. The "Add all missing" affordance (deferred) addresses this; in v1 the panel is collapsed by default after 5+ items.

## 11. Open questions / deferred

1. **Server-side enforcement.** Should `PUT /api/auth/roles/acl` reject saves that violate dependencies? Or auto-add the missing deps server-side? Or expose this as a per-tenant `configs` toggle (strict/warn/off)? Filed as follow-up spec.
2. **Customer portal parity.** `CustomerRbacService` has its own feature catalog. Should portal features adopt the same `dependsOn`? Filed as follow-up spec — needs a separate audit because portal features cross into admin (e.g. `portal.orders.view` depends on data behind `sales.orders.view`).
3. **Dependency severity.** Today every dep is "warning". Future: `severity: 'block' | 'warn' | 'hint'` for cases where a missing dep guarantees broken UX vs cases where partial access is intentional. Filed under §11.1.
4. **Reverse-lookup index.** The resolver walks the catalog linearly; for very large catalogs (>1000 features) it's O(grants × catalog). Filed only if perf bites — current catalog is ~250 features total.
5. **Auto-derived dependencies.** Could we statically scan `requireFeatures` on page metadata and infer that pages calling each other's APIs declare implicit deps? Spike-quality; filed under §11.4.
6. **i18n of dep titles.** The warning copy names features by their `title`. Currently titles are English in `acl.ts` files. The i18n migration of feature titles is its own initiative; for now warnings display untranslated titles.

## 12. References

- PR #2073 (`fix(auth): break 403 redirect loop on staff login`) — the incident.
- @alinadivante's review comment — the QA finding that motivated this spec.
- `BACKWARD_COMPATIBILITY.md` — the contract surfaces (ACL features = STABLE; adding optional metadata is ADDITIVE).
- `packages/core/AGENTS.md` → Access Control section — current RBAC semantics, wildcard handling.
- `packages/core/src/modules/auth/AGENTS.md` — auth module guide, ACL grant sync.
- `packages/core/src/modules/auth/components/AclEditor.tsx` — the editor wired in this PR.
- `packages/shared/src/security/features.ts` — `hasFeature`, `matchFeature` runtime.
- `.ai/runs/2026-05-27-acl-dependency-bundles/` — this run's audit trail and progress.
