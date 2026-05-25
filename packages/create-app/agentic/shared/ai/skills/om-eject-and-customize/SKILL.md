---
name: eject-and-customize
description: Guide for safely ejecting and customizing core modules. Use when a developer needs to modify a core module's behavior beyond what UMES extensions support, wants to eject a module, or is considering whether to eject vs extend. Triggers on "eject", "customize module", "modify core module", "override module", "fork module", "change built-in", "should I eject".
---

# Eject & Customize

Guide for safely ejecting core modules and making targeted customizations. Ejecting is a one-way door — always consider UMES extensions first.

## Table of Contents

1. [Should You Eject?](#1-should-you-eject)
2. [Pre-Ejection Analysis](#2-pre-ejection-analysis)
3. [Performing the Ejection](#3-performing-the-ejection)
4. [What Gets Ejected](#4-what-gets-ejected)
5. [Safe Modification Zones](#5-safe-modification-zones)
6. [Dangerous Modification Zones](#6-dangerous-modification-zones)
7. [Tracking Customizations](#7-tracking-customizations)
8. [Upgrade Strategy](#8-upgrade-strategy)
9. [Common Ejection Scenarios](#9-common-ejection-scenarios)

---

## 1. Should You Eject?

**Ejection is the last resort.** Before recommending ejection, verify that UMES extensions cannot solve the problem.

### Decision Matrix

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

### Before Ejecting — Try These First

1. **Response Enricher** — Add computed data to any API response
2. **API Interceptor** — Validate, transform, or enrich requests/responses
3. **Mutation Guard** — Block or modify mutations before persistence
4. **Component Replacement** — Swap, wrap, or transform any registered component
5. **Widget Injection** — Add UI elements to any registered spot
6. **Event Subscriber** — React to domain events with side effects

If UMES truly cannot solve the problem, proceed with ejection.

---

## 2. Pre-Ejection Analysis

Before ejecting, understand what you're taking ownership of.

### Step 1: Identify the Module

```bash
# List available core modules
ls node_modules/@open-mercato/core/dist/modules/
```

### Step 2: Check Module Size

Look at the module's file count and complexity. Larger modules mean more upgrade burden.

### Step 3: Identify the Specific Change

Be precise about what you need to change. Often only 1-2 files need modification, but ejection copies the entire module.

### Step 4: Check Dependencies

Does the module depend on other core modules? Does anything depend on it? Cross-module dependencies increase risk.

### Step 5: Document the Reason

Before ejecting, record why:

```markdown
## Ejection: <module_id>
- **Date**: YYYY-MM-DD
- **Reason**: <why UMES extensions were insufficient>
- **Files to modify**: <specific files that need changes>
- **UMES alternatives considered**: <what was tried first>
```

Save this in `.ai/specs/` or a project README for future reference.

---

## 3. Performing the Ejection

### Run the Eject Command

```bash
yarn mercato module eject <module-id>
```

This copies the module from `node_modules/@open-mercato/core/dist/modules/<module-id>/` to `src/modules/<module-id>/`.

The legacy alias `yarn mercato eject <module-id>` remains supported.

### Post-Ejection Steps

```bash
# 1. The module is automatically re-registered as '@app' source
# Verify in src/modules.ts:
grep '<module-id>' src/modules.ts
# Should show: { id: '<module-id>', from: '@app' }

# 2. Regenerate discovery files
yarn generate

# 3. Verify the app starts
yarn dev

# 4. Verify module functionality
# Test CRUD operations in the admin panel
```

---

## 4. What Gets Ejected

The eject command copies **all module files** to your `src/modules/` directory:

```
src/modules/<module-id>/
├── index.ts           # Module metadata
├── acl.ts             # ACL features
├── setup.ts           # Tenant init, role defaults
├── di.ts              # DI registrations
├── events.ts          # Event declarations
├── entities/          # MikroORM entities
├── data/
│   ├── validators.ts  # Zod schemas
│   ├── enrichers.ts   # Response enrichers (if any)
│   └── extensions.ts  # Entity extensions (if any)
├── api/               # API route handlers
├── backend/           # Admin UI pages
├── frontend/          # Public pages (if any)
├── subscribers/       # Event handlers
├── workers/           # Background jobs
├── widgets/           # UI widgets
├── commands/          # Command pattern implementations
└── migrations/        # Database migrations
```

**Important**: After ejection, the npm package version of this module is no longer used. Your local copy takes precedence.

---

## 5. Safe Modification Zones

These files can be modified with low risk:

| File/Area | Safe Changes | Risk Level |
|-----------|-------------|------------|
| `backend/*.tsx` | UI layout, field order, page structure | Low |
| `data/validators.ts` | Validation rules, field constraints | Low |
| `api/*/` handlers | Business logic within existing routes | Medium |
| `commands/` | Command execute/undo logic | Medium |
| `entities/` | Adding new columns (with migration) | Medium |
| `subscribers/` | Event handler logic | Low |
| `workers/` | Job processing logic | Low |
| `widgets/` | Widget components | Low |

### Safe Modification Example: Add a Column

```typescript
// 1. Add field to entity
@Property({ type: 'varchar', length: 100, nullable: true })
custom_field: string | null = null

// 2. Update validator
export const createSchema = z.object({
  // ... existing fields
  customField: z.string().max(100).optional(),
})

// 3. Generate migration
// yarn db:generate

// 4. Update form fields in backend pages
```

---

## 6. Dangerous Modification Zones

These changes have high upgrade risk or can break other modules:

| File/Area | Danger | Why |
|-----------|--------|-----|
| `index.ts` metadata | Changing `name`/`id` | Other modules reference this ID |
| `acl.ts` feature IDs | Renaming features | Feature IDs are stored in DB, referenced by roles |
| `events.ts` event IDs | Renaming events | Other modules subscribe to these event IDs |
| Entity table/column rename | Database references break | FKs in other modules, stored data |
| `di.ts` service names | Renaming DI keys | Other modules resolve by name |
| Removing API routes | External consumers break | Other modules/integrations call these |
| `setup.ts` structure | Changing tenant init | Affects new tenant provisioning |

### Rules for Dangerous Zones

- **NEVER** rename entity table names or column names — other modules may reference them
- **NEVER** rename event IDs — subscribers in other modules depend on exact IDs
- **NEVER** rename ACL feature IDs — stored in database with role assignments
- **NEVER** remove API routes — other modules or external systems may call them
- **NEVER** rename DI service registration keys — other modules resolve by key name
- Adding is safe; renaming/removing is dangerous

---

## 7. Tracking Customizations

Keep a record of every change made to ejected modules. This is critical for upgrades.

### Create a Customization Log

Create `.ai/specs/EJECTED-MODULES.md`:

```markdown
# Ejected Module Customizations

## <module_id>

- **Ejected from version**: 0.4.2 (check package.json at time of ejection)
- **Ejected on**: YYYY-MM-DD
- **Reason**: <why UMES was insufficient>

### Changes Made

| Date | File | Change | Reason |
|------|------|--------|--------|
| YYYY-MM-DD | entities/Entity.ts | Added `custom_field` column | Business requirement X |
| YYYY-MM-DD | backend/page.tsx | Modified list columns | UX improvement |
| YYYY-MM-DD | data/validators.ts | Added custom validation rule | Data quality requirement |
```

### After Every Change

Add a row to the changes table. This makes future upgrades manageable by showing exactly what was customized.

---

## 8. Upgrade Strategy

When upgrading Open Mercato packages (`@open-mercato/*`), ejected modules don't update automatically. You must manually merge upstream changes.

### Upgrade Workflow

1. **Check the changelog** for the new version — look for changes to the ejected module
2. **Compare your version** with the new version:
   ```bash
   # After updating packages
   diff -r src/modules/<module-id>/ node_modules/@open-mercato/core/dist/modules/<module-id>/
   ```
3. **Review each difference** — your customizations should be the only differences
4. **Merge upstream changes** — apply bug fixes and new features from upstream to your local copy
5. **Test thoroughly** — run `yarn typecheck`, `yarn test`, `yarn dev`

### Minimizing Upgrade Burden

- **Minimize changes** — only modify what's strictly necessary
- **Keep changes isolated** — prefer adding new files over modifying existing ones
- **Document everything** — update the customization log
- **Consider UMES first** — for new customizations, check if UMES can handle it even though the module is ejected

---

## 9. Common Ejection Scenarios

### Scenario: Custom Pricing Logic

**Problem**: Need to change how product prices are calculated
**Module**: `catalog`
**Files to modify**: `commands/UpdateProductPrice.ts`, `lib/pricing.ts`
**UMES alternative tried**: API Interceptor can't modify internal pricing calculation

### Scenario: Custom Auth Flow

**Problem**: Need SSO integration not supported by built-in auth
**Module**: `auth`
**Files to modify**: `api/post/login.ts`, `lib/auth-providers.ts`
**UMES alternative tried**: None available for core auth flow

### Scenario: Custom Order Workflow

**Problem**: Need non-standard order status transitions
**Module**: `sales`
**Files to modify**: `commands/UpdateOrderStatus.ts`, entity status enum
**UMES alternative tried**: Mutation Guard can block transitions but can't add new states

### Scenario: Add Column to Core Entity

**Problem**: Need a column on Customer that doesn't exist
**Module**: `customers`
**Files to modify**: `entities/Person.ts`, `data/validators.ts`, `backend/` pages
**UMES alternative tried**: Enricher adds read-only data; need writable field in core schema

---

## Rules

- **MUST** try UMES extensions before ejecting — recommend the `system-extension` skill first
- **MUST** document the reason for ejection before proceeding
- **MUST** track all changes in a customization log
- **MUST** run `yarn generate` after ejection
- **MUST** verify the app starts and module works after ejection
- **MUST NOT** rename entity tables, columns, event IDs, feature IDs, or DI keys
- **MUST NOT** remove API routes or event definitions
- **MUST NOT** modify files outside the ejected module's directory
- Treat ejected modules as owned code — you are responsible for updates and bug fixes
- When in doubt, extend rather than eject
