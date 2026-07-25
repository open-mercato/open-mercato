# Naming Conventions Quick Reference

> **Source of truth:** `AGENTS.md` (Naming Conventions / Conventions, Architecture Rules, Multi-tenant scoping) owns these rules. This file is an example-oriented cheat sheet for scaffolding — when it disagrees with `AGENTS.md`, `AGENTS.md` wins.

## Module & Files

| Element | Convention | Example |
|---------|-----------|---------|
| Module ID | plural, snake_case | `fleet_vehicles`, `loyalty_points` |
| Module folder | same as module ID | `src/modules/fleet_vehicles/` |
| Entity class | PascalCase, singular | `FleetVehicle`, `LoyaltyPoint` |
| Entity file | single `data/entities.ts` (one class per entity) | `data/entities.ts` → `class FleetVehicle` |
| Table name | plural, snake_case | `fleet_vehicles`, `loyalty_points` |
| Column name | snake_case | `vehicle_type`, `point_balance` |

## Identifiers

| Element | Convention | Example |
|---------|-----------|---------|
| JS/TS fields | camelCase | `vehicleType`, `pointBalance` |
| Event ID | `module.entity.action` (dots, singular entity, past tense) | `fleet_vehicles.vehicle.created` |
| Feature ID | `module.entity.action` (per-entity; use `view` / `manage`) | `fleet_vehicles.vehicle.view`, `fleet_vehicles.vehicle.manage` |
| Enricher ID | `module.enricher-name` | `fleet_vehicles.maintenance-stats` |
| Widget ID | `module.injection.widget-name` | `fleet_vehicles.injection.status-column` |
| Interceptor ID | `module.interceptor-name` | `fleet_vehicles.validate-vin` |
| Guard ID | `module.guard-name` | `fleet_vehicles.mileage-limit` |

## Standard Entity Columns

Every tenant-scoped entity MUST carry the standard columns (`id`, `organization_id`, `tenant_id`, `is_active`, `created_at`, `updated_at`, `deleted_at`) with `organization_id`/`tenant_id` indexed. See `AGENTS.md` → Conventions / Multi-tenant scoping for the authoritative list and types.

## API Routes

All HTTP methods live in a **single** `api/<entities>/route.ts` that exports named handlers `{ GET, POST, PUT, DELETE }` + `metadata` + `openApi` (not separate `api/get/`, `api/post/` files).

| File Path | Methods | URL |
|-----------|---------|-----|
| `api/<entities>/route.ts` | `GET` / `POST` / `PUT` / `DELETE` | `/api/<module>/<entities>` |

## Backend Pages

| File Path | URL |
|----------|-----|
| `backend/page.tsx` | `/backend/<module>` |
| `backend/<entities>/new.tsx` | `/backend/<module>/<entities>/new` |
| `backend/<entities>/[id].tsx` | `/backend/<module>/<entities>/<id>` |

## Cross-Module References

Store cross-module links as `uuid` FK fields (`customer_id`, `order_id`) and fetch related data via separate API calls or enrichers — never `@ManyToOne` / `@OneToMany` decorators across modules. See `AGENTS.md` → Architecture Rules for the authoritative rule.
