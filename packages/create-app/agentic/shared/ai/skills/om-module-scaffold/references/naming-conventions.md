# Naming Conventions Quick Reference

## Module & Files

| Element | Convention | Example |
|---------|-----------|---------|
| Module ID | plural, snake_case | `fleet_vehicles`, `loyalty_points` |
| Module folder | same as module ID | `src/modules/fleet_vehicles/` |
| Entity class | PascalCase, singular | `FleetVehicle`, `LoyaltyPoint` |
| Entity file | PascalCase, singular | `entities/FleetVehicle.ts` |
| Table name | plural, snake_case | `fleet_vehicles`, `loyalty_points` |
| Column name | snake_case | `vehicle_type`, `point_balance` |

## Identifiers

| Element | Convention | Example |
|---------|-----------|---------|
| JS/TS fields | camelCase | `vehicleType`, `pointBalance` |
| Event ID | `module.entity.action` (dots, singular entity, past tense) | `fleet_vehicles.vehicle.created` |
| Feature ID | `module.action` | `fleet_vehicles.view`, `fleet_vehicles.create` |
| Enricher ID | `module.enricher-name` | `fleet_vehicles.maintenance-stats` |
| Widget ID | `module.injection.widget-name` | `fleet_vehicles.injection.status-column` |
| Interceptor ID | `module.interceptor-name` | `fleet_vehicles.validate-vin` |
| Guard ID | `module.guard-name` | `fleet_vehicles.mileage-limit` |

## Standard Entity Columns

Every tenant-scoped entity MUST include:

```typescript
id: string              // UUID v4 primary key
organization_id: string // Tenant organization (indexed)
tenant_id: string       // Tenant ID (indexed)
is_active: boolean      // Soft active flag (default: true)
created_at: Date        // Creation timestamp
updated_at: Date        // Last update timestamp (auto-updated)
deleted_at: Date | null // Soft delete timestamp
```

## API Routes

| Method | File Path | URL |
|--------|----------|-----|
| GET | `api/get/<entities>.ts` | `GET /api/<module>/<entities>` |
| POST | `api/post/<entities>.ts` | `POST /api/<module>/<entities>` |
| PUT | `api/put/<entities>.ts` | `PUT /api/<module>/<entities>` |
| DELETE | `api/delete/<entities>.ts` | `DELETE /api/<module>/<entities>` |

## Backend Pages

| File Path | URL |
|----------|-----|
| `backend/page.tsx` | `/backend/<module>` |
| `backend/<entities>/new.tsx` | `/backend/<module>/<entities>/new` |
| `backend/<entities>/[id].tsx` | `/backend/<module>/<entities>/<id>` |

## Cross-Module References

- Store as `uuid` FK field: `customer_id`, `order_id`
- Never use `@ManyToOne` / `@OneToMany` decorators across modules
- Fetch related data via separate API calls or enrichers
