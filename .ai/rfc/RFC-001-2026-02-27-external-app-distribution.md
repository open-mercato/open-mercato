# RFC-001: External App Distribution for Open Mercato

**Status:** Draft
**Date:** 2026-02-27
**Author:** Architecture Team
**Category:** Platform Extensibility

---

## 1. Problem Statement

Open Mercato has a powerful module system with widget injection, component overrides, and event bridging — but all of it requires modules to be **compiled into the host application** at build time. This prevents a third-party app ecosystem where developers can:

- Build and distribute apps independently (separate CI/CD, versioning)
- Install apps without rebuilding the host
- Run app code from external origins (CDN, marketplace)
- Maintain isolation between untrusted third-party code and the host

The goal is to enable **externally-hosted, runtime-loadable apps** that integrate deeply with Open Mercato's UI and API while maintaining security, consistency, and performance.

---

## 2. Design Constraints

### Must Have
- Apps use 100% Open Mercato public API (authenticated via API key or OAuth)
- Apps look and feel identical to native Open Mercato UI (same design tokens, components)
- Apps integrate with the existing widget injection spot system
- Apps can inject menu items, sidebar entries, and dashboard widgets
- Host platform remains secure even with untrusted app code
- Apps are independently deployable and versionable

### Should Have
- Apps can respond to real-time events (DOM Event Bridge / SSE)
- Apps can inject columns, fields, and filters into host data tables and forms
- Hot-reload during development
- App marketplace / registry for discovery and installation

### Nice to Have
- Apps can use component overrides (replace/wrap host components)
- Offline-capable apps
- Apps can declare workers/subscribers (server-side extensions)

### Won't Have (v1)
- Server-side app code execution (all apps are client-side only in v1)
- Direct database access from apps
- Ability to modify core platform behavior beyond designated extension points

---

## 3. Approach Comparison

### 3.1 Option A: Web Components via Module Federation

**How it works:** Apps are compiled as Web Components (Custom Elements + Shadow DOM), bundled separately, and loaded at runtime via Module Federation or dynamic `import()` from a CDN/registry URL.

| Aspect | Assessment |
|--------|-----------|
| **Style isolation** | Shadow DOM provides CSS isolation; design tokens injected via CSS custom properties on the host element |
| **Framework freedom** | Apps can use React, Vue, Svelte, vanilla — anything that compiles to Custom Elements |
| **Integration depth** | Medium — can render in injection spots, receive context via attributes/properties, emit CustomEvents |
| **Security** | Runs in same JS context — no sandbox. Malicious apps can access `window`, cookies, DOM |
| **Performance** | Good — no iframe overhead, shared event loop |
| **Complexity** | High — Shadow DOM + React interop is fragile; event bubbling, form participation, and focus management need custom solutions |

**Key challenge:** Shadow DOM and React don't play well together. React's synthetic event system doesn't cross shadow boundaries. Portals, context providers, and hooks like `useT()` won't work inside Shadow DOM without explicit bridging.

### 3.2 Option B: Sandboxed Iframes with postMessage Bridge

**How it works:** Each app runs in a sandboxed `<iframe>` with `postMessage` communication to the host. A bridge protocol handles API calls, injection registration, theming, and event forwarding.

| Aspect | Assessment |
|--------|-----------|
| **Style isolation** | Complete — iframe has its own document |
| **Security** | Strong — `sandbox` attribute restricts capabilities; cross-origin prevents DOM access |
| **Integration depth** | Low — no shared React context, no direct DOM injection into host forms/tables |
| **Performance** | Overhead from iframe creation, message serialization, and layout recalculation |
| **UX consistency** | Requires injecting CSS theme into iframe; scrollbars, focus, keyboard shortcuts are disconnected |

**Key challenge:** Iframes can't inject columns into a host DataTable or fields into a CrudForm. They can only render self-contained views. This fundamentally limits the integration patterns that make Open Mercato's module system powerful.

### 3.3 Option C: Federated React Components (Recommended)

**How it works:** Apps are compiled as standard React component bundles (ESM) that export a manifest conforming to the Open Mercato App SDK contract. The host loads these bundles at runtime via dynamic `import()`, wraps them in an error boundary and permission guard, and renders them within the existing injection spot system.

| Aspect | Assessment |
|--------|-----------|
| **Style isolation** | None (shared Tailwind context) — but this is a **feature**: apps automatically inherit the host theme |
| **Framework** | React only — but this matches the host and avoids interop friction |
| **Integration depth** | Deep — full access to injection spots, widget events, menu items, data widgets |
| **Security** | Same JS context — mitigated via code review, app signing, CSP, and runtime permission model |
| **Performance** | Excellent — native React rendering, no serialization overhead |
| **Complexity** | Moderate — need an App SDK, manifest format, and runtime loader |

**Key insight:** Since Open Mercato is React-based and all extension points (injection widgets, component overrides, menu items) expect React components, the most natural approach is to load React bundles that conform to the same interfaces internal modules use.

### 3.4 Option D: Hybrid (Federated React + Iframe Fallback)

**How it works:** Trusted/reviewed apps use Option C (federated React). Untrusted or non-React apps can opt into an iframe container with a postMessage bridge for basic integration (menu items, full-page views).

This gives the best of both worlds but increases implementation scope.

---

## 4. Recommended Architecture: Federated React Components

### 4.1 App Bundle Format

An external app is a JavaScript bundle (ESM) that exports a **manifest** object:

```typescript
// app-manifest.d.ts — shipped as part of @open-mercato/app-sdk

export interface AppManifest {
  /** Unique app identifier (reverse-domain, e.g., "com.acme.crm-enrichment") */
  id: string

  /** Semver version */
  version: string

  /** Human-readable name */
  name: string

  /** App description */
  description?: string

  /** Required Open Mercato API version (semver range) */
  platformVersion: string

  /** Required API permissions (mapped to RBAC features) */
  requiredFeatures: string[]

  /** Injection widgets the app provides */
  injectionWidgets?: AppInjectionWidget[]

  /** Menu items to inject */
  menuItems?: AppMenuItem[]

  /** Full-page views (rendered in app container) */
  pages?: AppPage[]

  /** Dashboard widgets */
  dashboardWidgets?: AppDashboardWidget[]

  /** Event subscriptions (client-side only) */
  eventSubscriptions?: string[]

  /** App lifecycle hooks */
  onActivate?: (ctx: AppContext) => Promise<void>
  onDeactivate?: (ctx: AppContext) => Promise<void>
}
```

### 4.2 App Context (Provided by Host)

```typescript
export interface AppContext {
  /** Scoped API client (pre-authenticated, rate-limited) */
  api: AppApiClient

  /** i18n translation function */
  t: (key: string, fallback?: string, params?: Record<string, string>) => string

  /** Current user info (limited) */
  user: { id: string; email: string; roles: string[] }

  /** Current tenant/org scope */
  scope: { tenantId: string; organizationId: string }

  /** Subscribe to real-time events */
  onEvent: (pattern: string, handler: (event: AppEventPayload) => void) => () => void

  /** Navigate within Open Mercato */
  navigate: (path: string) => void

  /** Show flash message */
  flash: (message: string, type: 'success' | 'error' | 'info') => void

  /** Show confirmation dialog */
  confirm: (message: string) => Promise<boolean>

  /** App-scoped storage (persisted per tenant+app) */
  storage: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }
}
```

### 4.3 App API Client

Apps do **not** call `fetch()` directly. The host provides a scoped API client that:

1. Automatically attaches the app's API key
2. Scopes requests to the current tenant/organization
3. Enforces rate limiting per app
4. Logs API usage for audit
5. Restricts to allowed endpoints (based on `requiredFeatures`)

```typescript
export interface AppApiClient {
  get: <T>(path: string, params?: Record<string, string>) => Promise<ApiResult<T>>
  post: <T>(path: string, body: unknown) => Promise<ApiResult<T>>
  put: <T>(path: string, body: unknown) => Promise<ApiResult<T>>
  patch: <T>(path: string, body: unknown) => Promise<ApiResult<T>>
  delete: <T>(path: string) => Promise<ApiResult<T>>
}
```

### 4.4 Injection Widget Integration

External app widgets conform to the same `InjectionWidgetModule` interface internal modules use:

```typescript
export interface AppInjectionWidget {
  /** Widget metadata (same as internal widgets) */
  metadata: InjectionWidgetMetadata

  /** Target injection spots */
  spots: Array<{
    spotId: string
    kind?: 'tab' | 'group' | 'stack'
    priority?: number
    column?: 1 | 2
    groupLabel?: string
  }>

  /** React component */
  Widget: ComponentType<InjectionWidgetComponentProps>

  /** Event handlers (same contract as internal widgets) */
  eventHandlers?: WidgetInjectionEventHandlers
}
```

This means external apps can:
- Inject fields into CrudForm (`crud-form:<entity>:fields`)
- Add columns to DataTable (`data-table:<table>:columns`)
- Add tabs to detail pages (`detail:<entity>:tabs`)
- Add sections to forms (`crud-form:<entity>`)
- Block saves via `onBeforeSave` guards
- Transform form data via `transformFormData` pipeline

### 4.5 Runtime Loading Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    Open Mercato Host                         │
│                                                             │
│  1. App Registry DB                                         │
│     ┌────────────────────────────────┐                      │
│     │ id: com.acme.enrichment        │                      │
│     │ bundleUrl: https://cdn/app.mjs │                      │
│     │ integrityHash: sha384-...      │                      │
│     │ apiKeyId: key_abc123           │                      │
│     │ status: active                 │                      │
│     │ permissions: [customers.view]  │                      │
│     └────────────────────────────────┘                      │
│                                                             │
│  2. App Loader (on page load)                               │
│     ┌─────────────────────────────────────┐                 │
│     │ for each active app:                │                 │
│     │   bundle = await import(bundleUrl)  │                 │
│     │   verify(bundle, integrityHash)     │                 │
│     │   manifest = bundle.default         │                 │
│     │   validate(manifest, AppManifest)   │                 │
│     │   ctx = createAppContext(app)       │                 │
│     │   registerWidgets(manifest, ctx)    │                 │
│     │   registerMenuItems(manifest, ctx)  │                 │
│     │   registerPages(manifest, ctx)      │                 │
│     │   manifest.onActivate?.(ctx)        │                 │
│     └─────────────────────────────────────┘                 │
│                                                             │
│  3. Injection Spot Rendering (existing system)              │
│     ┌─────────────────────────────────────┐                 │
│     │ <InjectionSpot spotId="...">        │                 │
│     │   // Includes both internal AND     │                 │
│     │   // external app widgets           │                 │
│     │   <ErrorBoundary>                   │                 │
│     │     <PermissionGuard features={[]}>  │                │
│     │       <AppWidget context={ctx} />   │                 │
│     │     </PermissionGuard>              │                 │
│     │   </ErrorBoundary>                  │                 │
│     └─────────────────────────────────────┘                 │
│                                                             │
│  4. Full-Page App Views                                     │
│     Route: /backend/apps/:appId/:path*                      │
│     ┌─────────────────────────────────────┐                 │
│     │ <AppShell>                          │                 │
│     │   <ErrorBoundary>                   │                 │
│     │     <AppPageComponent ctx={ctx} />  │                 │
│     │   </ErrorBoundary>                  │                 │
│     │ </AppShell>                         │                 │
│     └─────────────────────────────────────┘                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.6 UI Consistency Strategy

External apps automatically look like Open Mercato because:

1. **Shared Tailwind context:** Apps run in the same document, inheriting all CSS custom properties (`--primary`, `--border`, `--radius`, etc.) and Tailwind utilities
2. **App SDK re-exports UI primitives:** The SDK package (`@open-mercato/app-sdk`) re-exports approved UI components:
   - `Button`, `IconButton`, `Input`, `Label`, `Card`, `Dialog`, `Badge`, etc.
   - `DataTable`, `CrudForm`, `FormHeader`, `FormFooter`
   - `LoadingMessage`, `ErrorMessage`
   - `ComboboxInput`, `DatePicker`, `TagsInput`
3. **Same i18n system:** `t()` function in AppContext works identically to `useT()`
4. **Same icon set:** SDK includes `lucide-react` icons used throughout the platform

```typescript
// Example external app widget
import { Button, Card, Input, Badge } from '@open-mercato/app-sdk/ui'
import { useAppContext } from '@open-mercato/app-sdk'

export function EnrichmentWidget({ context, data }: InjectionWidgetComponentProps) {
  const { api, t } = useAppContext()

  return (
    <Card>
      <h3>{t('enrichment.title', 'Data Enrichment')}</h3>
      <Button onClick={() => api.post('/api/enrichment/enrich', { id: data.id })}>
        {t('enrichment.enrich', 'Enrich Record')}
      </Button>
    </Card>
  )
}
```

---

## 5. Security Model

### 5.1 Threat Analysis

| Threat | Mitigation |
|--------|-----------|
| **Malicious app reads cookies/tokens** | App API client is scoped; direct `fetch` calls blocked via CSP; app review process |
| **App injects malicious DOM** | Error boundaries isolate crashes; CSP blocks inline scripts; app code is integrity-checked |
| **App exfiltrates data** | CSP `connect-src` restricts outbound requests to app's declared origins + Open Mercato API |
| **App impersonates another app** | Bundle integrity hash verified on load; app ID tied to signing key |
| **Supply chain attack on app CDN** | Subresource Integrity (SRI) hash stored in registry; mismatch = app not loaded |
| **App causes performance degradation** | Error boundaries + React Suspense timeout; CPU-heavy apps flagged via Performance Observer |

### 5.2 Security Layers

```
Layer 1: App Review & Signing
  - Apps submitted to marketplace undergo code review
  - Approved apps receive a signing certificate
  - Self-hosted apps marked as "unreviewed" with user warning

Layer 2: Content Security Policy (CSP)
  - script-src: 'self' + approved CDN origins per installed app
  - connect-src: 'self' + app's declared API origins
  - No inline scripts, no eval

Layer 3: Runtime Permission Model
  - App declares requiredFeatures in manifest
  - Admin reviews and approves permissions on install
  - AppApiClient enforces feature restrictions server-side
  - App cannot escalate permissions at runtime

Layer 4: Isolation Boundaries
  - Each app widget wrapped in React ErrorBoundary
  - App context is frozen (Object.freeze) to prevent mutation
  - App storage is namespaced (tenantId + appId prefix)
  - API key per app with rate limiting

Layer 5: Audit Trail
  - All app API calls logged with appId, timestamp, endpoint
  - App activation/deactivation events recorded
  - Admin can revoke app access instantly
```

### 5.3 Trust Tiers

| Tier | Source | Capabilities | Review |
|------|--------|-------------|--------|
| **Core** | `@open-mercato/*` packages | Full platform access | Maintained by core team |
| **Verified** | Marketplace, signed | Injection widgets, menu items, pages, events | Code review + automated scanning |
| **Community** | Self-hosted, unsigned | Injection widgets, menu items, pages | User accepts risk warning |
| **Sandboxed** | Untrusted / iframe fallback | Full-page iframe views only, postMessage bridge | No code review; maximum isolation |

---

## 6. App Lifecycle

### 6.1 Development

```bash
# Scaffold a new app
npx @open-mercato/create-app my-enrichment-app

# Start development with hot-reload against local Open Mercato
cd my-enrichment-app
npm run dev
# → Serves app bundle at localhost:3100
# → Open Mercato dev server configured to load from localhost:3100

# Project structure
my-enrichment-app/
  src/
    manifest.ts          # App manifest (id, version, widgets, pages)
    widgets/
      enrichment/
        widget.tsx       # Injection widget component
        event-handlers.ts
    pages/
      settings.tsx       # Full-page view at /backend/apps/my-app/settings
    locales/
      en.json
  open-mercato.config.ts # SDK config (target platform version, dev server URL)
  package.json
```

### 6.2 Building & Publishing

```bash
# Build optimized bundle
npm run build
# → dist/app.mjs (ESM bundle, tree-shaken)
# → dist/manifest.json (extracted manifest for registry)
# → dist/integrity.sha384 (SRI hash)

# Publish to marketplace (future)
npm run publish:marketplace

# Or self-host
# Upload dist/app.mjs to your CDN
```

### 6.3 Installation (Admin Flow)

1. Admin navigates to **Settings > Apps** in Open Mercato
2. Browses marketplace or enters a custom bundle URL
3. Platform fetches manifest, displays:
   - App name, description, version
   - Required permissions (mapped to readable descriptions)
   - Injection points the app wants to use
4. Admin reviews and clicks **Install**
5. Platform:
   - Creates an API key scoped to the app's required features
   - Stores app record in `external_apps` table
   - Downloads and caches bundle (or stores CDN URL + integrity hash)
   - Registers app widgets/menus/pages in the runtime registry
6. App becomes active on next page load

### 6.4 Updates

- Apps declare `platformVersion` semver range for compatibility
- When an app publishes a new version:
  - Marketplace notifies installed instances
  - Admin reviews changelog and updated permissions
  - One-click update (or auto-update if configured)
- Breaking platform changes: apps with incompatible `platformVersion` are disabled with admin notification

---

## 7. Data Model

### 7.1 New Entities

```
external_apps
  ├── id (uuid PK)
  ├── app_id (string, unique per tenant — e.g., "com.acme.enrichment")
  ├── name (string)
  ├── description (text, nullable)
  ├── version (string, semver)
  ├── bundle_url (string — CDN URL or local path)
  ├── integrity_hash (string — SRI sha384)
  ├── manifest_json (jsonb — full AppManifest)
  ├── status (enum: active | disabled | error)
  ├── trust_tier (enum: verified | community | sandboxed)
  ├── api_key_id (FK → api_keys.id)
  ├── installed_by (FK → users.id)
  ├── permissions_json (jsonb — approved features)
  ├── settings_json (jsonb — app-specific config)
  ├── tenant_id (FK)
  ├── organization_id (FK, nullable — null = all orgs)
  ├── created_at, updated_at, deleted_at
  └── last_error (text, nullable — last load/runtime error)

external_app_storage
  ├── id (uuid PK)
  ├── app_id (FK → external_apps.id)
  ├── key (string)
  ├── value_json (jsonb)
  ├── tenant_id (FK)
  ├── organization_id (FK)
  ├── created_at, updated_at
  └── UNIQUE(app_id, key, tenant_id, organization_id)
```

### 7.2 ACL Features

```typescript
// acl.ts for external_apps module
export const features = [
  { id: 'external_apps.view', label: 'View installed apps' },
  { id: 'external_apps.install', label: 'Install and manage apps' },
  { id: 'external_apps.configure', label: 'Configure app settings' },
  { id: 'external_apps.uninstall', label: 'Uninstall apps' },
]
```

---

## 8. Integration Points with Existing Systems

### 8.1 Widget Injection (Deep Integration)

External app widgets are registered into the **same global registry** as internal widgets. The existing `loadInjectionWidgetsForSpot()` function is extended to include external app widgets:

```
Internal widgets (from generated files)
  + External app widgets (from runtime registry)
  = Combined widget list for each spot
```

**Changes needed:**
- `injection-loader.ts`: Add `registerExternalInjectionWidgets()` function
- `InjectionSpot.tsx`: Wrap external widgets in `ErrorBoundary` + `AppContextProvider`
- `useInjectionDataWidgets.ts`: Include external data widgets in results

### 8.2 Menu Injection (Straightforward)

External app menu items are added to `useInjectedMenuItems()` results. No architectural change — just a new source of `InjectionMenuItem[]`.

### 8.3 Event Bridge (Read-Only)

External apps can **subscribe** to events via `AppContext.onEvent()` but cannot **emit** custom events to the host event bus. This prevents apps from triggering unintended side effects in other modules.

### 8.4 Component Overrides (Restricted in v1)

Component overrides (`componentOverrides`) are **not available** to external apps in v1. This is the most powerful (and dangerous) extension point — allowing replacement of core UI components. Enabling this for external apps requires additional trust verification and is deferred to v2.

### 8.5 API Access

External apps use the host's `/api/*` endpoints through the scoped `AppApiClient`. They do **not** have their own API routes — all server-side logic must go through the existing CRUD/command infrastructure or the app's own external backend.

### 8.6 Full-Page Views

Apps can register pages that render at `/backend/apps/:appId/:path*`. These pages run inside the standard `AppShell` layout (sidebar, topbar) and have full access to UI primitives.

---

## 9. App SDK Package

A new package `@open-mercato/app-sdk` provides everything external developers need:

```
@open-mercato/app-sdk
  ├── /ui          — Re-exported UI primitives (Button, Card, Input, DataTable, etc.)
  ├── /hooks       — useAppContext, useAppEvent, useAppApi, useAppStorage
  ├── /types       — AppManifest, AppContext, AppInjectionWidget, etc.
  ├── /build       — Vite/Rollup plugin for building app bundles
  └── /dev         — Dev server + proxy for local development against Open Mercato
```

**Versioned independently** from the platform. The SDK version maps to a `platformVersion` range.

---

## 10. Implementation Phases

### Phase 1: Foundation (4-6 weeks)

- [ ] Define `AppManifest` TypeScript interface and zod validator
- [ ] Create `@open-mercato/app-sdk` package with UI re-exports
- [ ] Implement runtime app loader (`loadExternalApp()`)
- [ ] Add `external_apps` entity and CRUD API
- [ ] Extend injection loader to include external widgets
- [ ] Add `/backend/apps/:appId/:path*` catch-all route for app pages
- [ ] Create `AppContextProvider` React component
- [ ] Implement scoped `AppApiClient` with rate limiting
- [ ] Add ErrorBoundary wrapper for all external widgets
- [ ] Create `@open-mercato/create-app` scaffolding tool

### Phase 2: Developer Experience (2-3 weeks)

- [ ] Hot-reload dev server for app development
- [ ] App development documentation
- [ ] Example apps (CRM enrichment, shipping calculator, analytics dashboard)
- [ ] SDK CLI for build, validate, and publish commands
- [ ] CSP configuration generator based on installed apps

### Phase 3: Marketplace & Trust (3-4 weeks)

- [ ] App registry UI (Settings > Apps)
- [ ] App installation flow with permission review
- [ ] Bundle integrity verification (SRI)
- [ ] App signing with certificates
- [ ] Trust tier badges in UI
- [ ] App storage API (`external_app_storage`)
- [ ] Audit logging for app API calls

### Phase 4: Advanced Integration (2-3 weeks)

- [ ] Iframe fallback for sandboxed tier apps
- [ ] postMessage bridge protocol for iframe apps
- [ ] Event subscription forwarding to app widgets
- [ ] App update notification and auto-update flow
- [ ] Performance monitoring (app CPU/memory budget)

---

## 11. Open Questions

1. **Shared dependencies:** Should the host expose React, React DOM, and Tailwind as shared externals (Module Federation style) to reduce bundle size? Or should each app bundle its own?
   *Recommendation:* Use `externals` — apps import React from the host to avoid version conflicts and reduce bundle size.

2. **Server-side app extensions (v2+):** Should apps eventually be able to register API routes, subscribers, or workers? This would require a secure execution environment (WASM, Deno isolates, or containerized functions).
   *Recommendation:* Defer to v2. Start with client-side only. Apps that need server-side logic can host their own backend and proxy through the AppApiClient.

3. **App-to-app communication:** Should apps be able to communicate with each other? This introduces coupling and security concerns.
   *Recommendation:* No direct app-to-app communication. Apps can observe the same events and read the same API data, but cannot send messages to each other.

4. **Billing and metering:** If a marketplace charges for apps, how is usage metered?
   *Recommendation:* Defer billing to marketplace spec. The `external_apps` table tracks `api_key_id` which already has usage logging.

5. **Offline / PWA support:** Can apps work offline?
   *Recommendation:* Defer. Apps are loaded from CDN on page load. Service worker caching could be explored in v2.

6. **CSS conflict risk:** Without Shadow DOM, can an app's CSS accidentally break the host?
   *Recommendation:* Mitigate via SDK conventions (all app CSS must be scoped with `[data-app="<appId>"]` selector). Build tool enforces this automatically. Apps that only use SDK components need no custom CSS.

---

## 12. Comparison with Existing Platforms

| Platform | Approach | Integration Depth | Security Model |
|----------|----------|-------------------|---------------|
| **Shopify** | Iframe (App Bridge) + Polaris components | Medium — iframes with postMessage | Strong — full iframe isolation |
| **Salesforce Lightning** | Aura/LWC (Web Components) | Deep — runs in same context | Moderate — Locker Service sandboxing |
| **HubSpot** | Iframe (UI Extensions) + React SDK | Medium-High — iframe with CRM data bridge | Strong — iframe + CSP |
| **Notion** | Not extensible (API only) | Low — no UI integration | N/A |
| **Odoo** | Python modules + QWeb templates | Very Deep — server-side + client-side | Low — full code access |
| **This RFC** | Federated React + iframe fallback | Deep — injection widgets, menus, pages | Tiered — trust level determines isolation |

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| React version mismatch between host and app | Medium | High — runtime errors | Share React as external; enforce compatible version in SDK |
| App bundle too large, slowing page load | Medium | Medium — UX degradation | Bundle size limits in manifest validation; lazy-load app bundles |
| Malicious app in community tier | Low | High — data exfiltration | CSP restrictions; admin warning on install; audit logging |
| Breaking platform API changes break apps | Medium | High — app ecosystem churn | Semantic versioning; `platformVersion` compatibility check; deprecation periods |
| Low adoption due to SDK complexity | Medium | Medium — ecosystem doesn't grow | Extensive docs, starter templates, example apps |
| Tailwind version conflicts | Low | Medium — visual inconsistencies | Pin Tailwind version in SDK; apps use SDK components, not raw Tailwind |

---

## 14. Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Primary integration** | Federated React components | Deepest integration with existing injection system; no interop friction |
| **Fallback for untrusted** | Sandboxed iframe | Maximum isolation for unreviewed code |
| **Style consistency** | Shared CSS context + SDK components | Apps automatically inherit theme; no style bridging needed |
| **Authentication** | Scoped API keys per app | Leverages existing `api_keys` module; per-app rate limiting and audit |
| **Bundle format** | ESM via CDN or local path | Standard web format; works with any bundler |
| **Security boundary** | Trust tiers + CSP + ErrorBoundary | Layered approach; strictness scales with trust level |

---

## 15. Next Steps

1. **Gather feedback** on this RFC from core team and potential app developers
2. **Prototype** the app loader and SDK in a branch (2-3 days)
3. **Build a reference app** (e.g., "CRM Enrichment") to validate the SDK contract
4. **Write detailed spec** for Phase 1 based on RFC feedback
5. **Evaluate Module Federation** (Webpack/Vite) vs. plain dynamic `import()` for bundle loading
