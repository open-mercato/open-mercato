# Customers Module (CRM)

This module provides CRM capabilities for managing people, companies, deals, and related activities.

- Multi-tenant and organization scoped data (every entity carries `organization_id` and `tenant_id`).
- Customer-centric entities prefixed with `customer_` tables to avoid collisions.
- Extensible design to allow custom fields, tagging, and integrations with other modules (e.g. ecommerce).

Implementation phases:
1. Foundations and scaffolding (current).
2. Data model and migrations.
3. Command handlers and undo support.
4. CRUD APIs and UI surfaces.
5. Integrations, reporting, and polish.
