# Customers Module (CRM)

This module provides CRM capabilities for managing people, companies, deals, and related activities.

- Multi-tenant and organization scoped data (every entity carries `organization_id` and `tenant_id`).
- Customer-centric entities prefixed with `customer_` tables to avoid collisions.
- Extensible design to allow custom fields, tagging, and integrations with other modules (e.g. ecommerce).

Implementation phases:
1. Foundations and scaffolding ✅
2. Data model and migrations ✅
3. Command handlers and undo support (in progress)
4. CRUD APIs and UI surfaces
5. Integrations, reporting, and polish

### Phase 3 status

- Added undoable command handlers for people & companies (create/update/delete) with custom-field integration and tag syncing.
- Command registrations are wired via module bootstrap so the command bus resolves them automatically.
- Deals, activities, comments, addresses, tags, and todos will follow in the next iteration of this phase.

## Data Model Overview

- `customer_entities`: polymorphic root for people or companies (scoped by organization & tenant).
- `customer_people` / `customer_companies`: profile tables for type-specific attributes.
- `customer_deals`: sales opportunities linking to people/companies through junction tables.
- `customer_activities` & `customer_comments`: timeline history and notes per customer (optionally deal scoped).
- `customer_addresses`: multiple labeled addresses per customer.
- `customer_tags` & `customer_tag_assignments`: reusable tagging system shared across entities.
- `customer_todo_links`: references to tasks (e.g., example/todos) attached to customer records.

Custom fields can be registered against `customers:person`, `customers:company`, `customers:deal`, and `customers:activity` via `ce.ts`.

### Next steps

- Generate initial migrations once entities settle:
```bash
npm run db:generate
```
- Re-run code generators to sync metadata:
  ```bash
  npm run modules:prepare
  ```
