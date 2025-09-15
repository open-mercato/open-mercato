# Entity Extensions and Custom Fields

This doc outlines how modules extend each other’s data (without forking schemas) and how users add custom fields at runtime.

## Goals
- Keep modules isolated and upgrade-safe.
- Allow one module to add data to another module’s entity via separate extension entities.
- Allow end users to define custom fields (text/multiline/integer/float/boolean/select) per entity and filter by them.

## Module-to-Module Extensions
- Instead of modifying core entities, create a new entity in your module that links to the base entity.
- Declare the link in `src/modules/<module>/data/extensions.ts`:

```ts
import type { EntityExtension } from '@open-mercato/shared/modules/entities'

export const extensions: EntityExtension[] = [
  {
    base: 'auth:user',
    extension: 'my_module:user_profile',
    join: { baseKey: 'id', extensionKey: 'user_id' },
    cardinality: 'one-to-one',
    description: 'Adds profile fields to users',
  },
]
```

- Keep the extension entity in `data/entities.ts` of your module, with a FK to the base entity id.
- Generators include `entityExtensions` in `modules.generated.ts` for discovery.

## Custom Fields (EAV)
- Core module `custom_fields` ships two tables:
  - `custom_field_defs` — definitions (per entity id and organization)
  - `custom_field_values` — values (per entity record and organization)

- Modules can ship initial field sets in `data/fields.ts`:

```ts
import type { CustomFieldSet } from '@open-mercato/shared/modules/entities'

export const fieldSets: CustomFieldSet[] = [
  {
    entity: 'directory:organization',
    fields: [
      { key: 'industry', kind: 'select', options: ['SaaS','Retail','Agency'], filterable: true },
      { key: 'vip', kind: 'boolean', filterable: true },
    ],
    source: 'my_module',
  },
]
```

- Users will manage custom fields via an admin UI (next task). The UI will:
  - Let users pick an entity and define fields.
  - Enforce tenant scoping and basic validations.
  - Generate filters and form controls dynamically.

## Multi-tenant
- Definitions and values include `organization_id` and must be filtered by it when relevant.

## Validation and Types
- Base entities continue to use zod validators and MikroORM classes.
- Custom fields are validated dynamically based on their kind and options.

## Migrations
- Add your extension entity as normal.
- The `custom_fields` module migrations are generated like any other module.

