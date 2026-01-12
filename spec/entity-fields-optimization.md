# Entity Fields Generation Optimization

This document analyzes the current entity field file generation and proposes an optimization to reduce the number of generated files.

## Current State

The `generate-entity-ids.ts` script generates entity field constants in the following structure:

```
packages/core/generated/entities/
├── sales_order/
│   ├── index.ts           # Named exports: export const id = 'id'
│   ├── id.ts              # Default export: export default 'id'
│   ├── order_number.ts    # Default export: export default 'order_number'
│   ├── created_at.ts      # ...
│   └── ... (one file per field)
├── customer/
│   ├── index.ts
│   ├── id.ts
│   └── ...
└── ... (one folder per entity)
```

### File Counts (as of analysis)

| Package | Entity Folders | Index Files | Individual Field Files | Total Files |
|---------|---------------|-------------|----------------------|-------------|
| `packages/core/generated/entities/` | 93 | 93 | ~1,350 | ~1,440 |
| `packages/example/generated/entities/` | 2 | 2 | 12 | 14 |
| `packages/onboarding/generated/entities/` | 1 | 1 | 19 | 20 |
| **Total** | **96** | **96** | **~1,380** | **~1,474** |

Additionally, an `entity-fields-registry.ts` file is generated that imports all index files.

---

## Usage Analysis

### Index Files (USED)

The index files are imported using the namespace pattern:

```typescript
// packages/core/src/modules/sales/api/order-lines/route.ts
import * as F from '@open-mercato/core/generated/entities/sales_order_line'

// Usage
fields: [F.id, F.created_at, F.order_id]
sortFieldMap: { id: F.id, created_at: F.created_at }
```

**Found ~25 imports** across the codebase using this pattern.

### Individual Field Files (NOT USED)

The individual field files were designed for granular imports:

```typescript
// This pattern is NEVER used in the codebase
import id from '@open-mercato/core/generated/entities/sales_order_line/id'
import created_at from '@open-mercato/core/generated/entities/sales_order_line/created_at'
```

**Found 0 imports** of individual field files.

### Entity Fields Registry (NOT USED)

The `entity-fields-registry.ts` file:

```typescript
// packages/core/generated/entity-fields-registry.ts
import * as sales_order from './entities/sales_order'
import * as customer from './entities/customer'
// ...

export const entityFieldsRegistry: Record<string, Record<string, string>> = {
  sales_order,
  customer,
  // ...
}

export function getEntityFields(slug: string): Record<string, string> | undefined {
  return entityFieldsRegistry[slug]
}
```

**Found 0 usages** of `entityFieldsRegistry` or `getEntityFields()` outside the generator itself.

---

## Code Locations

### Generator Code

**File:** `scripts/generate-entity-ids.ts`

The `writePerEntityFieldFiles()` function (lines 112-125) creates both index and individual files:

```typescript
function writePerEntityFieldFiles(outRoot: string, fieldsByEntity: EntityFieldMap) {
  fs.mkdirSync(outRoot, { recursive: true })
  rimrafDir(outRoot)
  fs.mkdirSync(outRoot, { recursive: true })
  for (const [entity, fields] of Object.entries(fieldsByEntity)) {
    const entDir = path.join(outRoot, entity)
    fs.mkdirSync(entDir, { recursive: true })
    // Creates index.ts with named exports
    const idx = fields.map((f) => `export const ${toVar(f)} = '${f}'`).join('\n') + '\n'
    fs.writeFileSync(path.join(entDir, 'index.ts'), idx)
    // Creates individual field files (UNNECESSARY)
    for (const f of fields) {
      fs.writeFileSync(path.join(entDir, `${f}.ts`), `export default '${f}'\n`)
    }
  }
}
```

### Consumer Code Examples

```typescript
// packages/core/src/modules/sales/api/payments/route.ts:16
import * as F from '@open-mercato/core/generated/entities/sales_payment'

// packages/core/src/modules/catalog/api/products/route.ts:22
import * as F from '@open-mercato/core/generated/entities/catalog_product'

// packages/cli/src/mercato.ts (scaffold command template)
import * as F from '@/generated/entities/${entitySnake}
```

---

## Proposed Optimization

### Option 1: Remove Individual Field Files (Recommended)

Modify `writePerEntityFieldFiles()` to only generate index files:

```typescript
function writePerEntityFieldFiles(outRoot: string, fieldsByEntity: EntityFieldMap) {
  fs.mkdirSync(outRoot, { recursive: true })
  rimrafDir(outRoot)
  fs.mkdirSync(outRoot, { recursive: true })
  for (const [entity, fields] of Object.entries(fieldsByEntity)) {
    const entDir = path.join(outRoot, entity)
    fs.mkdirSync(entDir, { recursive: true })
    // Creates index.ts with named exports
    const idx = fields.map((f) => `export const ${toVar(f)} = '${f}'`).join('\n') + '\n'
    fs.writeFileSync(path.join(entDir, 'index.ts'), idx)
    // REMOVED: Individual field file generation
  }
}
```

**Impact:**
- Reduces generated files from ~1,474 to ~96 (93% reduction)
- No breaking changes (individual files are not imported)
- Faster generation time
- Smaller git footprint if generated files are committed

### Option 2: Additionally Remove entity-fields-registry.ts

If the registry is confirmed unnecessary, also remove `writeEntityFieldsRegistry()` call:

```typescript
// In scan() function, remove or comment out:
// writeEntityFieldsRegistry(generatedRoot, combined)
```

**Additional savings:** 1 file per package (3 total)

### Option 3: Consolidate to Single File (Future Consideration)

Instead of per-entity folders, generate a single file:

```typescript
// generated/entity-fields.generated.ts
export const F = {
  sales_order: {
    id: 'id',
    order_number: 'order_number',
    created_at: 'created_at',
    // ...
  },
  customer: {
    id: 'id',
    name: 'name',
    // ...
  }
} as const
```

**Trade-offs:**
- Pro: Single file instead of 96 folders
- Con: Requires updating all import statements
- Con: Less tree-shakeable (imports entire object)

---

## Implementation Steps

### For Option 1 (Minimal Change)

1. **Edit** `scripts/generate-entity-ids.ts`
2. **Remove** the inner loop in `writePerEntityFieldFiles()`:
   ```typescript
   // Remove these lines:
   for (const f of fields) {
     fs.writeFileSync(path.join(entDir, `${f}.ts`), `export default '${f}'\n`)
   }
   ```
3. **Run** `npm run modules:ids` to regenerate
4. **Verify** build still works: `npm run build`
5. **Clean up** old individual field files (handled by `rimrafDir`)

### Testing

After implementation:
```bash
# Regenerate
npm run modules:ids

# Count files (should be ~96 instead of ~1,474)
find packages -path "*/generated/entities/*" -name "*.ts" | wc -l

# Verify no individual field files exist
find packages -path "*/generated/entities/*" -name "*.ts" ! -name "index.ts" | wc -l
# Should output: 0

# Build test
npm run build
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing imports | Very Low | High | Verified no imports of individual files |
| Future need for individual imports | Low | Low | Can be re-added if needed |
| Build failures | Very Low | Medium | Run full build after change |

---

## Conclusion

The individual field files (`entity/field.ts`) are generated but never used. Removing them would:

- **Eliminate ~1,380 unnecessary files**
- **Reduce generation time**
- **Simplify the generated output**
- **Have zero impact on existing functionality**

**Recommendation:** Implement Option 1 (remove individual field file generation) as a safe, high-impact optimization.
