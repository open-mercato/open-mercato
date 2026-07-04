# Step 1 — Decide & Analyze

**Ejection is a one-way door and the last resort.** Before recommending it, verify that UMES
extensions cannot solve the problem, then understand exactly what you are taking ownership of.

## Should you eject?

### Decision matrix

| What You Want to Do | Use UMES Extension | Eject Required |
|---------------------|-------------------|----------------|
| Add fields to a form | Field Injection (system-extension skill) | No |
| Add columns to a table | Column Injection (system-extension skill) | No |
| Add data to API responses | Response Enricher | No |
| Validate/block mutations | Mutation Guard or API Interceptor | No |
| Change how a component looks | Component Replacement (wrapper) | No |
| Add menu items | Menu Injection | No |
| React to domain events | Event Subscribers | No |
| **Change entity schema** (add/remove columns) | Not possible via UMES | **Yes** |
| **Change core business logic** (pricing, auth flow) | Not possible via UMES | **Yes** |
| **Remove built-in fields from forms** | Not possible via UMES | **Yes** |
| **Change API route validation rules** | Partially (interceptors), but deep changes need eject | **Maybe** |
| **Change database relationships** | Not possible via UMES | **Yes** |

### Before ejecting — try these first

1. **Response Enricher** — Add computed data to any API response
2. **API Interceptor** — Validate, transform, or enrich requests/responses
3. **Mutation Guard** — Block or modify mutations before persistence
4. **Component Replacement** — Swap, wrap, or transform any registered component
5. **Widget Injection** — Add UI elements to any registered spot
6. **Event Subscriber** — React to domain events with side effects

If UMES truly cannot solve the problem, proceed with ejection.

## Pre-ejection analysis

Before ejecting, understand what you are taking ownership of.

### Step 1: Identify the module

```bash
# List available core modules
ls node_modules/@open-mercato/core/dist/modules/
```

### Step 2: Check module size

Look at the module's file count and complexity. Larger modules mean more upgrade burden.

### Step 3: Identify the specific change

Be precise about what you need to change. Often only 1-2 files need modification, but ejection
copies the entire module.

### Step 4: Check dependencies

Does the module depend on other core modules? Does anything depend on it? Cross-module
dependencies increase risk.

### Step 5: Document the reason

Before ejecting, record why:

```markdown
## Ejection: <module_id>
- **Date**: YYYY-MM-DD
- **Reason**: <why UMES extensions were insufficient>
- **Files to modify**: <specific files that need changes>
- **UMES alternatives considered**: <what was tried first>
```

Save this in `.ai/specs/` or a project README for future reference.

## Common ejection scenarios

Each scenario names the module, the files that typically change, and the UMES alternative that
was ruled out — use them to sanity-check your own decision.

### Scenario: Custom pricing logic

**Problem**: Need to change how product prices are calculated
**Module**: `catalog`
**Files to modify**: `commands/UpdateProductPrice.ts`, `lib/pricing.ts`
**UMES alternative tried**: API Interceptor can't modify internal pricing calculation

### Scenario: Custom auth flow

**Problem**: Need SSO integration not supported by built-in auth
**Module**: `auth`
**Files to modify**: `api/post/login.ts`, `lib/auth-providers.ts`
**UMES alternative tried**: None available for core auth flow

### Scenario: Custom order workflow

**Problem**: Need non-standard order status transitions
**Module**: `sales`
**Files to modify**: `commands/UpdateOrderStatus.ts`, entity status enum
**UMES alternative tried**: Mutation Guard can block transitions but can't add new states

### Scenario: Add column to core entity

**Problem**: Need a column on Customer that doesn't exist
**Module**: `customers`
**Files to modify**: `entities/Person.ts`, `data/validators.ts`, `backend/` pages
**UMES alternative tried**: Enricher adds read-only data; need writable field in core schema
