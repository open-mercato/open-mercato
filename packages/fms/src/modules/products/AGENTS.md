# Products Module

This module manages freight shipping services and fees for quotation, orders, and price tracking.

Products are **reusable catalog items** with time-based pricing that get referenced across multiple quotes.

## Example Use Case

```
QUOTE:
    - MSC SHA-GDN
        - freight 2000 $      ← Product: GFRT charge
        - BAF      300 $      ← Product: GBAF charge
        - THC SHA  100 $      ← Product: GTHC charge (origin)
        - THC GDN  200 $      ← Product: GTHC charge (destination)
    - Customs Agency Gdańsk 100 $ ← Product: GCUS charge
    - Bill of lading 50 $    ← Product: GBOL charge
```

## Implementation Status

### ✅ Phase 1: Entity Layer with STI (COMPLETED)

#### Files Created/Updated:
1. **`data/types.ts`** - TypeScript types and enums
   - `ChargeUnit`: `per_container` | `per_piece` | `one_time`
   - `ContractType`: `SPOT` | `NAC` | `BASKET`
   - `ProductType`: Discriminator enum for STI (GFRT, GBAF, GTHC, GCUS, etc.)
   - `VariantType`: Discriminator enum for variants (container, simple)
   - `ChargeCodeFieldSchema`: JSONB schema definition

2. **`data/entities.ts`** - 4 base entities + 9 subclasses (STI)
   - `FmsChargeCode`: Dictionary of charge types (system + custom)
   - **`FmsProduct` (abstract)**: Base class with STI discriminator
     - `FreightProduct` (GFRT): Typed fields for freight
     - `THCProduct` (GTHC): Typed fields for terminal handling
     - `CustomsProduct` (GCUS): Typed fields for customs
     - `BAFProduct`, `BAFPieceProduct`, `BOLProduct`: Simple products
     - `CustomProduct`: For user-defined charge codes
   - **`FmsProductVariant` (abstract)**: Base class with STI discriminator
     - `ContainerVariant`: Typed fields for container specs
     - `SimpleVariant`: For non-container products
   - `FmsProductPrice`: Time-bound, contract-based pricing

3. **`data/validators.ts`** - Type-specific Zod validation schemas
   - Product type validators for each subclass
   - Variant type validators (container, simple)
   - Query/filter validators

4. **`lib/productFactory.ts`** - Factory functions for product creation
   - `createProductInstance(productType)`: Create typed product instances
   - `createVariantInstance(variantType)`: Create typed variant instances
   - `getProductTypeFromChargeCode(em, id)`: Determine type from charge code
   - `getVariantTypeForProduct(product)`: Auto-detect variant type

5. **`lib/seeds.ts`** - System charge codes (6 default codes)
   - GFRT, GBAF, GBAF_PIECE, GBOL, GTHC, GCUS

6. **`migrations/Migration20260109000000_AddProductSTI.ts`** - STI refactoring migration
   - Add discriminator columns
   - Add typed columns for each product type
   - Migrate JSONB data to typed columns
   - Add partial indexes
   - Drop old JSONB columns
   - Auto-validation

### 🔄 Next Steps (TODO)

1. **Apply migrations**: Run `npm run db:migrate` from project root
2. **Create seed CLI**: Command to populate system charge codes
3. **Create services**: ProductService, ChargeCodeService for business logic
4. **Create API routes**: CRUD endpoints with `makeCrudRoute`
5. **Add ACL**: Define features in `acl.ts`
6. **Build UI**: List/detail pages with DataTable + drawers
7. **Add i18n**: Translation files for all labels

---

## Entity Relationships

```
FmsChargeCode (Dictionary)
    ↓ (1:N)
FmsProduct (Abstract Base - STI)
    ├── FreightProduct (GFRT)
    ├── THCProduct (GTHC)
    ├── CustomsProduct (GCUS)
    ├── BAFProduct, BAFPieceProduct, BOLProduct
    └── CustomProduct (user-defined)
    ↓ (1:N)
FmsProductVariant (Abstract Base - STI)
    ├── ContainerVariant (for GFRT, GTHC)
    └── SimpleVariant (for others)
    ↓ (1:N)
FmsProductPrice (Time-bound Price)
```

---

## Key Design Decisions

### 1. Product Reusability ✅
- Products are **catalog items** reused across multiple quotes
- Not created per-quote; maintained as a shared product catalog
- Price history tracked via multiple `FmsProductPrice` records

### 2. Contractor Integration ✅
- **Module isomorphism**: No `@ManyToOne` relationships to contractors module
- Uses UUID foreign key references only: `contractorId`, `providerContractorId`
- Contractor data fetched separately via application logic

### 3. Charge Code Flexibility ✅
- **System codes**: 6 predefined codes (GFRT, GBAF, GBAF_PIECE, GBOL, GTHC, GCUS)
- **Custom codes**: Users can create additional charge codes (`is_system = false`)
- **Field schema**: JSONB defines type-specific fields per charge code

### 4. Auto-Default Variants ✅
- Products without explicit variants auto-create a "Default" variant
- Simple products (BAF, B/L, Customs) use default variants
- Complex products (Freight, THC) have explicit variants (40HC, 20GP, etc.)

### 5. Price Selection (Manual) ✅
- **Manual selection** via UI search/tooltip
- Sorted by contract type (NAC > BASKET > SPOT) and date
- Multiple prices can exist for same period if different contract types
- Overlapping validity periods **allowed** across contract types
- Overlapping periods **prevented** within same contract type (via exclusion constraint)

### 6. Single Table Inheritance (STI) ✅
- **Type Safety**: Each product type has its own class with typed fields
- **No JSONB**: Type-specific data stored in proper typed columns
- **Discriminators**: `product_type` and `variant_type` columns
- **Examples**:
  - `FreightProduct`: `loop`, `source`, `destination`, `transitTime` (typed fields)
  - `THCProduct`: `location`, `chargeType` (typed fields)
  - `CustomsProduct`: `location`, `serviceType` (typed fields)
  - `BAFProduct`: No additional fields beyond base
- **Factory Pattern**: Use `createProductInstance(type)` to create typed instances
- **Custom Products**: User-defined charge codes use `CustomProduct` class

---

## Database Schema

### FmsChargeCode
```
Table: fms_charge_codes

Fields (15):
- id, organization_id, tenant_id
- code (unique per org/tenant)
- name, description
- charge_unit (per_container | per_piece | one_time)
- field_schema (JSONB)
- sort_order, is_system, is_active
- created_at, created_by, updated_at, updated_by, deleted_at

Relationships:
- OneToMany → FmsProduct
```

### FmsProduct (STI - Single Table)
```
Table: fms_products

Common Fields (13):
- id, organization_id, tenant_id
- product_type (discriminator: GFRT, GBAF, GTHC, GCUS, GBOL, GBAF_PIECE, CUSTOM)
- name
- charge_code_id (FK to FmsChargeCode)
- contractor_id (UUID reference, not FK)
- description, internal_notes
- is_active
- created_at, created_by, updated_at, updated_by, deleted_at

GFRT-specific Fields:
- loop, source, destination, transit_time

GTHC-specific Fields:
- location, charge_type

GCUS-specific Fields:
- location, service_type

Indexes:
- fms_products_type_idx (product_type)
- fms_products_freight_route_idx (source, destination) WHERE product_type='GFRT'
- fms_products_freight_loop_idx (loop) WHERE product_type='GFRT'
- fms_products_location_idx (location) WHERE product_type IN ('GTHC','GCUS')

Relationships:
- ManyToOne → FmsChargeCode
- OneToMany → FmsProductVariant

Class Hierarchy:
- FmsProduct (abstract)
  ├── FreightProduct (GFRT)
  ├── THCProduct (GTHC)
  ├── CustomsProduct (GCUS)
  ├── BAFProduct (GBAF)
  ├── BAFPieceProduct (GBAF_PIECE)
  ├── BOLProduct (GBOL)
  └── CustomProduct (CUSTOM)
```

### FmsProductVariant (STI - Single Table)
```
Table: fms_product_variants

Common Fields (11):
- id, organization_id, tenant_id
- variant_type (discriminator: container, simple)
- product_id (FK to FmsProduct)
- provider_contractor_id (UUID reference, not FK)
- name
- is_default, is_active
- created_at, created_by, updated_at, updated_by, deleted_at

Container-specific Fields:
- container_size, container_type, weight_limit, weight_unit

Indexes:
- fms_product_variants_type_idx (variant_type)
- fms_variants_container_size_idx (container_size) WHERE variant_type='container'

Relationships:
- ManyToOne → FmsProduct
- OneToMany → FmsProductPrice

Class Hierarchy:
- FmsProductVariant (abstract)
  ├── ContainerVariant (container)
  └── SimpleVariant (simple)
```

### FmsProductPrice
```
Table: fms_product_prices

Fields (13):
- id, organization_id, tenant_id
- variant_id (FK to FmsProductVariant)
- validity_start, validity_end (date range)
- contract_type (SPOT | NAC | BASKET)
- contract_number
- price (numeric 18,2), currency_code
- is_active
- created_at, created_by, updated_at, updated_by, deleted_at

Relationships:
- ManyToOne → FmsProductVariant

Exclusion Constraint (TODO in migration):
- Prevent overlapping validity periods for same variant + contract_type
```

---

## System Charge Codes (Seeded)

| Code | Name | Charge Unit | Field Schema |
|------|------|-------------|--------------|
| GFRT | Freight Container | per_container | loop, source, destination, transitTime |
| GBAF | BAF (Container) | per_container | (none) |
| GBAF_PIECE | BAF (Piece) | per_piece | (none) |
| GBOL | B/L (Bill of Lading) | one_time | (none) |
| GTHC | Terminal Handling Charge | per_container | location, chargeType |
| GCUS | Customs Clearance | one_time | location, serviceType |

---

## Example Product Data

### Product: MSC SHA-GDN Freight (FreightProduct)
```typescript
import { FreightProduct } from './data/entities.js'
import { createProductInstance } from './lib/productFactory.js'

// Using factory
const product = createProductInstance('GFRT') as FreightProduct
product.name = "MSC/SWAN/FCL SHA-GDN"
product.loop = "MSC SWAN"
product.source = "SHA"
product.destination = "GDN"
product.transitTime = 54
product.contractorId = "msc-uuid"

// Direct instantiation
const product2 = new FreightProduct()
product2.name = "MSC/SWAN/FCL SHA-GDN"
product2.loop = "MSC SWAN"
product2.source = "SHA"
product2.destination = "GDN"
product2.transitTime = 54
```

### Variant: 40HC Container (ContainerVariant)
```typescript
import { ContainerVariant } from './data/entities.js'
import { createVariantInstance } from './lib/productFactory.js'

// Using factory
const variant = createVariantInstance('container') as ContainerVariant
variant.name = "40HC"
variant.containerSize = "40HC"
variant.containerType = "HIGH_CUBE"
variant.providerContractorId = "apex-logis-uuid"

// Direct instantiation
const variant2 = new ContainerVariant()
variant2.containerSize = "40HC"
variant2.containerType = "HIGH_CUBE"
```

### Price: NAC Contract
```typescript
{
  id: "uuid",
  variantId: "variant-uuid",
  validityStart: "2026-01-08",
  validityEnd: "2026-12-31",
  contractType: "NAC",
  contractNumber: "MSKPEPCO213324",
  price: "2000.00",
  currencyCode: "USD"
}
```

---

## Validation Rules

1. **Charge Code Deletion**: System codes (`is_system = true`) cannot be deleted
2. **Type-Specific Data**: Must validate against charge code's `field_schema` before save
3. **Price Validity**: `validity_end >= validity_start` when both provided
4. **Price Overlaps**: Exclusion constraint prevents overlaps within same contract type
5. **Contractor References**: Validate existence at application level (no DB FK)
6. **Currency Codes**: Must be valid ISO 4217 (3 uppercase letters)
7. **Charge Code Format**: Uppercase letters and underscores only (e.g., `GBAF_PIECE`)

---

## Architecture Notes

### Multi-Tenancy
- All entities scoped by `organization_id` and `tenant_id`
- Indexes include tenant scope for performance
- Soft delete via `deleted_at` for audit trail

### Audit Trail
- Full audit: `created_at`, `created_by`, `updated_at`, `updated_by` on all entities
- Tracks who made changes and when
- `created_by`/`updated_by` are UUID strings (module isomorphism - no FK to User)

### Single Table Inheritance (STI)
- **Discriminator columns**: `product_type`, `variant_type`
- **Type-safe**: Each subclass has typed properties
- **Factory pattern**: Use factory functions for consistent instance creation
- **Partial indexes**: Optimized queries for type-specific fields
- **Migration**: Automatic data migration from JSONB to typed columns

### Module Isomorphism
- **No cross-module FK constraints**: Contractor IDs stored as UUIDs only
- **Separate queries**: Fetch contractor data separately when needed
- **Independence**: Products module can be developed/tested independently

---

## Price Selection Algorithm (For Future UI/Service)

When building a quote, price selection works as follows:

```typescript
// Pseudo-code for price selection
function selectPrice(variantId: string, date: Date, preferredContractType?: ContractType) {
  const prices = await findPrices({
    variantId,
    isActive: true,
    validityStart: { $lte: date },
    $or: [
      { validityEnd: null },
      { validityEnd: { $gte: date } }
    ]
  })
  
  // Sort by contract type priority, then by date
  const contractTypePriority = { NAC: 1, BASKET: 2, SPOT: 3 }
  
  prices.sort((a, b) => {
    const priorityDiff = contractTypePriority[a.contractType] - contractTypePriority[b.contractType]
    if (priorityDiff !== 0) return priorityDiff
    return b.validityStart.getTime() - a.validityStart.getTime() // Most recent first
  })
  
  // Return sorted list for manual selection in UI
  return prices
}
```

---

## Related Modules

- **`fms_contractors`**: Service providers (MSC, customs agencies, terminal operators)
- **`quotations`** (future): Will reference products and selected prices
- **`orders`** (future): Will reference finalized quotes with locked-in prices

---

## Additional Charge Codes (Future)

Common freight charges that can be added as custom codes:

- **GDOC**: Documentation Fee
- **GSEC**: Security Surcharge
- **GEAS**: Emergency Adjustment Surcharge
- **GPSS**: Peak Season Surcharge
- **GCAF**: Currency Adjustment Factor
- **GISF**: IMO Surcharge (hazardous goods)
- **GDDT**: Demurrage/Detention (per day)
- **GEXW**: Warehouse/CFS Handling
- **GTRU**: Trucking/Haulage (inland transport)

Users can create these as needed via the charge code management UI.
