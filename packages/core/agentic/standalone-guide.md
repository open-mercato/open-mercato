# Core Package — Standalone Developer Guide

`@open-mercato/core` contains all built-in business modules. This guide covers module development patterns for standalone apps that build on top of these modules.

## Auto-Discovery Paths

Place files in your module directory (`src/modules/<module>/`) — the framework discovers them automatically:

| Path Pattern | Becomes |
|---|---|
| `frontend/<path>.tsx` | `/<path>` (public page) |
| `backend/<path>.tsx` | `/backend/<path>` (admin page) |
| `backend/page.tsx` | `/backend/<module>` (module root page) |
| `api/<method>/<path>.ts` | `/api/<path>` dispatched by HTTP method |
| `subscribers/*.ts` | Event subscriber (export `metadata` + default handler) |
| `workers/*.ts` | Background worker (export `metadata` + default handler) |

Run `yarn generate` after adding any auto-discovered file.

## Module Files Reference

| File | Export | Purpose |
|------|--------|---------|
| `index.ts` | `metadata` | Module metadata |
| `di.ts` | `register(container)` | DI registrations (Awilix) |
| `acl.ts` | `features` | Permission features: `['mod.view', 'mod.create', ...]` |
| `setup.ts` | `setup: ModuleSetupConfig` | Tenant init, role features, seed data |
| `ce.ts` | `entities` | Custom entities / custom field sets |
| `events.ts` | `eventsConfig` | Typed event declarations |
| `search.ts` | `searchConfig` | Search indexing config |
| `translations.ts` | `translatableFields` | Translatable fields per entity |
| `notifications.ts` | `notificationTypes` | Notification type definitions |
| `notifications.client.ts` | — | Client-side notification renderers |
| `notifications.handlers.ts` | `notificationHandlers` | Reactive notification side-effects |
| `data/entities.ts` | — | MikroORM entity classes |
| `data/validators.ts` | — | Zod validation schemas |
| `data/extensions.ts` | `extensions` | Entity extensions (cross-module links) |
| `data/enrichers.ts` | `enrichers` | Response enrichers |
| `api/interceptors.ts` | `interceptors` | API route interception hooks |
| `widgets/injection/` | — | Injected UI widgets |
| `widgets/injection-table.ts` | — | Widget-to-slot mappings |
| `widgets/components.ts` | `componentOverrides` | Component replacement/wrapper definitions |

## API Routes

Every API route file MUST export an `openApi` object:

```typescript
import { createCrudOpenApiFactory } from '@open-mercato/shared/lib/openapi/crud'
const buildOpenApi = createCrudOpenApiFactory({ defaultTag: 'MyModule' })

export const openApi = buildOpenApi({
  resourceName: 'Item',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createSchema, description: 'Create item' },
  update: { schema: updateSchema, responseSchema: okSchema },
  del: { schema: deleteSchema, responseSchema: okSchema },
})
```

### CRUD Routes with makeCrudRoute

Always set `indexer: { entityType }` for query index coverage:

```typescript
makeCrudRoute({
  entity: MyEntity,
  indexer: { entityType: 'my_module:my_entity' },
  enrichers: { entityId: 'my_module.my_entity' }, // opt-in to enrichers
  // ...
})
```

### Custom Write Routes

For non-CRUD write routes (`POST`/`PUT`/`PATCH`/`DELETE`), MUST wire mutation guards:
- Call `validateCrudMutationGuard` before mutation
- Call `runCrudMutationGuardAfterSuccess` after successful mutation

## Module Setup (`setup.ts`)

Required for tenant initialization:

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['my_module.admin_only'],
    admin: ['my_module.*'],
    employee: ['my_module.view'],
  },
  async onTenantCreated({ em, tenantId, organizationId }) { /* settings, sequences */ },
  async seedDefaults({ em, tenantId, container }) { /* dictionaries, statuses */ },
  async seedExamples({ em, tenantId, container }) { /* demo data */ },
}
```

## Events

Declare events in the emitting module's `events.ts`:

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'
const events = [
  { id: 'my_mod.item.created', label: 'Item Created', entity: 'item', category: 'crud' },
  { id: 'my_mod.item.updated', label: 'Item Updated', entity: 'item', category: 'crud' },
  { id: 'my_mod.item.deleted', label: 'Item Deleted', entity: 'item', category: 'crud' },
] as const
export const eventsConfig = createModuleEvents({ moduleId: 'my_mod', events })
export const emitMyModEvent = eventsConfig.emit
```

MUST use `as const` for type safety. Run `yarn generate` after adding.

### Subscribers

```typescript
// subscribers/item-created-notify.ts
export const metadata = { event: 'my_mod.item.created', persistent: true, id: 'item-created-notify' }
export default async function handler(payload, ctx) { /* one side effect per subscriber */ }
```

## Widget Injection

The preferred way to extend other modules' UI without direct coupling.

### Structure
- Widgets: `widgets/injection/<WidgetName>/widget.tsx` (or `widget.ts` for headless)
- Mapping: `widgets/injection-table.ts`

### Spot IDs
- `crud-form:<entityId>` — inject into forms
- `crud-form:<entityId>:fields` — inject form fields
- `data-table:<tableId>:columns|row-actions|bulk-actions|filters` — inject into tables
- `menu:sidebar:main|settings|profile` — sidebar menu items
- `menu:topbar:profile-dropdown|actions` — topbar items

### Menu Injection (Headless)
```typescript
// widgets/injection/MyMenuItem/widget.ts
export const menuItems = [
  { id: 'my-mod-dashboard', labelKey: 'my_mod.menu.dashboard', icon: 'lucide:layout-dashboard',
    href: '/backend/my-module', placement: { position: InjectionPosition.After, relativeTo: 'customers' } }
]
```

Map in `injection-table.ts`:
```typescript
export default [{ widgetId: 'MyMenuItem', spots: ['menu:sidebar:main'] }]
```

## Response Enrichers

Add computed fields to another module's CRUD responses:

```typescript
// data/enrichers.ts
export const enrichers: ResponseEnricher[] = [{
  id: 'my_mod.customer-stats',
  targetEntity: 'customers.person',
  features: ['my_mod.view'],
  priority: 10,
  timeout: 2000,
  fallback: { _my_mod: { count: 0 } },
  async enrichMany(records, ctx) {
    return records.map(r => ({ ...r, _my_mod: { count: 42 } }))
  },
}]
```

MUST implement `enrichMany()` for batch endpoints. MUST namespace with `_moduleName` prefix.

## API Interceptors

Hook into any route's before/after lifecycle:

```typescript
// api/interceptors.ts
export const interceptors: ApiInterceptor[] = [{
  id: 'my_mod.narrow-customers',
  targetRoute: '/api/customers/people',
  methods: ['GET'],
  async before(ctx) { /* rewrite query.ids to narrow results */ },
  async after(ctx, response) { /* transform response */ },
}]
```

## Access Control (RBAC)

Declare features in `acl.ts`, guard with metadata:

```typescript
// acl.ts
export const features = ['my_module.view', 'my_module.create', 'my_module.edit', 'my_module.delete']
```

Always add matching `defaultRoleFeatures` in `setup.ts`.

Use declarative guards in page metadata: `requireAuth`, `requireRoles`, `requireFeatures`.

## Custom Fields & Entities

Declare in `ce.ts` using DSL helpers:

```typescript
import { defineFields, cf } from '@open-mercato/shared/modules/dsl'
export const entities = [{
  entityId: 'my_module:my_entity',
  fields: defineFields({ fields: [cf.text('notes'), cf.number('priority')] }),
}]
```

## Entity Extensions (Cross-Module Links)

Extend another module's data without mutating their entities:

```typescript
// data/extensions.ts
import { defineLink, entityId, linkable } from '@open-mercato/shared/modules/dsl'
export const extensions = [
  defineLink({ source: entityId('my_module:my_entity'), target: linkable('customers:person') })
]
```

## Component Replacement

Override or wrap existing UI components:

```typescript
// widgets/components.ts
export const componentOverrides = [{
  handle: 'page:customers:detail',
  mode: 'wrapper', // or 'replace', 'props'
  component: MyCustomerDetailWrapper,
}]
```

Prefer `wrapper`/`props` modes over full `replace`.

## Command Pattern (Write Operations)

Implement writes via commands for undo/redo support:

```typescript
import { registerCommand } from '@open-mercato/shared/lib/commands'
// Reference: @open-mercato/core customers/commands/people.ts
```

Include `indexer: { entityType, cacheAliases }` in `emitCrudSideEffects` for query index refresh.

## Customer Accounts

The `customer_accounts` module provides customer-facing authentication, sessions, RBAC, and account management. App modules build on top of it to add portal features.

### Auth APIs

| Endpoint | Purpose |
|----------|---------|
| `POST /api/customer_accounts/login` | Email + password login, returns JWT + session cookies |
| `POST /api/customer_accounts/signup` | Self-registration |
| `POST /api/customer_accounts/magic-link/request` | Request passwordless login link |
| `POST /api/customer_accounts/magic-link/verify` | Verify magic link token |
| `POST /api/customer_accounts/password/reset-request` | Request password reset email |
| `POST /api/customer_accounts/password/reset-confirm` | Confirm password reset with token |
| `POST /api/customer_accounts/email/verify` | Verify email address |
| `POST /api/customer_accounts/invitations/accept` | Accept an invitation token |
| `POST /api/customer_accounts/portal/logout` | Clear customer session |
| `POST /api/customer_accounts/portal/sessions-refresh` | Refresh JWT from session token |
| `POST /api/customer_accounts/portal/password-change` | Change password (authenticated) |

### Server-Side Auth Check

Use `getCustomerAuthFromCookies` in server components and catch-all routes:

```typescript
import { getCustomerAuthFromCookies } from '@open-mercato/core/modules/customer_accounts/lib/customerAuthServer'

const auth = await getCustomerAuthFromCookies()
if (!auth) redirect(`/${orgSlug}/portal/login`)
// auth.sub, auth.email, auth.displayName, auth.resolvedFeatures, auth.customerEntityId
```

### Client-Side Auth

Use `useCustomerAuth` in portal client components:

```typescript
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'

const { user, roles, resolvedFeatures, isPortalAdmin, loading, logout } = useCustomerAuth(orgSlug)
```

### Customer RBAC

Declare `defaultCustomerRoleFeatures` in your module's `setup.ts` to auto-merge features into customer roles during tenant setup:

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultCustomerRoleFeatures: {
    buyer: ['portal.my_module.view', 'portal.my_module.create'],
    viewer: ['portal.my_module.view'],
  },
}
```

Built-in customer roles: `portal_admin` (full access), `buyer` (order/quote/catalog), `viewer` (read-only). Features merge additively on `seedDefaults`.

### Portal Page Auth Metadata

Guard portal pages declaratively via page metadata:

```typescript
// frontend/[orgSlug]/portal/my-feature/page.meta.ts
export const metadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.my_module.view'],
  navHidden: true,
}
```

### Events

Subscribe to customer account lifecycle events:

| Event ID | Category | Broadcast |
|----------|----------|-----------|
| `customer_accounts.user.created` | crud | `clientBroadcast` |
| `customer_accounts.user.updated` | crud | |
| `customer_accounts.user.deleted` | crud | |
| `customer_accounts.user.locked` | lifecycle | |
| `customer_accounts.user.unlocked` | lifecycle | |
| `customer_accounts.login.success` | lifecycle | |
| `customer_accounts.login.failed` | lifecycle | |
| `customer_accounts.email.verified` | lifecycle | |
| `customer_accounts.password.reset` | lifecycle | |
| `customer_accounts.invitation.accepted` | lifecycle | `clientBroadcast` |
| `customer_accounts.role.created` | crud | |
| `customer_accounts.role.updated` | crud | |
| `customer_accounts.role.deleted` | crud | |

```typescript
// subscribers/on-customer-signup.ts
export const metadata = { event: 'customer_accounts.user.created', persistent: true, id: 'my-mod-on-customer-signup' }
export default async function handler(payload, ctx) { /* welcome email, CRM sync, etc. */ }
```

### Extending Customer Data

Link your module's entities to `CustomerUser` via `data/extensions.ts`:

```typescript
import { defineLink, entityId, linkable } from '@open-mercato/shared/modules/dsl'
export const extensions = [
  defineLink({ source: entityId('my_module:preference'), target: linkable('customer_accounts:user') }),
]
```

Key entities: `CustomerUser` (customer_users), `CustomerRole` (customer_roles), `CustomerRoleAcl`, `CustomerUserRole`, `CustomerUserSession`, `CustomerUserInvitation`.

### Admin RBAC Features

Staff-side features for managing customer accounts:

| Feature | Purpose |
|---------|---------|
| `customer_accounts.view` | View customer accounts |
| `customer_accounts.manage` | Manage customer accounts |
| `customer_accounts.roles.manage` | Manage customer roles |
| `customer_accounts.invite` | Invite customer users |

## Portal Extension

Build customer-facing portal pages that integrate with the shared portal shell, navigation, and event bridge.

### Portal Feature Toggle

The portal is gated by the `portal_enabled` feature toggle (seeded by the `portal` module). When disabled, all portal routes show a "Portal not available" message.

### Portal Page Structure

Portal pages live at `frontend/[orgSlug]/portal/<feature>/page.tsx` and use the portal shell:

```typescript
'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'

export default function MyPortalPage({ params }: { params: { orgSlug: string } }) {
  const t = useT()
  const { auth } = usePortalContext()
  const { user, loading } = auth

  if (loading) return <Spinner />
  if (!user) return null

  return (
    <div className="flex flex-col gap-8">
      <PortalPageHeader label={t('my_mod.portal.label')} title={t('my_mod.portal.title')} />
      <PortalCard>
        <PortalCardHeader label="Section" title="Content" />
        {/* page content */}
      </PortalCard>
    </div>
  )
}
```

### Portal Menu Injection

Inject navigation items into portal chrome surfaces:

| Spot ID | Purpose |
|---------|---------|
| `menu:portal:sidebar:main` | Main portal navigation |
| `menu:portal:sidebar:account` | Account/settings section |
| `menu:portal:header:actions` | Header action buttons |
| `menu:portal:user-dropdown` | User dropdown items |

```typescript
// widgets/injection/PortalNavItem/widget.ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

export const menuItems = [{
  id: 'my-mod-portal-nav',
  labelKey: 'my_mod.portal.menu.label',
  icon: 'lucide:package',
  href: '/portal/my-feature',
  placement: { position: InjectionPosition.After, relativeTo: 'portal-dashboard' },
}]
```

Map in `widgets/injection-table.ts`:
```typescript
export default { 'menu:portal:sidebar:main': { widgetId: 'my_mod.injection.portal-nav', priority: 10 } }
```

### Portal Widget Injection Spots

Inject content into portal dashboard and pages:

| Spot ID | Purpose |
|---------|---------|
| `portal:dashboard:sections` | Dashboard section cards |
| `portal:dashboard:profile` | Dashboard profile area |
| `portal:dashboard:sidebar` | Dashboard sidebar |
| `portal:<pageId>:before` | Before any portal page content |
| `portal:<pageId>:after` | After any portal page content |

### Portal Event Bridge

Events with `portalBroadcast: true` stream to authenticated portal users via SSE at `/api/customer_accounts/portal/events/stream`.

Declare portal-broadcast events:
```typescript
// events.ts
const events = [
  { id: 'my_mod.item.status_changed', label: 'Item Status Changed', portalBroadcast: true },
] as const
```

Listen in portal components:
```typescript
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'

usePortalAppEvent('my_mod.item.status_changed', (event) => { refetch() })
```

Enable the bridge in PortalShell with `enableEventBridge` prop.

### Portal Component Replacement

Override portal shell sections via component replacement handles:

| Handle | Purpose |
|--------|---------|
| `page:portal:layout` | Entire portal shell |
| `section:portal:header` | Header bar |
| `section:portal:footer` | Footer |
| `section:portal:sidebar` | Navigation sidebar |
| `section:portal:user-menu` | User dropdown |
