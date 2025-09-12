# Example Module

Demonstrates all extension points:

- Front page: `/example` rendered by `frontendRoutes`.
- Backend page: `/backend/example` rendered by `backendRoutes`.
- API: `GET /api/example/ping` via `apis` registry.
- DB: `example_items` entity defined in `src/modules/example/db/entities.ts`.
- CLI: `mercato example hello`.
