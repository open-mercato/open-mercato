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

- Added undoable command handlers for people, companies, deals, activities, comments, addresses, tags, and todo links (including compound todo creation linked to example module todos).
- Command registrations are wired via module bootstrap so the command bus resolves them automatically.
- Next: expose CRUD APIs + UI surfaces leveraging these commands.

### Phase 3 deliverables

- REST endpoints under `/api/customers/*` provide CRUD access for people, companies, deals, activities, comments, addresses, tags, and todo links.
- Endpoints rely on the shared CRUD factory with module validators and enforce feature-based guards plus tenant/organization scoping.
- Additional actions for tag assignment/unassignment and todo linking roll through the command bus, emitting undo metadata headers for clients.

## Data Model Overview

- `customer_entities`: polymorphic root for people or companies (scoped by organization & tenant).
- `customer_people` / `customer_companies`: profile tables for type-specific attributes.
- `customer_deals`: sales opportunities linking to people/companies through junction tables.
- `customer_activities` & `customer_comments`: timeline history and notes per customer (optionally deal scoped).
- `customer_addresses`: multiple labeled addresses per customer.
- `customer_tags` & `customer_tag_assignments`: reusable tagging system shared across entities.
- `customer_todo_links`: references to tasks (e.g., example/todos) attached to customer records.

Custom fields can be registered against `customers:customer_person_profile`, `customers:customer_company_profile`, `customers:customer_deal`, and `customers:customer_activity` via `ce.ts`.

### Next steps

- Generate initial migrations once entities settle:
```bash
npm run db:generate
```
- Re-run code generators to sync metadata:
  ```bash
  npm run modules:prepare
  ```
