# Example: Todo List with Custom Fields

This example extends the `example` module with a new `Todo` entity, declares custom fields using the `custom_fields` module, seeds 10 demo rows with values, and exposes a backend page to browse the data via the query engine.

## What’s included
- New entity `Todo` in `src/modules/example/data/entities.ts` (table: `todos`).
- Custom fields for `example:todo` defined in `src/modules/example/data/fields.ts`:
  - `priority` (integer, 1–5)
  - `severity` (select: low/medium/high)
  - `blocked` (boolean)
- Backend page at `/backend/example/todos` using the query engine to project CFs.
- CLI seeding command `mercato example seed-todos` to insert 10 demo rows and CF values.
- Quick link added to the home page.

## Run it
1) Generate modules and DI
   - `npm run modules:prepare`

2) Create migrations and apply
   - `npm run db:generate`
   - `npm run db:migrate`

3) Seed field definitions for your organization
   - `npm run mercato -- custom_fields install -- --org <orgId>`

4) Seed todos and their custom field values (scoped to org; optional tenant)
   - `npm run mercato -- example seed-todos -- --org <orgId> [--tenant <tenantId>]`

5) Open the page
   - Go to `/backend/example/todos` (also linked on the home page under Quick Links).

## Notes
- The page uses the query engine with `organizationId` set from auth and `fields: ['id','title','tenant_id','organization_id','is_done','cf:priority','cf:severity','cf:blocked']` so custom fields are joined and projected.
- You can filter or sort on base fields today; custom-field filters are supported as `filters: [{ field: 'cf:priority', op: 'gte', value: 3 }]` when building queries in code.
- To scope by tenant, add `organization_id` to your entities and pass `organizationId` in query options. The example entity omits it for simplicity.
  - In this example, the `todos` table includes `tenant_id` and `organization_id`, and the page filters by `organizationId` from the authenticated user.
