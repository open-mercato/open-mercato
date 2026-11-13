# Per-Tenant Branding (Enterprise)

- **Status:** Draft — design only, ready for implementation review
- **Scope:** Enterprise module `branding_profiles` (`packages/enterprise/src/modules/branding_profiles/`) + minimal additive OSS seams in `@open-mercato/shared`, `@open-mercato/ui`, `@open-mercato/core` (auth login / nav) and the app shells
- **Tracks:** [#7317](https://github.com/open-mercato/open-mercato/issues/7317)
- **Follows:** [`2026-07-05-ds-theming-and-brand-customization.md`](../2026-07-05-ds-theming-and-brand-customization.md) (build-time theming; runtime per-tenant theming was its declared non-goal)
- **Risk:** `risk-medium` (touches three app shells and the admin nav payload; all OSS changes additive) · **Priority:** `priority-medium`
- **Hard constraint:** works fully **offline** — no CDN, no web fonts, no external services, no network calls at render or save time. Logos are stored in the database and served from the app's own origin.

## TLDR

Multi-tenant Open Mercato deployments cannot brand the product per tenant: the login page and portal always show the platform logo, the backend logo arrives only after a client fetch, there is no dark-mode logo, and colours are build-time `theme.css` only. This spec adds an **Enterprise `branding_profiles` module** that lets a tenant administrator set a **product name, light and dark logos, a primary and an accent colour** (with WCAG 2.1 contrast validation and a live preview), and paints that branding **on the server before first paint** on the **login, backend and portal shells**. OSS gains only a contract: a DI-overridable `tenantBrandingProvider` whose OSS default is a **no-op** (returns `null`, so every shell renders byte-identical to today), a never-throwing resolver with caching, and optional `branding` props on the three shells. The enterprise module overrides the DI key.

## Resolved assumptions (autonomous defaults)

Open Questions raised while drafting were resolved with the most reversible, smallest-scope answer. Each can be overridden before merge.

| # | Question | Applied default | Rationale |
|---|---|---|---|
| Q1 | Split the OSS provider contract and the Enterprise module into two specs? | **No — one spec, phased.** Phase 1 (OSS seam) ships as its own OSS PR and is inert; Phases 2–4 (Enterprise) depend on it. | The brief mandates a single enterprise spec with minimal OSS seams. The fresh-context scope review recommended a split (the seam also serves custom providers). If maintainers prefer, Phase 1 can be lifted verbatim into an OSS spec under `.ai/specs/` without design changes. |
| Q2 | Who owns the OSS default provider — `directory` (as #7317 proposed) or `shared`? | **`shared` DI defaults register a no-op provider** (`noopTenantBrandingProvider`). The existing `Organization.logoUrl` behaviour of the backend nav stays where it is and is used whenever the provider returns no logo. | Smallest OSS surface; no new `directory` subscribers; nav output with nothing registered stays byte-identical. |
| Q3 | Branding granularity: tenant, organization, or host? | **Tenant-level, one profile per tenant.** No `organization_id` column in v1; organization overrides and host mapping are deferred. Backend precedence: tenant profile logo → selected organization's `logoUrl` (today) → platform logo. | Tenant is the commercial unit of a multi-tenant deployment; org-level overrides can be added later as an additive column + resolver rule. |
| Q4 | Logo storage: attachments module or the profile row? | **Profile row** — validated base64 PNG/JPEG/WebP, ≤ 256 KB decoded per logo, served from a same-origin public route `GET /api/branding_profiles/logo/{tenantId}/{variant}?v={hash}`. | Works offline and on the unauthenticated login page; `attachmentService.createScoped` writes private partitions only, and a public partition would add a cross-module write path for two small images. |
| Q5 | Accept SVG logos? | **No in v1** (PNG/JPEG/WebP only). | SVG served from the app origin is an XSS vector on direct navigation; raster-only matches the existing `BrandStyle.logo` rule. Revisit with a sanitiser. |
| Q6 | What does "accent colour" map to? | **`--brand-violet` / `--brand-violet-foreground`** (the brand-accent tokens in the published safe-token contract). `--accent-indigo`, `--status-*`, `--accent*` scaffolding are never written. | Stays inside the DS theming contract of the predecessor spec. |
| Q7 | How does the login page know the tenant before login? | **`?tenant=<uuid>` query parameter, else the existing `om_login_tenant` cookie** (both already used by `login.tsx`). No host → tenant mapping in v1. | Reuses today's tenant-selection mechanism; host mapping needs a domain registry and is deferred. A deployment can still override `tenantBrandingProvider` with `varyByHost`. |
| Q8 | Should the per-browser design-system gallery preview win over a tenant style? | **Yes** — the preview style gains an `html` selector prefix so it wins by specificity. | Lets a designer preview a brand on top of the live tenant style; affects only browsers that opted into the gallery preview. |
| Q9 | Module enablement flag? | **Enabled with the base `OM_ENABLE_ENTERPRISE_MODULES` list** (like `record_locks`). Inert until a tenant saves a profile. | No extra env flag to remember; no behavioural change until configured. |
| Q10 | Favicon, e-mail templates, custom fonts, custom CSS? | **Out of scope for v1.** | Fonts would need bundling (offline); custom CSS is a security surface; favicon/e-mail are separate surfaces. |

## Overview

The design system already resolves every colour through CSS custom properties, and the `BrandStyle` contract in `packages/ui/src/theme/brand-style.ts` already validates WCAG contrast for `--primary*` and `--brand-*` tokens — but it is reachable only from the per-browser gallery preview (`BrandStyleRuntime`, localStorage, painted after hydration). Branding inputs today:

| Surface | Logo | Product name | Colours |
|---|---|---|---|
| Backend shell (`AppShell`) | selected org `Organization.logoUrl`, client-fetched via `GET /api/auth/admin/nav` → `brand` | i18n `appShell.productName` | build-time `theme.css` |
| Portal shell (`PortalLayoutShell`) | always `/open-mercato.svg` | organization name | none |
| Login (`auth/frontend/login.tsx`) | hard-coded `/open-mercato.svg` | i18n `auth.login.brandName` | none |

This spec turns `BrandStyle` into a server-resolvable, per-tenant value.

## Problem Statement

1. A deployment serving several tenants cannot show a tenant's logo or colours on login, portal or backend without forking the app shell.
2. The only per-tenant input (`Organization.logoUrl`) arrives client-side, so first paint always shows the platform logo (visible flash).
3. There is no dark-mode logo; a dark wordmark disappears on a dark sidebar.
4. There is no admin UI to set branding, and nothing stops an admin from choosing an unreadable colour pair.
5. Enterprise customers (white-label resellers, agencies) consistently ask for this; #7317 was filed by a contributor who already built a fork of it.

## User Stories & Acceptance Criteria

Roles: **Tenant admin** (has `branding_profiles.manage`), **Viewer** (has `branding_profiles.view` only), **Back-office user**, **Portal customer**, **Anonymous visitor** (login page).

### Epic E1 — Configure branding (settings page)

- **US-B1** As a tenant admin, I open *Settings → Branding* and see the current branding (or platform defaults) with a live preview, so I know what users see today.
  - AC: first run shows platform defaults, an "Not customised yet" empty state, and the preview in light mode.
  - AC: a Viewer sees the page read-only (inputs disabled, no Save/Reset); a user without `branding_profiles.view` gets the standard access-denied page and no sidebar entry.
- **US-B2** As a tenant admin, I set a product name (1–60 chars) and see it in the preview immediately.
  - AC: empty name means "use platform name"; over-length shows a field error.
- **US-B3** As a tenant admin, I upload a light logo and an optional dark logo (PNG/JPEG/WebP, ≤ 256 KB) and see them in the preview's light and dark modes.
  - AC: wrong type, oversize, or undecodable file → inline field error, nothing uploaded; dark logo absent → light logo is used on dark surfaces; "Remove" clears a logo.
  - AC: the file is read locally (FileReader → data URL); no network request until Save.
- **US-B4** As a tenant admin, I pick a primary and an accent colour (hex input + native colour picker) and see contrast results.
  - AC: the foreground for each colour is auto-picked (white or near-black, whichever contrasts more); light and dark variants are derived automatically.
  - AC: each checked pair shows its ratio and a pass/warn/fail badge (text ≥ 4.5:1 required; UI vs background ≥ 3:1 warning). Any fail disables Save and shows a suggestion ("Use #0A0A0A text (12.1:1) or a darker primary").
- **US-B5** As a tenant admin, I toggle the preview between Login / Backend / Portal and Light / Dark, so I can check every surface before saving.
- **US-B6** As a tenant admin, I choose where branding applies: backend (always), login page (toggle, default on), portal (toggle, default on).
- **US-B7** As a tenant admin, I save; the page confirms with a flash message and my own backend repaints with the new brand on the next navigation.
  - AC: `Cmd/Ctrl+Enter` saves, `Escape` discards unsaved changes after confirmation; a concurrent edit by another admin yields the standard optimistic-lock conflict bar (409).
- **US-B8** As a tenant admin, I reset to platform defaults (confirmation dialog); undo is available from the flash/undo toast.

### Epic E2 — Branded shells (first paint)

- **US-B9** As a back-office user, the first HTML response of any `/backend` page already carries my tenant's colours and logo (light/dark) and product name — no platform-logo flash.
- **US-B10** As an anonymous visitor opening `/login?tenant=<id>` (or returning with the `om_login_tenant` cookie), I see the tenant's logo, name and colours on first paint; an unknown or inactive tenant id shows platform defaults without an error that reveals anything new.
- **US-B11** As a portal customer on `/{orgSlug}/portal/...`, I see the owning tenant's branding on first paint when the profile applies to the portal.
- **US-B12** As any user, branding never breaks a page: if the profile is corrupt or the provider fails, the shell renders platform defaults.

### Cross-cutting rules

- Branding never alters semantic tokens (`--status-*`, `--accent-indigo`, z-index, focus anatomy).
- Branding of tenant A is never visible in tenant B (cache keys and queries are tenant-scoped).
- Everything works with the network unplugged.

## Proposed Solution

### OSS seam (Phase 1)

1. **Move `BrandStyle` to shared.** `@open-mercato/shared/lib/branding/brand-style` gets the zod schema, `BrandStyle` type, `contrastRatio(a, b)`, `pickReadableForeground(bg)`, and `brandStyleCss(style, { selectorPrefix? })`. `@open-mercato/ui/theme/brand-style` keeps re-exporting them (no import breaks) and keeps its localStorage helpers. The gallery preview passes `selectorPrefix: 'html'` so it wins over the tenant style (Q8).
2. **Provider contract** in `@open-mercato/shared/lib/branding/tenantBranding`:

```ts
export type TenantBrandingSurface = 'backend' | 'portal' | 'auth'

export type TenantBrandingLogo = { src: string; alt?: string; width?: number; height?: number }

export type TenantBranding = {
  productName?: string
  logos?: { light: TenantBrandingLogo; dark?: TenantBrandingLogo }
  style?: BrandStyle            // logo field ignored; logos travel in `logos`
}

export type TenantBrandingResolveInput = {
  tenantId: string | null
  organizationId: string | null
  surface: TenantBrandingSurface
  host: string | null           // populated only when provider.varyByHost === true
}

export interface TenantBrandingProvider {
  resolve(input: TenantBrandingResolveInput): Promise<TenantBranding | null>
  varyByHost?: boolean
  varyByOrganization?: boolean  // adds organizationId to the cache key
  id: string                    // cache-key profile, e.g. 'noop' | 'branding_profiles'
}

export const noopTenantBrandingProvider: TenantBrandingProvider  // resolve → null

export function resolveTenantBranding(
  container: AppContainer, input: TenantBrandingResolveInput,
): Promise<TenantBranding | null>          // never throws

export function invalidateTenantBrandingCache(
  container: AppContainer, tenantId: string,
): Promise<void>
```

3. **Resolver semantics** (`resolveTenantBranding`):
   - `tenantId === null` → `null` without calling the provider.
   - Resolves `tenantBrandingProvider` from DI; missing key → no-op.
   - Cache via DI `cache`: key `tenant-branding:{providerId}:{tenantId}:{surface}[:{organizationId} when varyByOrganization][:{host} when varyByHost]`, tags `['tenant-branding:{tenantId}', 'tenant-branding']` (never the shared `tenant:{id}` tag, so invalidation does not flush other modules' caches), TTL 300 s; caches `null` too (negative cache) so un-branded tenants cost one lookup per 5 min.
   - Provider call wrapped in a 2 s timeout; on throw/timeout: `reportError`, return `null`, and remember the failure in-process for 30 s (circuit) per tenant.
   - Validates field-by-field: invalid `style` (strict schema: only allow-listed token names, values matching `^#[0-9a-f]{6}$`, contrast) drops only `style` — this is also the CSS-injection guard, because `brandStyleCss` only ever serialises schema-parsed values (it already calls `schema.parse`) and therefore cannot emit `<`, `}` or `;` from provider input; invalid logo `src` (must be a root-relative path, or a `data:image/(png|jpeg|webp);base64,` URL ≤ 350 000 chars) drops only that logo; `productName` trimmed, 1–60 chars, control chars stripped. `https://` URLs are **accepted for custom providers** but never produced by the enterprise module (offline).
4. **DI default**: `packages/shared/src/lib/di/container.ts` registers `tenantBrandingProvider: asValue(noopTenantBrandingProvider)` next to the existing platform defaults.
5. **Server style component**: `@open-mercato/ui/theme/TenantBrandStyle` — a server component `({ branding, nonce })` rendering `<style id="om-tenant-brand" nonce={nonce}>` with `brandStyleCss(branding.style)`; renders nothing when `style` is absent.
6. **Shell wiring** (all props optional; absent → today's output):
   - `BackendChromeBrand` gains optional `darkLogo`. `AppShell` gains optional `initialBrand: BackendChromeBrand` used for the first render until the nav payload arrives. `ShellLogo` renders the light logo with `dark:hidden` and the dark logo with `hidden dark:block` (light used for both when no dark logo); provider logos render with `unoptimized` (no Next image optimiser round-trip).
   - `GET /api/auth/admin/nav`: when the resolver returns `logos`/`productName` for surface `backend`, `brand` uses them; otherwise the existing organization-logo logic runs unchanged.
   - Backend layout (`apps/mercato/src/app/(backend)/backend/layout.tsx` + template mirror): `resolveTenantBranding(container, { tenantId: auth.tenantId, organizationId: auth.orgId, surface: 'backend' })`; passes `initialBrand` + `productName` to `AppShell`, renders `<TenantBrandStyle>`.
   - Portal layout (`(frontend)/layout.tsx` + mirror): after the org is resolved, resolve with surface `portal`; pass `branding` to `PortalLayoutShell` (`logo`, `darkLogo`, `productName`), render `<TenantBrandStyle>`.
   - Login (`apps/mercato/src/app/login/page.tsx` + mirror): becomes an async server component reading `searchParams.tenant` or the `om_login_tenant` cookie (must parse as UUID), resolves with surface `auth`, renders `<TenantBrandStyle>` and passes `branding` to `LoginPage` (`auth/frontend/login.tsx` uses it instead of `/open-mercato.svg` and `auth.login.brandName` when present).

### Enterprise module `branding_profiles` (Phases 2–4)

Owns the data, the admin UI, the validation/derivation, and a provider that overrides `tenantBrandingProvider` in its `di.ts`.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Everything in OSS (`directory` default provider + UI) as #7317 proposed | Product decision: per-tenant branding is an Enterprise capability (#7317 maintainer comment). OSS keeps only the seam. |
| Logos in `attachments` (public partition) | Needs a public partition and a cross-module write path; `createScoped` is private-only. Two ≤ 256 KB images per tenant fit the row. |
| Inline logos as `data:` URLs in SSR HTML | Bloats every HTML response and needs `img-src data:` in CSP. A same-origin route with `immutable` caching costs one cached request. |
| Client-side branding fetch after hydration | Exactly the flash this spec removes. |
| Full palette (11 shades) like the gallery Colour Studio | Larger surface than the published safe-token contract; v1 derives only `--primary*` and `--brand-violet*`. |

## Architecture

```mermaid
flowchart LR
  subgraph OSS["OSS (new, additive)"]
    R[resolveTenantBranding] -->|DI| P{{tenantBrandingProvider}}
    P -.default.-> N[noopTenantBrandingProvider]
    R --> C[(DI cache, tag tenant:id)]
    L1[login page.tsx] --> R
    L2[backend layout.tsx] --> R
    L3["(frontend) portal layout.tsx"] --> R
    NAV[GET /api/auth/admin/nav] --> R
    S[TenantBrandStyle server style]
  end
  subgraph ENT["Enterprise branding_profiles (new)"]
    EP[BrandingProfileProvider] --> DB[(branding_profiles)]
    UI[Settings → Branding page] --> API[/api/branding_profiles/profile/]
    API --> CMD[commands save/reset] --> DB
    CMD -->|invalidateTenantBrandingCache| C
    LOGO[/api/branding_profiles/logo/:tenantId/:variant/] --> DB
  end
  P -.overridden by di.ts.-> EP
```

Takeaway: every shell asks one resolver; the resolver asks one DI key; the enterprise module is the only thing that answers it with real data. Removing the module returns every shell to the no-op path.

**Request flow (backend first paint):** layout → `resolveTenantBranding` → cache hit (≈ 0 ms) or provider → `findOneWithDecryption(em, BrandingProfile, { tenantId, deletedAt: null, isActive: true }, {}, { tenantId })` + one `fields: ['id','sha256']` query for the referenced assets → map to `TenantBranding` (logos become `/api/branding_profiles/logo/{tenantId}/{light|dark}?v={hash}`) → `<TenantBrandStyle>` + `AppShell initialBrand` → HTML. The browser fetches the logo from the same origin (cached `immutable`).

**Surface toggles:** the provider returns `null` for `auth` when `applyToLogin=false`, and for `portal` when `applyToPortal=false`. Inactive tenants (`Tenant.isActive=false`) resolve `null` for every surface.

**Module files** (`packages/enterprise/src/modules/branding_profiles/`):

```
index.ts            metadata { id: 'branding_profiles', enterprise: true }
acl.ts              features
setup.ts            defaultRoleFeatures (admin → view+manage)
di.ts               overrides tenantBrandingProvider
events.ts           createModuleEvents: branding_profiles.profile.{saved,reset}
data/entities.ts    BrandingProfile, BrandingLogoAsset
data/validators.ts  zod: profileUpsertSchema, logoDataUrlSchema, hexColor
lib/palette.ts      deriveBrandStyle({ primary, accent }) → BrandStyle + contrast report
lib/logo.ts         decode + magic-byte sniff + size/hash
lib/provider.ts     createBrandingProfileProvider({ em })
commands/profile.ts branding_profiles.profile.save / .reset (undoable)
api/profile/route.ts            GET / PUT / DELETE
api/logo/[tenantId]/[variant]/route.ts   public GET
backend/branding/page.tsx + page.meta.ts  settings page
components/BrandingPreview.tsx  preview frames (login/backend/portal, light/dark)
i18n/{en,pl,de,es,ko}.json
migrations/ + .snapshot-open-mercato.json
__tests__/, __integration__/
```

## Data Model

### `BrandingProfile` → table `branding_profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid, not null | unique where `deleted_at is null` (one profile per tenant) |
| `product_name` | text, null | 1–60 chars |
| `primary_color` | text, null | `#RRGGBB`; null → platform default |
| `accent_color` | text, null | `#RRGGBB`; null → platform default |
| `style` | jsonb, null | derived `BrandStyle` (`version`, `light`, `dark`, `seeds`); `logo: null` always; recomputed on save, validated against the shared schema |
| `logo_light_asset_id` | uuid, null | FK id → `branding_logo_assets.id` (same tenant) |
| `logo_dark_asset_id` | uuid, null | FK id → `branding_logo_assets.id` (same tenant) |
| `apply_to_login` | boolean, default true | |
| `apply_to_portal` | boolean, default true | |
| `is_active` | boolean, default true | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | `updated_at` drives optimistic locking |

### `BrandingLogoAsset` → table `branding_logo_assets` (immutable)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid, not null | index; every read filters it |
| `mime_type` | text | `image/png` \| `image/jpeg` \| `image/webp` |
| `content_base64` | text | decoded size ≤ 256 KB |
| `sha256` | text | full hex digest; first 16 chars are the cache-busting `v` |
| `byte_size`, `width`, `height` | int | width/height from the client, sanity-checked against PNG/WebP headers when parseable |
| `created_at` | timestamptz | |

Assets are write-once. The profile references them by id, so the profile row stays small (the provider reads only the profile plus the two asset `sha256` values, never the blobs), and undo snapshots hold asset ids, not base64. On every save the command deletes the tenant's assets that are unreferenced **and** older than 30 days (undo retention), bounded to that tenant.

- No `organization_id` (Q3): the entity is tenant-scoped; every query filters `tenant_id` from the authenticated scope, never from the body.
- No ORM relations; `tenant_id` is a plain FK id.
- **Sensitive data:** none — branding is public by design (shown pre-login). No encryption map; reads still use `findOneWithDecryption` per project rule.
- Migration: two new tables + partial unique index on `branding_profiles(tenant_id) where deleted_at is null`. Reversible by dropping the table.

## API Contracts

All routes export `metadata` per method and `openApi`. Writes go through commands and the mutation-guard registry (custom route: `runMutationGuards` with `update`/`delete` mapping, `afterSuccessCallbacks` run after commit).

### `GET /api/branding_profiles/profile` — `requireFeatures: ['branding_profiles.view']`

```json
200 {
  "profile": {
    "id": "uuid", "productName": "Acme Commerce",
    "primaryColor": "#0C71C6", "accentColor": "#7C3AED",
    "logoLight": { "url": "/api/branding_profiles/logo/<tenantId>/light?v=3f9a…", "bytes": 18234, "mimeType": "image/png" },
    "logoDark": null,
    "applyToLogin": true, "applyToPortal": true,
    "style": { "version": 1, "light": { "--primary": "#0C71C6", "…": "…" }, "dark": { "…": "…" } },
    "updatedAt": "2026-11-13T10:00:00.000Z"
  } | null,
  "defaults": { "productName": "Open Mercato" }
}
```

### `PUT /api/branding_profiles/profile` — `requireFeatures: ['branding_profiles.manage']`

Upsert for the caller's tenant. The optimistic-lock header `x-om-ext-optimistic-lock-expected-updated-at` (built with `buildOptimisticLockHeader`, enforced server-side with `enforceCommandOptimisticLock`) is required when a profile exists.

```ts
const profileUpsertSchema = z.object({
  productName: z.string().trim().max(60).nullable(),
  primaryColor: hexColor.nullable(),
  accentColor: hexColor.nullable(),
  primaryForeground: hexColor.optional(),   // explicit override; else auto-picked
  accentForeground: hexColor.optional(),
  logoLight: z.union([logoDataUrlSchema, z.null()]).optional(), // undefined = keep
  logoDark: z.union([logoDataUrlSchema, z.null()]).optional(),
  applyToLogin: z.boolean(),
  applyToPortal: z.boolean(),
}).strict()
```

- Server derives `style` via `deriveBrandStyle` and validates it with the shared schema.
- `200 { profile }` (same shape as GET). `409` optimistic-lock conflict body. `413` when the body exceeds 1 MB. `422 { error, fieldErrors: { primaryColor?: '…', logoLight?: '…' }, contrast: [{ pair, mode, ratio, required }] }` on validation or contrast failure.
- Logo validation: decoded size ≤ 256 KB, magic bytes match the declared MIME (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF….WEBP`), else 422.

### `DELETE /api/branding_profiles/profile` — `requireFeatures: ['branding_profiles.manage']`

Soft-deletes the profile (reset to defaults). `200 { ok: true }`; undo restores the snapshot.

### `GET /api/branding_profiles/logo/{tenantId}/{variant}` — public (`requireAuth: false`)

- `variant ∈ { light, dark }`; `tenantId` must be a UUID.
- Reads only the referenced `branding_logo_assets` row (tenant-filtered). Returns the decoded bytes with the stored MIME, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `ETag: "<hash>"`, and `Cache-Control: public, max-age=31536000, immutable` when `?v` equals the current hash (else `public, max-age=300`).
- `404` for no profile, inactive profile/tenant, missing variant (dark falls back to nothing; the shell decides). No auth needed because the login page is anonymous; the response reveals nothing beyond what `/api/directory/tenants/lookup` already reveals for a known tenant UUID.

### Commands

| Command id | Undo | Side effects |
|---|---|---|
| `branding_profiles.profile.save` | restores the previous snapshot — scalar fields + asset ids (or soft-deletes when created) | emits `branding_profiles.profile.saved`; `invalidateTenantBrandingCache(tenantId)` (tag `tenant-branding:{tenantId}`) after commit (reversible: undo re-invalidates) |
| `branding_profiles.profile.reset` | restores the snapshot | emits `branding_profiles.profile.reset`; invalidates cache |

### Events

`branding_profiles.profile.saved`, `branding_profiles.profile.reset` — payload `{ tenantId, profileId }`, `clientBroadcast: true` so other open backend tabs of the same tenant can `router.refresh()` (DOM Event Bridge; best effort).

### ACL features (`acl.ts`)

| Feature | Meaning | Default roles (`setup.ts`) |
|---|---|---|
| `branding_profiles.view` | see the Branding settings page and GET the profile | admin |
| `branding_profiles.manage` | save / reset | admin |

Superadmin covered via wildcard; checks go through `authorizeFeatures` (wildcard-aware).

## UI/UX

**Page:** `/backend/branding` — `pageContext: 'settings'`, group *System*, `requireFeatures: ['branding_profiles.view']`, title key `branding_profiles.page.title`.

Layout: two columns on ≥ lg (form left, sticky preview right), stacked on small screens.

- **Form** — `CrudForm` with custom field renderers, `initialValues.updatedAt` for the optimistic-lock header:
  - *Identity*: Product name (placeholder shows the platform name).
  - *Logos*: two drop zones (Light / Dark) with thumbnail on light and dark chips, file meta, Replace/Remove. Client checks type/size/decodability (reusing the gallery `readBrandLogo` logic, moved into the module) and records natural width/height.
  - *Colours*: Primary and Accent — hex input + native `<input type="color">` (works offline), "Auto" foreground with optional override. Contrast table per colour × mode: pair, ratio, `StatusBadge` (pass / warn / fail).
  - *Apply to*: Backend (always, disabled checkbox with hint), Login page, Customer portal.
  - Footer: Save (disabled while any contrast check fails), Reset to defaults (`ConfirmDialog`), Discard changes.
- **Preview** — `BrandingPreview` renders three miniature frames (Login card, Backend sidebar + header + primary button + tab, Portal header + CTA) inside a container whose `style` attribute sets the derived CSS variables, so the preview never touches the real page. Segmented controls: surface (Login / Backend / Portal) and mode (Light / Dark). No iframe, no network.
- States: loading (`LoadingMessage`), load error (`ErrorMessage`), read-only (Viewer), empty ("Not customised yet — showing platform defaults"), dirty indicator, 409 conflict bar (`surfaceRecordConflict`), 422 field errors mapped to fields.
- DS: semantic tokens only; the preview's brand colours are applied via CSS variables, not hard-coded classes. All strings via i18n keys `branding_profiles.*`.
- Accessibility: colour inputs have text equivalents; contrast results are text, not colour-only; logo previews have alt text from the product name.

Proposed clickable prototype (pending, not accepted): [`.ai/prototypes/per-tenant-branding/index.html`](../../prototypes/per-tenant-branding/index.html). It has 10 screens covering US-B1 to US-B12, works fully offline, and computes contrast live. Rendered proposal stills:

| Screen | Image |
|---|---|
| First run (empty state) | [mockup-01-light.png](assets/per-tenant-branding/mockup-01-light.png) |
| Editor + live preview (light / dark) | [mockup-02-light.png](assets/per-tenant-branding/mockup-02-light.png), [mockup-02-dark.png](assets/per-tenant-branding/mockup-02-dark.png) |
| Contrast failure, Save disabled | [mockup-03-light.png](assets/per-tenant-branding/mockup-03-light.png) |
| Branded login (first paint) | [mockup-07-light.png](assets/per-tenant-branding/mockup-07-light.png) |
| Branded backend, light + dark | [mockup-08-light.png](assets/per-tenant-branding/mockup-08-light.png) |
| Branded portal | [mockup-09-light.png](assets/per-tenant-branding/mockup-09-light.png) |

## Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|---|---|
| Provider throws / DB down while rendering a shell | Resolver catches, `reportError`, returns `null` → platform defaults; 30 s circuit avoids hammering. |
| Stored `style` fails schema (e.g. after a contrast rule tightens) | Resolver drops `style`; logos/name still apply; settings page shows the failing pairs so the admin can fix. |
| Admin saves, other app instances still cached | Cache invalidated by tag `tenant-branding:{tenantId}` (never the shared `tenant:{id}` tag) through the shared DI cache (Redis/SQLite strategies are shared across instances); with the per-process memory strategy staleness is bounded by the 300 s TTL. |
| Huge upload | Client rejects > 256 KB; server rejects body > 1 MB (413) and decoded > 256 KB (422). |
| MIME spoofing (HTML labelled `image/png`) | Magic-byte check → 422; route also sends `nosniff` + sandbox CSP. |
| Unknown / malformed `?tenant=` on login | Not a UUID → ignored; unknown tenant → `null` → platform defaults; no distinct error. |
| Tenant deactivated | Provider returns `null`; logo route 404. |
| Gallery preview active in the same browser | Preview style (`html`-prefixed) wins; clearing the preview reveals the tenant style. |
| Dark mode with no dark logo | Light logo shown on both; settings page warns "No dark logo — check legibility in the Dark preview". |
| Module disabled after use | DI falls back to no-op; table remains; shells return to defaults. |
| CSP nonce missing (dev) | `<style>` rendered without nonce, same as the existing theme init script path. |

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Shell regression for apps that register nothing | High | every OSS app | No-op default; resolver short-circuits on `null`; unit test asserts nav `brand` byte-identical; integration test asserts default login HTML unchanged | Low |
| Cross-tenant / cross-org branding leak via cache key | High | multi-tenant deployments | Key includes `tenantId`, surface, and `organizationId` whenever a provider declares `varyByOrganization`; tenant derived only from auth/cookie/org lookup; integration test TC-BRAND-007 | Low |
| Stored XSS via logo | High | login/backend/portal | Raster-only, magic-byte check, served with `nosniff` + sandbox CSP, rendered only via `<img>` | Low |
| CSS injection via `<style>` on the anonymous login page | High | login/backend/portal | Only strict-schema-parsed tokens (allow-listed names, `#RRGGBB` values) are serialised; unit test feeds `</style><script>` and `red;}body{` payloads and asserts they are dropped | Very low |
| Base64 blobs inflating rows, cache misses and the undo log | Medium | DB, command log | Write-once `branding_logo_assets` table referenced by id; provider never reads blobs; snapshots hold ids | Low |
| Unreadable brand colours | Medium | all users of a tenant | Server-side shared schema (4.5:1) + client contrast table; Save disabled on fail | Low |
| SSR latency on every backend request | Medium | backend TTFB | 300 s cache incl. negative cache; single indexed query on miss; 2 s timeout | Low |
| Standalone apps with customised layouts don't get first-paint branding | Medium | standalone adopters | Template mirror + `UPGRADE_NOTES.md` entry; nav still brands the sidebar after load | Medium (documented) |
| Login page becomes dynamic (reads cookies) | Low | login prerender | Login route already reads search params client-side; becoming `dynamic` costs one server render; acceptable | Low |
| Moving `BrandStyle` to shared breaks imports | Low | ui consumers | Re-export from the old path; no rename | Very low |

## Migration & Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md`:

- **New (additive):** import paths `@open-mercato/shared/lib/branding/{brand-style,tenantBranding}`, `@open-mercato/ui/theme/TenantBrandStyle`; DI key `tenantBrandingProvider`; optional props `AppShell.initialBrand`, `BackendChromeBrand.darkLogo`, `PortalLayoutShell.branding`, `LoginPage.branding`; optional `brandStyleCss` second argument.
- **Moved with re-export:** `BrandStyle` schema/type/`brandStyleCss` — `@open-mercato/ui/theme/brand-style` keeps exporting the same names.
- **Unchanged:** nav API response shape (only an optional field added), event IDs, existing routes, DB schema of OSS modules.
- **Enterprise-only:** new table, routes, ACL features, events, settings page.
- Template mirror for the three app files (`yarn template:sync:fix`); `UPGRADE_NOTES.md` entry for standalone apps with customised layouts.
- Rollback: disable the module (DI falls back), revert the OSS phase independently; the table drop is the only irreversible step and is not needed for rollback.

## Phasing

| Phase | Delivers | Ships alone? |
|---|---|---|
| **1 — OSS seam** | shared `brand-style` + `tenantBranding` contract/resolver, no-op DI default, `TenantBrandStyle`, optional shell props, nav + layouts + login wired through the resolver | Yes — zero visible change with the no-op provider |
| **2 — Enterprise data + provider** | `branding_profiles` entity, migration, validators, palette/logo libs, provider + DI override, logo route, commands, profile API | Yes — branding configurable via API, visible on all shells |
| **3 — Admin settings page** | Settings → Branding page with live preview, contrast validation, i18n | Yes |
| **4 — Hardening & docs** | integration suite complete, docs page, UPGRADE_NOTES, enterprise README row | Yes |

## Implementation Plan

### Phase 1 — OSS seam (inert by default)

1. Create `packages/shared/src/lib/branding/brand-style.ts` (schema, type, `contrastRatio`, `pickReadableForeground`, `brandStyleCss(style, { selectorPrefix })`); make `packages/ui/src/theme/brand-style.ts` re-export it; gallery preview passes `selectorPrefix: 'html'`. Unit tests: WCAG reference pairs, prefix output, re-export identity.
2. Create `packages/shared/src/lib/branding/tenantBranding.ts` (types, `noopTenantBrandingProvider`, `resolveTenantBranding`, `invalidateTenantBrandingCache`). Unit tests: null tenant short-circuit, CSS-injection payloads dropped, `varyByOrganization` key separation, cache hit/miss/negative cache, timeout → null + `reportError`, 30 s circuit, field-level validation drops only invalid parts, tenant isolation of keys.
3. Register `tenantBrandingProvider` (no-op) in `packages/shared/src/lib/di/container.ts`.
4. Add `packages/ui/src/theme/TenantBrandStyle.tsx`; add `darkLogo` to `BackendChromeBrand`, `initialBrand` to `AppShell`, dark/light switching + `unoptimized` in `ShellLogo`; `branding` prop on `PortalLayoutShell`/`PortalShell`. Unit tests (RTL): renders nothing without branding; light/dark classes.
5. `GET /api/auth/admin/nav`: consult the resolver for surface `backend` before the org-logo fallback. Unit test: no-op provider → byte-identical payload snapshot.
6. Wire `apps/mercato` backend layout, `(frontend)/layout.tsx`, `login/page.tsx` (+ `auth/frontend/login.tsx` `branding` prop); mirror into `packages/create-app/template` (`yarn template:sync:fix`). Run `yarn generate`, `yarn build:packages`, `yarn typecheck`, `yarn test`.

### Phase 2 — Enterprise data, provider, API

7. Scaffold `packages/enterprise/src/modules/branding_profiles/` (`index.ts`, `acl.ts`, `setup.ts`, `events.ts`, i18n stubs); enable it in `apps/mercato/src/modules.ts` base enterprise list; `yarn generate`.
8. `data/entities.ts` (`BrandingProfile`, `BrandingLogoAsset`) + `data/validators.ts`; `yarn db:generate`, keep only the `branding_profiles` / `branding_logo_assets` migration + snapshot (do **not** run `yarn db:migrate` without asking).
9. `lib/palette.ts` (`deriveBrandStyle`: light primary as given; hover = OKLCH L−0.06; dark primary L ≥ 0.65; foregrounds auto-picked; accent → `--brand-violet*`; returns `{ style, contrast[] }`) and `lib/logo.ts` (decode, magic bytes, size, hash). Unit tests with fixed fixtures (dark brand, pastel, mid-luminance valley, achromatic).
10. `lib/provider.ts` + `di.ts` override; respects `applyToLogin`/`applyToPortal`/`isActive`/tenant active. Unit tests.
11. `commands/profile.ts` (save/reset with undo snapshots, cache invalidation after commit, events).
12. `api/profile/route.ts` (GET/PUT/DELETE, mutation guards, optimistic lock, openApi) and `api/logo/[tenantId]/[variant]/route.ts` (headers as specified). Integration tests TC-BRAND-001…009.

### Phase 3 — Admin settings page

13. `backend/branding/page.meta.ts` + `page.tsx` (CrudForm, custom renderers for logo and colour fields, contrast table, Save gating, reset dialog, keyboard shortcuts).
14. `components/BrandingPreview.tsx` (three frames × light/dark, scoped CSS variables).
15. i18n for en/pl/de/es/ko; `yarn i18n:check-sync`, `yarn i18n:check-usage`. Integration test TC-BRAND-010…011.

### Phase 4 — Hardening & docs

16. Docs: `apps/docs/docs/framework/...` page "Per-tenant branding (Enterprise)" + provider contract for custom providers; `UPGRADE_NOTES.md` entry; enterprise specs README row.
17. Full gate (`.ai/agentic.config.json` validation commands) and manual QA in light/dark on all three shells, network disabled.

## Integration Test Plan (offline, local)

All tests live in `packages/enterprise/src/modules/branding_profiles/__integration__/`, run with `yarn test:integration` (Playwright) and `OM_ENABLE_ENTERPRISE_MODULES=true` against the local app + local Postgres. They create their own tenant/org/users via API fixtures, generate logo fixtures in-test (tiny PNG/JPEG/WebP byte arrays encoded to base64 — no files downloaded), and clean up in `finally`. No test touches the network beyond `localhost`.

| ID | Covers | Assertions |
|---|---|---|
| TC-BRAND-001 | Save + read profile | PUT name/colours → 200; GET returns them + derived `style` + `updatedAt` |
| TC-BRAND-002 | Optimistic lock | PUT with stale `updatedAt` → 409 conflict body |
| TC-BRAND-003 | Contrast validation | explicit `primaryForeground: #FFFFFF` on `#FFE600` → 422 with `fieldErrors.primaryColor` and `contrast[]` |
| TC-BRAND-004 | Logo upload + public route | PNG/WebP saved; `GET /api/branding_profiles/logo/{tenant}/light?v=hash` → 200, correct MIME, `nosniff`, `immutable`; no cookie needed |
| TC-BRAND-005 | Logo rejection | > 256 KB → 422; SVG → 422; HTML bytes labelled PNG → 422 |
| TC-BRAND-006 | Backend first paint | `request.get('/backend')` raw HTML (no JS) contains `id="om-tenant-brand"` with `--primary:#…`, the logo route URL and the product name |
| TC-BRAND-007 | Tenant isolation | tenant B admin GET → B's (empty) profile; B's `/backend` HTML has no A tokens; B cannot address A's profile |
| TC-BRAND-008 | RBAC | user without `manage` → PUT/DELETE 403; without `view` → GET 403 and page denied |
| TC-BRAND-009 | Login + portal SSR, toggles, reset | `/login?tenant=A` HTML branded; `applyToLogin=false` → default; `/{slug}/portal/login` branded; `applyToPortal=false` → default; DELETE → next render default (cache invalidated); unknown tenant → default |
| TC-BRAND-010 | Settings UI live preview | change primary → preview frame CSS var updates before save; failing pair shows fail badge and Save disabled; dark toggle shows dark logo |
| TC-BRAND-011 | Settings UI save/reset flow | upload logo via file chooser (in-memory buffer), save → flash; reset → confirm dialog → defaults; undo restores |
| TC-BRAND-012 | OSS no-op path (core suite, module disabled) | `/login` and `/backend` HTML contain no `om-tenant-brand`; nav `brand` equals pre-change snapshot |

Unit suites: `packages/shared/src/lib/branding/__tests__/*`, `packages/enterprise/src/modules/branding_profiles/__tests__/*` (palette, logo, provider, commands), `packages/core/src/modules/auth/__tests__/nav-brand.test.ts`.

## Final Compliance Report

- Tenant isolation: tenant derived from auth / org lookup / validated cookie only; cache keys + tags tenant-scoped. ✔
- Module isolation: no ORM relations; OSS reaches the enterprise module only through a DI key. ✔
- Canonical mechanisms: commands with undo, mutation guards, optimistic locking via `updated_at`, DI cache with tags, `CrudForm`, `apiCall`, i18n, `createModuleEvents`. ✔
- Security: zod validation, raster-only logos with magic-byte check, sandboxed logo responses, no secrets, no hand-rolled crypto (sha256 via Node `crypto` only for cache-busting hash). ✔
- DS: only safe identity tokens written; semantic tokens untouched; no hard-coded status colours. ✔
- Offline: no CDN, fonts, or external calls anywhere in the render, save or test paths. ✔
- Backward compatibility: all OSS changes additive or re-exported. ✔

## Changelog

- **2026-11-13** — Initial enterprise spec (from #7317): OSS `tenantBrandingProvider` seam with no-op default, Enterprise `branding_profiles` module, admin settings page with WCAG validation and live preview, SSR first-paint branding on login/backend/portal, offline-only storage and test plan.

### Review — 2026-11-13
- **Reviewer**: Agent (fresh-context scope-cohesion subagent + author checklist pass)
- **Scope**: Reviewer verdict SPLIT (OSS seam vs enterprise module). Kept as one phased spec per the brief; recorded under Q1 as an override option.
- **Security**: Fixed — CSS-injection guard made explicit (strict schema before `<style>` serialisation); logos raster-only with magic bytes + sandbox CSP.
- **Performance**: Fixed — logos moved to write-once `branding_logo_assets`; provider no longer reads blobs.
- **Cache**: Fixed — module-specific `tenant-branding:{tenantId}` tag; `varyByOrganization` added to the key contract.
- **Commands**: Fixed — undo snapshots carry asset ids, not base64.
- **Verdict**: Approved for implementation review

### Re-review — 2026-11-13
- **Cache**: Aligned the multi-instance edge-case row with the resolver and command contracts: invalidate `tenant-branding:{tenantId}`, never the shared `tenant:{id}` tag. Addresses the requested change from @haxiorz.
