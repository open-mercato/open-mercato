Custom Fields module: stores dynamic field definitions and values (EAV) for any entity.

Overview
- Two tables:
  - `custom_field_defs` — field definitions (per entity id, organization, tenant)
  - `custom_field_values` — field values (per record, organization, tenant)
- The query layer can project and filter custom fields using `cf:<key>` selectors.

Admin UI (Entities)
- Navigate: Backend → Data designer → System/User Entities
- List shows all entities (code-defined and custom/virtual) with a field count.
- Actions:
  - Create Entity: creates a virtual entity entry so admins can attach fields.
  - Edit: manage per-field definitions for the selected entity.
- Edit screen:
  - Entity Settings (label, description).
  - Field Definitions below in a wide, two-row layout.
    - Per-field options depend on `kind` (text, multiline, integer, float, boolean, select, relation).
    - For text/multiline, you can set a per-field editor hint via `editor` (markdown | simpleMarkdown | htmlRichText).
    - For select: static `options`, optional `optionsUrl`, `multi`.
    - For relation: `relatedEntityId`, `optionsUrl`, `multi`.
  - Deleting the entity definition is allowed only for custom (virtual) entities; code-defined entity entries cannot be removed from the UI.

APIs (selected)
- GET `/api/entities/definitions?entityId=<id>` → returns normalized definitions used by UI and forms.
- POST `/api/entities/definitions` → upsert a definition (admin-only, scoped by org/tenant).
- POST `/api/entities/definitions.batch` → upsert many definitions in one transaction (admin-only).
- DELETE `/api/entities/definitions` → soft-deactivate a definition (admin-only).
- GET `/api/entities/entities` → list entities (code + custom) for the admin UI.
- POST `/api/entities/entities` → upsert a virtual entity’s label/description (admin-only).
- DELETE `/api/entities/entities` → soft-delete a virtual entity (admin-only).
- GET `/api/entities/relations/options?entityId=<id>&labelField=<name>&q=<query>` → list options for relation fields.

Registering virtual entities (for module developers)
- From code (e.g., CLI or module init) call the helper to ensure a “virtual” entity exists:

```
import { upsertCustomEntity } from '@open-mercato/core/modules/entities/lib/register'

await upsertCustomEntity(em, 'example:calendar_entity', {
  label: 'Calendar Entity',
  description: 'Events and availability',
  organizationId: null, // optional
  tenantId: null,       // optional
})
```

- From a module DI registrar (on boot):

```
import type { AppContainer } from '@/lib/di/container'
import { upsertCustomEntity } from '@open-mercato/core/modules/entities/lib/register'

let registered = false
export function register(container: AppContainer) {
  if (registered) return
  registered = true
  ;(async () => {
    const em = container.resolve('em') as any
    await upsertCustomEntity(em, 'example:calendar_entity', { label: 'Calendar Entity' })
  })().catch(() => {})
}
```

Validation & security
- All inputs validated with zod; admin APIs require `admin` role.
- Multi-tenant rules enforced; do not expose cross-tenant data.

UI integration tips
- In client components, prefer `apiCall` helpers (from `@open-mercato/ui/backend/utils/apiCall`) instead of the global `fetch`.
- When building forms with CrudForm, pass `entityId` to auto-append custom fields, or call `fetchCustomFieldFormFields(entityId)`.

Migrations
- Run `npm run db:migrate` after enabling modules or changing this module.
- Generators and module registry are updated by `npm run modules:prepare`.
