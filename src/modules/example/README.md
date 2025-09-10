# Example Module

Demonstrates all extension points:

- Front page: `/example` rendered by `frontendRoutes`.
- Backend page: `/backend/example` rendered by `backendRoutes`.
- API: `GET /api/example/ping` via `apis` registry.
- DB: `example_items` table defined in `src/modules/example/db/schema.ts`.
- CLI: `erp example hello`.
