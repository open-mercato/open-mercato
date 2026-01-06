# Feature Toggles Module

The **feature_toggles** module provides a system to manage feature usage across the application. It allows enabling or disabling features globally or selectively via overrides for specific tenants. This enables safe rollouts, A/B testing, and emergency kill switches.

## Entities

- **FeatureToggle** – Defines the global state of a feature (identifier, name, default state, fail mode).
- **FeatureToggleOverride** – Granular control linking a toggle to a specific tenant with a specific state (enabled/disabled).

MikroORM entities are defined in `data/entities.ts`.

## Validation

`data/validators.ts` provides Zod schemas for validation:

- **Toggle Schema** – Validates identifier formats (slug usage) and required fields for creating/updating toggles.
- **Override Schema** – Ensures overrides are correctly linked to valid toggles and tenants.

## Access Control

> [!IMPORTANT]
> **Super Admin Only**: This entire module is restricted to users with the Super Admin role.

## Internationalisation

The module uses `i18n/{en,pl,es,de}.json` for localizing UI elements.
Ensure all new UI components use translation keys instead of hardcoded strings.

## Frontend Integration

The module provides components and hooks to conditionally render UI based on feature flags:

- **FeatureGuard**: A component wrapper that renders children only if the feature is enabled.
- **useFeatureFlag**: A React hook for programmatic checks.

## CLI Commands

Manage feature toggles via the CLI for automation and seeding:

- `yarn mercato feature_toggles seed-defaults`: Load default toggles from a JSON file.
- `yarn mercato feature_toggles toggle-create`: Create a new global toggle.
- `yarn mercato feature_toggles toggle-update`: Update an existing toggle.
- `yarn mercato feature_toggles toggle-delete`: Delete a toggle.
- `yarn mercato feature_toggles override-set`: Set or update an override for a tenant.

## Configuration

The module's caching behavior is controlled via environment variables:

- `FEATURE_TOGGLES_CACHE_TTL_MS` (default: 60s)
- `FEATURE_TOGGLES_ERROR_CACHE_TTL_MS` (default: 10s)
- `FEATURE_TOGGLES_MISSING_TOGGLE_DEFAULT` (default: false)
