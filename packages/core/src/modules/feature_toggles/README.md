# Feature Toggles Module

The **feature_toggles** module provides a system to manage feature usage across the application. It allows enabling or disabling features globally or selectively via overrides for specific tenants. It supports multiple data types: **Boolean**, **String**, **Number**, and **JSON**.

## Entities

- **FeatureToggle** – Defines the global state of a feature.
  - `identifier`: Unique slug.
  - `name`: Human-readable name.
  - `type`: One of `boolean`, `string`, `number`, `json`.
  - `defaultValue`: The global default value (matches the type).
- **FeatureToggleOverride** – Granular control linking a toggle to a specific tenant.
  - `value`: The overridden value for that tenant (matches the toggle type).

MikroORM entities are defined in `data/entities.ts`.

## Validation

`data/validators.ts` provides Zod schemas for validation:

- **Toggle Schema** – Validates identifier formats (slug usage), types, and required fields.
- **Override Schema** – Ensures overrides are correctly linked and values match the toggle type.

## Access Control

> [!IMPORTANT]
> **Super Admin Only**: This entire module is restricted to users with the Super Admin role.

## Internationalisation

The module uses `i18n/{en,pl,es,de}.json` for localizing UI elements.
Ensure all new UI components use translation keys instead of hardcoded strings.

## Frontend Integration

The module provides components and hooks to conditionally render UI or retrieve configuration based on feature flags:

### Components

- **FeatureGuard**: A component wrapper strictly for **boolean** toggles. Renders children only if the feature is enabled (true).

### Hooks

Type-safe hooks are available for consuming feature flags:

- **`useFeatureFlagBoolean`**: Returns `{ enabled: boolean, isLoading: boolean }`.
- **`useFeatureFlagString`**: Returns `{ value: string | undefined, isLoading: boolean }`.
- **`useFeatureFlagNumber`**: Returns `{ value: number | undefined, isLoading: boolean }`.
- **`useFeatureFlagJson<T>`**: Returns `{ value: T | undefined, isLoading: boolean }`.

## CLI Commands

Manage feature toggles via the CLI. It supports all data types.

- `yarn mercato feature_toggles seed-defaults`: Load default toggles from a JSON file.
- `yarn mercato feature_toggles toggle-create`: Create a new global toggle.
  - Usage: `... --identifier <id> --name <name> --type <type> --defaultValue <value>`
- `yarn mercato feature_toggles toggle-update`: Update an existing toggle.
- `yarn mercato feature_toggles toggle-delete`: Delete a toggle.
- `yarn mercato feature_toggles override-set`: Set or update an override for a tenant.
  - Usage: `... --identifier <id> --tenantId <uuid> --value <value>`

