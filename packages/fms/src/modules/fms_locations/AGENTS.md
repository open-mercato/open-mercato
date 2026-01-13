# Locations Module

This module manages port and terminal locations for freight management using Single Table Inheritance (STI).

Locations are **reference data** used by products and other FMS entities to specify origin/destination points.

## Entity Structure (STI)

```
FmsLocation (Abstract Base - STI)
    ├── FmsPort (discriminator: 'port')
    │   └── terminals: Collection<FmsTerminal>
    └── FmsTerminal (discriminator: 'terminal')
        └── port: FmsPort (ManyToOne)
```

## Implementation Status

### Phase 1: Entity Layer with STI (COMPLETED)

#### Files Created/Updated

1. **`data/types.ts`** - TypeScript types
   - `LocationType`: `'port' | 'terminal'`
   - `Quadrant`: `'NE' | 'NW' | 'SE' | 'SW'`
   - `IFmsLocation`: Base interface for STI
   - `IFmsPort`, `IFmsTerminal`: Type-specific interfaces

2. **`data/entities.ts`** - MikroORM entities with STI
   - `FmsLocation` (abstract): Base class with discriminator column `product_type`
   - `FmsPort`: Port entity (discriminator value: 'port')
   - `FmsTerminal`: Terminal entity (discriminator value: 'terminal')

3. **`data/validators.ts`** - Zod validation schemas
   - `createPortSchema`, `updatePortSchema`
   - `createTerminalSchema`, `updateTerminalSchema`
   - `portFilterSchema`, `terminalFilterSchema`
   - `importLocationSchema`

4. **`lib/seeds.ts`** - Sample data seeding
   - `seedLocations()`: Seed all sample ports and terminals
   - `seedPort()`: Seed a single port with terminals

5. **`lib/utils.ts`** - Utility functions
   - `isValidLocationCode()`, `formatLocationCode()`
   - `getPortCodeFromTerminalCode()`, `generateTerminalCode()`
   - `isValidQuadrant()`, `getQuadrantValues()`, `getQuadrantLabel()`

### Phase 2: API Layer (COMPLETED)

#### API Routes

1. **`api/ports/route.ts`** - Ports CRUD
   - GET: List ports with filtering, pagination, sorting
   - POST: Create port
   - PUT: Update port
   - DELETE: Soft delete port

2. **`api/ports/[id]/route.ts`** - Port detail operations
   - GET: Fetch single port with terminals
   - PUT: Update specific port
   - DELETE: Soft delete port

3. **`api/terminals/route.ts`** - Terminals CRUD
   - GET: List terminals with filtering by portId
   - POST: Create terminal
   - PUT: Update terminal
   - DELETE: Soft delete terminal

4. **`api/terminals/[id]/route.ts`** - Terminal detail operations
   - GET: Fetch single terminal with port
   - PUT: Update specific terminal
   - DELETE: Soft delete terminal

5. **`api/table-config/route.ts`** - Dynamic table configuration
   - GET: Generate table column config from entity metadata

### Phase 3: UI Layer (COMPLETED)

#### Backend Pages

1. **`backend/fms-locations/page.tsx`** - Ports list view
   - DynamicTable with inline editing
   - Search, filtering, sorting, pagination
   - Perspectives support
   - Create port drawer

2. **`backend/fms-locations/page.meta.ts`** - Page metadata
   - Auth requirements
   - Navigation config
   - Icon and breadcrumb

#### Components

1. **`components/PortDrawer.tsx`** - Create port form
2. **`components/TerminalDrawer.tsx`** - Create terminal form
3. **`components/useTableConfig.tsx`** - Table config hook

### Phase 4: ACL & Module Config (COMPLETED)

1. **`acl.ts`** - Feature permissions
   - `fms_locations.ports.view`
   - `fms_locations.ports.manage`
   - `fms_locations.terminals.view`
   - `fms_locations.terminals.manage`

2. **`index.ts`** - Module metadata and exports

---

## Database Schema

### Single Table: fms_locations

```
Table: fms_locations

Fields:
- id (uuid, PK)
- organization_id (uuid)
- tenant_id (uuid)
- product_type (text) - discriminator: 'port' | 'terminal'
- code (text)
- name (text)
- quadrant (text) - 'NE' | 'NW' | 'SE' | 'SW'
- port_id (uuid, FK, nullable) - only for terminals
- created_at (timestamp)
- created_by (uuid, nullable)
- updated_at (timestamp)
- updated_by (uuid, nullable)
- deleted_at (timestamp, nullable)

Indexes:
- fms_locations_scope_idx (organization_id, tenant_id)

Constraints:
- fms_locations_unique (organization_id, tenant_id, code)
```

---

## API Endpoints

| Method | Endpoint | Description | Feature Required |
|--------|----------|-------------|------------------|
| GET | /api/fms_locations/ports | List ports | fms_locations.ports.view |
| POST | /api/fms_locations/ports | Create port | fms_locations.ports.manage |
| GET | /api/fms_locations/ports/:id | Get port | fms_locations.ports.view |
| PUT | /api/fms_locations/ports/:id | Update port | fms_locations.ports.manage |
| DELETE | /api/fms_locations/ports/:id | Delete port | fms_locations.ports.manage |
| GET | /api/fms_locations/terminals | List terminals | fms_locations.terminals.view |
| POST | /api/fms_locations/terminals | Create terminal | fms_locations.terminals.manage |
| GET | /api/fms_locations/terminals/:id | Get terminal | fms_locations.terminals.view |
| PUT | /api/fms_locations/terminals/:id | Update terminal | fms_locations.terminals.manage |
| DELETE | /api/fms_locations/terminals/:id | Delete terminal | fms_locations.terminals.manage |
| GET | /api/fms_locations/table-config | Get table config | fms_locations.ports.view |

---

## Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `code` | text | Unique location code (e.g., 'PLGDN', 'PLGDN-DCT') |
| `name` | text | Human-readable name |
| `quadrant` | enum | Geographic quadrant (NE, NW, SE, SW) |
| `port_id` | uuid | Parent port reference (terminals only) |

---

## Usage Examples

### Creating a Port via API

```typescript
const response = await fetch('/api/fms_locations/ports', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: 'PLGDN',
    name: 'Port of Gdansk',
    quadrant: 'NE',
  }),
})
```

### Creating a Terminal via API

```typescript
const response = await fetch('/api/fms_locations/terminals', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    portId: 'port-uuid',
    code: 'PLGDN-DCT',
    name: 'Baltic Hub (DCT Gdansk)',
    quadrant: 'NE',
  }),
})
```

### Querying Ports

```typescript
// List all ports
const ports = await fetch('/api/fms_locations/ports?limit=50&sortField=code&sortDir=asc')

// Search ports
const search = await fetch('/api/fms_locations/ports?q=gdansk')

// Filter by quadrant
const filtered = await fetch('/api/fms_locations/ports?quadrant=NE')
```

### Querying Terminals

```typescript
// List terminals for a port
const terminals = await fetch('/api/fms_locations/terminals?portId=port-uuid')

// Search terminals
const search = await fetch('/api/fms_locations/terminals?q=baltic')
```

---

## Validation Rules

1. **Code Uniqueness**: Codes must be unique per `organizationId + tenantId`
2. **Code Format**: Alphanumeric with hyphens and underscores only
3. **Terminal Port**: Terminals must reference a valid port
4. **Quadrant Values**: Must be one of NE, NW, SE, SW

---

## Related Modules

- **`fms_products`**: References locations in freight products (source/destination)
- **`fms_contractors`**: Terminal operators and port authorities
- **`fms_quotes`**: Quotes reference origin/destination ports
