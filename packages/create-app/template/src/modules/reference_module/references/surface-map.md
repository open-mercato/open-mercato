# Reference module surface map

This map renders the finite [surface inventory](./surface-inventory.json) for humans. The inventory is the machine oracle for capability IDs, one owner, coverage kind, rollout state, and exact emitted-app paths.

Coverage has three meanings:

- `reference`: implemented or planned in `src/modules/reference_module`; `planned` is not current coverage.
- `authoritative-source`: an exact installed framework source owns the deeper or specialized example.
- `specialist-route`: read the named specialist skill before the exact installed source.

All links are file-level, repository-relative, and deliberately omit line anchors. Do not create a discovery file until it has a real registration and caller.

## Available shell and activation boundary

| Capability | State | Owner | Exact source |
|---|---|---|---|
| `module.metadata` | implemented | module scaffold | [index.ts](../index.ts) |
| `module.registration` | implemented, absent by design | module scaffold | [src/modules.ts](../../../modules.ts) |

The registry source exists, but no built-in preset contains an entry for `reference_module`. Registration becomes an intentional consumer action only after copy-and-rename.

## Planned local reference coverage

The following IDs are frozen and use `coverageKind: reference`, but their rollout is `planned`. Their exact future file paths and single owners are recorded in the [inventory](./surface-inventory.json). The paths do not exist yet; later steps must replace `planned` with `implemented` only when real code and a caller/test land.

### Module and scoped data

`module.di`, `module.cli`, `data.entity.task`, `data.entity.link`, `data.entity.undo-snapshot`, `data.validators`, `data.custom-fields`, `data.extension-links`, `data.encryption`, `data.migration`, `data.snapshot`, `setup.acl`, `setup.role-sync`, `setup.defaults`, `setup.examples`

### APIs, commands, guards, and enrichment

`api.crud-factory`, `api.openapi`, `api.query-engine`, `api.import`, `api.export`, `api.interceptors`, `commands.write`, `commands.undo`, `commands.interceptors`, `commands.optimistic-lock`, `guards.mutation`, `enrichers.response`, `query.enrichment`

### Events, search, cache, queues, and notifications

`events.typed`, `events.subscriber`, `events.dom-bridge`, `search.index`, `cache.read`, `cache.invalidation`, `queue.worker`, `progress.job`, `notifications.type`, `notifications.renderer`, `notifications.handler`

### Backend UI and extension hosts

`ui.page-metadata`, `ui.list`, `ui.perspectives`, `ui.filters`, `ui.search`, `ui.export`, `ui.form-shared`, `ui.conflicts`, `widgets.hosts`, `widgets.headless-field`, `widgets.headless-column`, `widgets.headless-filter`, `widgets.headless-row-action`, `widgets.headless-bulk-action`, `widgets.headless-tab`, `widgets.headless-menu`, `widgets.customers`, `widgets.catalog`, `widgets.sales`, `widgets.component-replacement`

### Unified overrides

`overrides.unified`, `overrides.ai-agents`, `overrides.ai-tools`, `overrides.ai-extensions`, `overrides.routes-api`, `overrides.routes-pages`, `overrides.event-subscribers`, `overrides.workers`, `overrides.widgets-injection`, `overrides.widgets-components`, `overrides.widgets-dashboard`, `overrides.notification-types`, `overrides.notification-handlers`, `overrides.api-interceptors`, `overrides.command-interceptors`, `overrides.enrichers`, `overrides.guards`, `overrides.cli`, `overrides.setup`, `overrides.acl-features`, `overrides.di`, `overrides.encryption-maps`

### Localization and tests

`i18n.locales`, `i18n.translatable-fields`, `tests.unit`, `tests.integration`

## Authoritative installed sources

These capabilities are intentionally not claimed by the local backend reference. Their exact installed sources exist now and remain under their listed owner.

| Capability | Owner | Exact installed source |
|---|---|---|
| `frontend.page` | backend UI | [public page](../../../../node_modules/@open-mercato/core/src/modules/messages/frontend/messages/view/%5Btoken%5D/page.tsx) |
| `portal.page` | backend UI | [portal page](../../../../node_modules/@open-mercato/core/src/modules/portal/frontend/%5BorgSlug%5D/portal/page.tsx) |
| `guards.page-middleware` | backend UI | [page middleware generator](../../../../node_modules/@open-mercato/cli/src/lib/generators/extensions/page-middleware.ts) |
| `widgets.dashboard` | system extension | [dashboard widget](../../../../node_modules/@open-mercato/core/src/modules/customers/widgets/dashboard/customer-todos/widget.ts) |
| `search.vector` | module scaffold | [vector strategy](../../../../node_modules/@open-mercato/search/src/strategies/vector.strategy.ts) |
| `analytics.contribution` | module scaffold | [analytics generator](../../../../node_modules/@open-mercato/cli/src/lib/generators/extensions/analytics.ts) |
| `messages.contribution` | module scaffold | [messages generator](../../../../node_modules/@open-mercato/cli/src/lib/generators/extensions/messages.ts) |
| `inbox.contribution` | module scaffold | [inbox-actions generator](../../../../node_modules/@open-mercato/cli/src/lib/generators/extensions/inbox-actions.ts) |
| `security.contribution` | discovery catalog | [auth ACL](../../../../node_modules/@open-mercato/core/src/modules/auth/acl.ts) |
| `security.mfa-provider` | discovery catalog | [security generator fixture](../../../../node_modules/@open-mercato/cli/src/lib/generators/__tests__/module-subset.test.ts) |
| `security.sudo-target` | discovery catalog | [security generator fixture](../../../../node_modules/@open-mercato/cli/src/lib/generators/__tests__/module-subset.test.ts) |
| `integrations.metadata` | integration builder | [integration metadata](../../../../node_modules/@open-mercato/core/src/modules/integrations/index.ts) |
| `integrations.domain-registry` | integration builder | [domain registry](../../../../node_modules/@open-mercato/core/src/modules/integrations/lib/registry-service.ts) |
| `integrations.ui-registry` | integration builder | [UI registry](../../../../node_modules/@open-mercato/core/src/modules/integrations/backend/integrations/detail-page-widgets.ts) |
| `generators.extension-plugin` | discovery catalog | [extension generator](../../../../node_modules/@open-mercato/cli/src/lib/generators/extension.ts) |

## Specialist routes

| Capability | Required owner | Exact installed source |
|---|---|---|
| `specialist.ai` | [AI agent skill](../../../../.ai/skills/om-create-ai-agent/SKILL.md) | [AI tool definition](../../../../node_modules/@open-mercato/ai-assistant/src/modules/ai_assistant/ai-tools.ts) |
| `specialist.provider` | [integration builder skill](../../../../.ai/skills/om-integration-builder/SKILL.md) | [Stripe provider metadata](../../../../node_modules/@open-mercato/gateway-stripe/src/modules/gateway_stripe/index.ts) |
| `specialist.workflow` | [workflow skill](../../../../.ai/skills/om-build-workflow/SKILL.md) | [workflow definitions](../../../../node_modules/@open-mercato/core/src/modules/workflows/workflows.ts) |

## Budgets and maintenance

- Completed reference source tree: at most 80 files and 512 KiB.
- [README](../README.md): at most 12 KiB.
- This map: at most 24 KiB.
- Client components: at most 300 lines each; no page-root client boundary or heavy global provider.
- Every inventory entry keeps exactly one `capabilityId`, owner, coverage kind, rollout state, and at least one exact path.
- Additions require a spec amendment; removals require compatibility review. Never silently collapse capability IDs.
