# Dashboard Widgets

The admin dashboard at `/backend` is built from small, self-contained widgets that are discovered from every enabled module. This document explains how widgets are authored, discovered, and controlled inside Open Mercato.

## Widget locations

Widgets live under `packages/<module>/src/modules/<module>/widgets/dashboard/<slug>/widget.ts`. The generator looks for files named `widget.ts`, `widget.js`, `widget.tsx`, or `widget.jsx` and registers them automatically. A widget module must export a default object implementing `DashboardWidgetModule` from `@open-mercato/shared/modules/dashboard/widgets`.

Core ships with the discovery/runtime infrastructure, while the Example module (`packages/example`) provides a set of reference widgets that demonstrate common patterns:

| Widget ID | Path | Purpose |
|-----------|------|---------|
| `example.dashboard.welcome` | `.../welcome/widget.ts` | Greets the current user with a configurable headline and message. |
| `example.dashboard.notes` | `.../notes/widget.ts` | Allows a user to maintain private text notes. |
| `example.dashboard.todos` | `.../todos/widget.ts` | Surfaces Example module todos and allows creating/completing tasks via the public API. |

Each widget module exports:

```ts
const widget: DashboardWidgetModule<MySettings> = {
  metadata: { /* id, title, features, defaults, etc. */ },
  Widget: MyClientComponent,
  hydrateSettings: (raw) => parsedSettings,
  dehydrateSettings: (settings) => serialisableSettings,
}
```

### Client/server split

Dashboard widgets run on the client, but the discovery phase happens in `node`. For example widgets we keep client React code in `widget.client.tsx` and export plain configuration helpers from a `config.ts` file. The server-facing `widget.ts` only stitches those pieces together. This guarantees that importing the module on the server never triggers React hook execution.

## Discovery and runtime

The generator (`scripts/generate-module-registry.ts`) records every widget as `{ moduleId, key, loader }`. At runtime:

* `packages/core/src/modules/dashboards/lib/widgets.ts` lazy-loads the registry, requests each widget via `loader()`, validates its metadata, and caches the result.
* `loadAllWidgets()` returns a deduplicated list (one entry per widget `metadata.id`), while `loadWidgetById()` fetches a single widget lazily.
* The dashboard layout API (`dashboards/api/layout/route.ts`) and widget visibility APIs use the discovery helpers to present the available widgets to the UI and to enforce feature flags/upgrades.

The UI dashboard (`packages/ui/src/backend/dashboard/DashboardScreen.tsx`) consumes the available widgets, renders the configured layout, and obtains per-widget components by calling the loaders exposed from the module registry.

## Access control

Widget availability is gated by existing RBAC rules:

* Widget metadata contains a `features` array. The discovery helpers ensure that a user either has all listed features or is a super admin before the widget is offered.
* Additional coarse-grained toggles are stored per role (`DashboardRoleWidgets`) and per user (`DashboardUserWidgets`). The CLI command `mercato dashboards seed-defaults` writes default visibility for the standard roles after `mercato init`.
* The Example module declares widget-specific features in `packages/example/src/modules/example/acl.ts` (`example.widgets.*`). Grant these via role ACLs to allow access.

## Writing your own widget

1. Create `packages/<my-module>/src/modules/<my-module>/widgets/dashboard/<slug>/widget.ts`.
2. Export a `DashboardWidgetModule`, including `metadata.id` (must be globally unique), `title`, and `features`.
3. Provide `hydrateSettings`/`dehydrateSettings` to keep the persisted JSON payload stable.
4. If the widget performs network traffic, use `apiFetch` so authentication headers are applied consistently.
5. Run `npm run modules:prepare` so the registry picks up your new widget.

### Best practices

* Keep widget client components small; most of the logic should live in helpers or API calls.
* Use per-widget settings (exposed via the dashboard “Settings” mode) when you need lightweight configuration. The widget is responsible for persisting those settings via the layout PATCH endpoint.
* Fetch data lazily inside the widget itself (as the Example todos widget does) so each widget remains independent of the dashboard container.
* Declare a feature flag per widget in your module’s `acl.ts`. That makes it easy to grant/revoke widgets without editing layout data manually.

With these conventions any module can safely plug additional functionality into the admin landing page without touching shared code.
