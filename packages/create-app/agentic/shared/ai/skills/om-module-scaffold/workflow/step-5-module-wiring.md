# Step 5 — Module Metadata, ACL, DI & Events

## 7. Add Module Metadata

**File**: `src/modules/<module_id>/index.ts`

```typescript
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: '<module_id>',
  title: '<Module Name>',
  version: '0.1.0',
  description: '<What this module does>',
}

export { features } from './acl'
```

---

## 8. Add ACL & Setup

### ACL Features

**File**: `src/modules/<module_id>/acl.ts`

```typescript
export const features = [
  { id: '<module_id>.<entity>.view',   title: 'View <entities>',   module: '<module_id>' },
  { id: '<module_id>.<entity>.manage', title: 'Manage <entities>', module: '<module_id>' },
]

export default features
```

### Setup (Tenant Init + Default Roles)

**File**: `src/modules/<module_id>/setup.ts`

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['<module_id>.<entity>.view', '<module_id>.<entity>.manage'],
    admin:      ['<module_id>.<entity>.view', '<module_id>.<entity>.manage'],
    user:       ['<module_id>.<entity>.view'],
  },
}

export default setup
```

### Rules

- Feature IDs follow `<module_id>.<entity>.<action>` (view / manage per entity, not global create/update/delete)
- Add `export default features` — the generator reads `.default ?? .features` with an empty fallback, so the named export alone works, but adding the default export ensures both import styles resolve cleanly
- MUST declare `defaultRoleFeatures` for every feature in `acl.ts`
- Feature IDs are FROZEN once deployed — cannot rename without data migration
- After adding features run `yarn mercato auth sync-role-acls` so existing tenants receive the grants

---

## 9. Add DI Registration

**File**: `src/modules/<module_id>/di.ts`

```typescript
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export function register(container: AppContainer): void {
  // Register module services here using Awilix
  // Example:
  // import { asFunction } from 'awilix'
  // container.register({
  //   <module_id>Service: asFunction(createService).scoped(),
  // })
}
```

---

## 10. Add Events

**File**: `src/modules/<module_id>/events.ts`

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: '<module_id>.<entity>.created', label: '<Entity> Created', entity: '<entity>', category: 'crud' as const },
  { id: '<module_id>.<entity>.updated', label: '<Entity> Updated', entity: '<entity>', category: 'crud' as const },
  { id: '<module_id>.<entity>.deleted', label: '<Entity> Deleted', entity: '<entity>', category: 'crud' as const },
] as const

export const eventsConfig = createModuleEvents({ moduleId: '<module_id>', events })
export const emit<Module>Event = eventsConfig.emit
export type <Module>EventId = typeof events[number]['id']
export default eventsConfig
```

### Event Rules

- `createModuleEvents` takes `{ moduleId, events }` — NOT a flat keyed object. Using the old keyed-object shape crashes `/login` at startup because the generated events registry cannot read the module
- Event IDs: `module.entity.action` (singular entity, past tense action, dots as separators)
- Declare `label`, `entity`, and `category` on each event — they populate the workflow trigger UI
- Add `clientBroadcast: true` to an event definition to bridge it to the browser via SSE
- Event ID contracts are FROZEN once deployed — adding new events is safe; renaming or removing is a breaking change
