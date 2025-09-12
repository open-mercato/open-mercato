# Example Module

Demonstrates all extension points:

- Front page: `/example` rendered by `frontendRoutes`.
- Backend page: `/backend/example` rendered by `backendRoutes`.
- API: `GET /api/example/ping` via `apis` registry.
- Data: `example_items` entity defined in `src/modules/example/data/entities.ts`.
- CLI: `mercato example hello`.
