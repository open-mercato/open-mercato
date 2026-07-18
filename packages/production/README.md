# @open-mercato/production

Production planning module for SMB discrete manufacturing (MTO/MTS): versioned BOMs and routings, work centers, production orders with technology snapshots, a minimal production stock ledger, net MRP, and shop-floor reporting.

Spec: [`.ai/specs/2026-07-18-production-planning-module.md`](../../.ai/specs/2026-07-18-production-planning-module.md)

## Enabling

1. The module is wired in `apps/mercato/src/modules.ts` as `{ id: 'production', from: '@open-mercato/production' }`.
2. The entire surface is gated by the `production_enabled` feature toggle and is **disabled by default** (fail-closed). Enable it per tenant from **Backend → Feature Toggles** (create the boolean toggle `production_enabled` and set it to `true`, or add a per-tenant override).
3. Sync role grants for existing tenants: `yarn mercato auth sync-role-acls`.

## Roles

`setup.ts` seeds feature grants for: `admin` (all), `employee` (read-only), and the module-specific roles `technolog`, `planista`, `kierownik`, `magazynier-lite`, and `operator` (shop-floor surface only).
