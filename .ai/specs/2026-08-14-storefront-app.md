# Storefront Application

| Field | Value |
|-------|-------|
| **Status** | Specification |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 10, Phase 4 |
| **Deliverables** | `apps/storefront`, `@open-mercato/storefront-ui` |
| **Depends on** | [Storefront Public API](./2026-08-14-storefront-public-api.md), [Cart Module](./2026-08-14-cart-module.md), [Checkout Funnel](./2026-03-19-checkout-simple-checkout.md), [Merchandising](./2026-08-14-storefront-merchandising.md), [Customer Account](./2026-08-14-storefront-customer-account.md) |
| **Carries forward** | SPEC-029 v3 §14–18 and the app half of §24 |

---

## TLDR

**Key Points:**
- The reference storefront: a Next.js application consuming only the public HTTP API, with no dependency on `@open-mercato/core`. It proves the API contract is complete and gives tenants a real starting point rather than a specification to implement.
- Per [ADR-8](./2026-08-14-ecommerce-suite-roadmap.md#adr-8--the-storefront-shares-tokens-not-components) it may depend on a small, budgeted `@open-mercato/storefront-ui` — a deliberate softening of SPEC-029 v3 §14.2, which forbade all shared UI and would have meant a second independently-maintained accessible dialog, sheet and combobox. Two implementations of a focus trap is how WCAG regressions ship.
- Accessibility is a **gate, not a phase**: WCAG 2.2 AA is asserted by automated axe runs per route plus a manual keyboard and screen-reader pass, and a failure blocks the phase.
- The app is server-first: catalogue pages render on the server with buyer-aware caching, and only genuinely interactive surfaces — variant selection, filters, cart, checkout — are client components.

**Scope:**
- `apps/storefront` route tree, data layer, state and SEO
- `@open-mercato/storefront-ui` with a CI-enforced size and dependency budget
- Component specifications for catalogue, PDP, filters, cart, checkout and account
- Design system, responsive strategy, WCAG 2.2 AA, performance budgets
- Playwright coverage

**Concerns:**
- Buyer-aware pricing fights static rendering: the same URL yields different prices per buyer, so naive ISR would serve one buyer's contract prices to another
- A small shared UI package drifts into a large one without an enforced budget
- Checkout is the most complex client surface in the suite and the least forgiving of a state bug

---

## 1) Overview

Everything upstream is a contract. This is the proof.

The application exists for three reasons: it validates that the public API is sufficient to build a real storefront (a specification cannot prove that); it gives adopters something to fork instead of something to implement; and it is where accessibility, responsiveness and performance stop being aspirations in a document and become measured properties.

---

## 2) Problem Statement

### 2.1 An API without a consumer is unproven

Specs 4, 5 and 7 define payloads and endpoints. Nothing demonstrates that a storefront can be built from them, and the gaps only surface during construction — a missing field on a payload, an endpoint that needs one more filter, a flow that requires an extra round trip.

### 2.2 Zero shared UI was the wrong constraint

SPEC-029 v3 §14.2 required the storefront to depend on none of `@open-mercato/core`, `@open-mercato/ui` or `@open-mercato/shared`, and to re-implement primitives "following the same design token conventions". The bundle-isolation goal is right; the total prohibition is not. Re-implementing Dialog, Sheet, Combobox and their focus management, escape handling, ARIA wiring and reduced-motion behaviour a second time means maintaining two accessibility implementations and fixing every bug twice.

### 2.3 Buyer-aware pricing versus static rendering

A B2B storefront cannot statically render a product page: the price depends on who is asking. Standard Next.js ISR would cache one buyer's page and serve it to the next. This has to be designed for rather than discovered at launch.

---

## 3) Architecture

### 3.1 Packages

```
apps/storefront/                      Next.js 15, React 19, Tailwind 4
  └── depends on: @open-mercato/storefront-ui   (only internal dependency)

packages/storefront-ui/               NEW — tokens + accessible primitives
  └── depends on: react, clsx, tailwind-merge, class-variance-authority,
                  @radix-ui/* (only where already used by @open-mercato/ui)
      MUST NOT depend on @open-mercato/{core,ui,shared}
```

### 3.2 `@open-mercato/storefront-ui` budget

Enforced in CI; a breach fails the build.

| Constraint | Limit |
|---|---|
| Minified + gzipped, full package | 45 kB |
| Runtime dependencies | The list above; nothing added without a spec amendment |
| Imports from `@open-mercato/*` | Zero, asserted by a lint rule |
| Server-only or Node built-in imports | Zero |
| Exported components | 24 |

**Contents:** design tokens (shared with the admin DS as CSS custom properties, not as code), `Button`, `Badge`, `Input`, `Select`, `Checkbox`, `RadioGroup`, `Dialog`, `Sheet`, `Popover`, `Tooltip`, `Tabs`, `Accordion`, `Skeleton`, `Spinner`, `Toast`, `Combobox`, `Pagination`, `Breadcrumbs`, `VisuallyHidden`, `SkipLink`, `AspectRatio`, `Separator`, `Alert`, `Card`.

Everything commerce-specific — `ProductCard`, `VariantSelector`, `FilterSidebar` — lives in the app, not the package. The package is generic primitives only, or it becomes a second design system.

### 3.3 Rendering strategy

| Route | Anonymous | Authenticated |
|---|---|---|
| Home | Server, ISR 60s, cached per audience digest | Server, dynamic, `private` |
| Category / listing | Server, ISR 30s per audience digest | Server, dynamic, `private` |
| PDP | Server, ISR 60s per audience digest | Server, dynamic, `private` |
| Search | Server, dynamic | Server, dynamic |
| Cart | Client, always live | Client, always live |
| Checkout | Client, always live | Client, always live |
| Account | Client, always live | Client, always live |

**The rule:** anonymous responses may be shared and cached; authenticated responses are per-request and never enter a shared cache. The app reads `buyer.isAuthenticated` from `/context` at the edge and picks the path. Any CDN in front must be configured to vary on the session cookie or bypass on its presence — this is a **deployment requirement**, documented in the app README, because getting it wrong reproduces spec 4 R1 outside the platform's control.

### 3.4 Data layer

```typescript
// src/lib/api.ts
export async function storefrontFetch<T>(path, opts?): Promise<T>
```

Carried forward from SPEC-029 v3 §14.3, with changes:

- Forwards the incoming `Host`, `X-Locale`, session cookie and cart token
- `next: { revalidate, tags }` only when the request is anonymous; authenticated requests are `cache: 'no-store'`
- Typed errors: `StorefrontApiError`, `StorefrontVersionConflictError` (409 on cart and checkout), `StorefrontLockedError` (423), `StorefrontPriceChangedError` (409 `price_changed` at submit)
- Never throws raw; every call site handles a typed error

The three checkout-specific error types exist because those states are user-facing flows, not failures: a price change needs a re-confirmation UI, a lock needs a redirect back to checkout, a version conflict needs a silent refetch and retry.

---

## 4) Route Tree

```
apps/storefront/src/app/
├── layout.tsx                    StoreContextProvider, branding SSR, skip link
├── page.tsx                      Home — merchandising placements home.main
├── products/[handle]/page.tsx    PDP
├── categories/[slug]/page.tsx    Category landing + listing + enrichment
├── collections/[slug]/page.tsx   Collection landing
├── search/page.tsx               Search results
├── cart/page.tsx                 Cart
├── checkout/
│   ├── page.tsx                  Funnel host; step from the session
│   └── [token]/confirmation/page.tsx
├── account/
│   ├── page.tsx                  Overview
│   ├── orders/page.tsx  ·  orders/[id]/page.tsx
│   ├── quotes/page.tsx  ·  addresses/page.tsx  ·  profile/page.tsx
│   ├── wishlists/page.tsx  ·  saved-carts/page.tsx
│   └── company/{page,buyers,approvals,credit,price-list}.tsx   (B2B)
├── (auth)/{login,register,forgot-password,reset-password}/page.tsx
├── pages/[slug]/page.tsx         content module static pages
├── sitemap.ts  ·  robots.ts      per store, from the public API
├── not-found.tsx  ·  error.tsx  ·  global-error.tsx
```

`sitemap.ts` and `robots.ts` resolve SPEC-029 v4 Open Question 6 in favour of the app: Next.js generates them natively from paginated API reads, and `store.settings.seo.robotsTxt` supplies the robots body.

---

## 5) Components

Carried forward from SPEC-029 v3 §15 with the additions the suite requires. Behaviour and ARIA requirements below are normative.

### 5.1 `VariantSelector`

Renders one `OptionGroup` per `optionSchema.options`; resolves selections to a variant; emits price and availability on change.

- `select` with ≤ 8 choices → chips or colour swatches; > 8 → native `<select>`
- Unavailable combinations rendered **disabled, not hidden** — hiding them makes the option set change shape under the user
- Disabled state carries a non-colour indicator (strikethrough), not colour alone
- `role="radiogroup"` with `aria-labelledby`; chips `role="radio"` with `aria-checked`; arrow-key roving tabindex; `Space`/`Enter` selects
- Colour swatches carry the colour name in `aria-label`
- Selecting an option recomputes availability across all other dimensions

### 5.2 `AddToCart`

New in this spec — v3 had no cart.

- Quantity input honouring `quantityRules` (min, max, increment); an invalid quantity is refused with the nearest valid values offered, never silently rounded (cart spec §5.5)
- Shows `nextTier` for B2B: "100 units — 8,40 zł each, save 12%"
- Optimistic add with rollback on failure; disabled while in flight
- Result announced in an `aria-live="polite"` region — a silent cart update is invisible to a screen-reader user
- Sends an `Idempotency-Key` so a double-tap adds once

### 5.3 `PriceDisplay`

- Normal: `129,00 zł`. Promotional: struck original plus current in the accent colour
- Tax label per `taxMode`: `incl. VAT` / `excl. VAT`
- **Omnibus:** when promotional, renders `lowestPriorAmount` with its statutory label — a legal requirement, not a design choice
- `<del>` and `<ins>` with descriptive `aria-label`s, so the discount is conveyed by more than visual strikethrough

### 5.4 `FilterSidebar` / `FilterSheet`

Desktop sticky sidebar; mobile slide-over closing on apply. `CategoryFilter` as an indented tree; `PriceRangeFilter` as two number inputs plus a track, debounced 500 ms, validating min ≤ max; `TagFilter` and `OptionFilter` as counted toggles; `FilterChips` for active filters, each removable with a descriptive label.

Result-count changes announced via `aria-live="polite"`.

### 5.5 `CheckoutStepper`

New in this spec. Renders the step machine (checkout §5.2) from the session.

- Steps derived from the session, never hard-coded — a digital cart genuinely has no delivery step
- Backward navigation always permitted before submit
- An address change invalidating a rate returns the buyer to `delivery` **with the reason shown**
- `StorefrontPriceChangedError` on submit renders a diff of what changed and requires explicit re-confirmation
- Submit disabled while in flight; the idempotency key persists across a page reload in `sessionStorage`
- `aria-current="step"`; the step region is an `aria-live` landmark

### 5.6 Others

`ProductCard`, `ProductGrid`, `ProductSkeleton`, `AvailabilityBadge`, `ImageGallery`, `SearchDialog`, `MiniCart`, `BlockRenderer` (merchandising blocks), `ReorderPreview`, `ApprovalCard`, `PriceListTable`.

`AvailabilityBadge` renders **nothing** for `not_tracked` — availability spec R5 forbids presenting an uncounted item as "in stock".

---

## 6) Design System

Target aesthetic: minimalist commerce — generous whitespace, restrained type, subtle motion.

| Usage | Class |
|---|---|
| Page title | `text-4xl font-light tracking-tight` |
| Section heading | `text-2xl font-semibold` |
| Card title | `text-sm font-medium` |
| Body | `text-base` |
| Meta | `text-xs text-muted-foreground` |
| Price | `text-lg font-semibold` |

Container `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`; section gap `py-12 sm:py-16`; card gap `gap-4 sm:gap-6`.

Tokens come from the store's branding (SPEC-029 §7) applied as CSS custom properties, SSR-injected to avoid FOUC. `--primary` for CTAs and focus rings, `--accent` for promotional emphasis, `--muted` for secondary text.

Motion: image hover `scale-[1.03]` over 300 ms; filters 200 ms; no full-page transitions, skeletons instead. Every transition wrapped in `@media (prefers-reduced-motion: reduce)`.

**Same rules as the admin DS apply here:** no hardcoded Tailwind status colours, no arbitrary values, no `dark:` overrides on semantic tokens, no hex in `className`.

---

## 7) Responsive Design

Mobile-first; desktop is the enhancement.

| Breakpoint | Grid | Filters | Navigation |
|---|---|---|---|
| `< 640` | 2 columns | Sheet | Hamburger, full-screen |
| `640–1024` | 3 columns | Sheet | Condensed bar |
| `≥ 1024` | 4 columns | Sidebar | Full bar with mega-menu |

Touch targets minimum 44×44 CSS px. The PDP is a single column below `lg` with the gallery first. Checkout is single-column throughout, at every width — a two-column checkout measurably increases abandonment on mobile and gains nothing on desktop.

---

## 8) Accessibility — WCAG 2.2 AA

A gate, not a phase.

**Automated:** `axe-core` via Playwright on every route in both anonymous and authenticated states, at mobile and desktop widths. Zero violations at `serious` or `critical`. Runs in CI on every PR touching the app.

**Manual, per release:**
- Full keyboard traversal of browse → PDP → variant → cart → checkout → confirmation, without a mouse
- Screen-reader pass (VoiceOver and NVDA) over the same journey
- 200 % zoom without horizontal scroll or content loss
- `prefers-reduced-motion` and `prefers-contrast` honoured

**Structural requirements:** one `<h1>` per page with a correct heading order; landmarks (`banner`, `navigation`, `main`, `contentinfo`); skip link as the first focusable element; visible focus on every interactive element; focus trapped in dialogs and returned to the trigger on close; form errors associated via `aria-describedby` and announced; `aria-live="polite"` for cart updates, filter counts and checkout step changes, `assertive` for errors; all content conveyed by colour also conveyed another way.

**WCAG 2.2 specifically:** target size (2.5.8), focus not obscured (2.4.11) — relevant with a sticky header, dragging alternatives (2.5.7) for the price range slider, consistent help (3.2.6), and redundant entry (3.3.7) — the billing address must not have to be retyped when it equals shipping.

---

## 9) Performance Budgets

| Metric | Target |
|---|---|
| LCP, home and category | < 2.5 s (mobile, 4G) |
| CLS | < 0.1 |
| INP | < 200 ms |
| TTFB, cached anonymous | < 200 ms |
| JS, first load, catalogue routes | < 180 kB gzipped |
| JS, first load, checkout | < 250 kB gzipped |
| `@open-mercato/storefront-ui` | < 45 kB gzipped |

Techniques: `priority` on the first four product images; explicit aspect ratios on every image container; server components by default with client boundaries only where interaction demands them; route-level code splitting so checkout weight never loads on the catalogue; fonts self-hosted with `font-display: swap` and preloaded.

Budgets are enforced in CI by a bundle-size check. A breach fails the build.

---

## 10) SEO

Per-page `generateMetadata` from the API payload's `seo` block; canonical URLs from the primary domain binding; `hreflang` across `supportedLocales`; Open Graph and Twitter cards.

Structured data: `Product` with `Offer` (price, currency, availability, `priceValidUntil`), `BreadcrumbList`, `Organization`, `ItemList` on listings, `WebSite` with `SearchAction`.

**Structured data uses anonymous pricing only.** Emitting a logged-in B2B buyer's contract price into `Product`/`Offer` markup would publish confidential terms to any crawler or extension reading the page. Authenticated pages set `noindex` and omit price markup entirely.

---

## 11) Risks & Impact Review

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Cached page serves another buyer's prices | **Critical** | An authenticated B2B page is cached by ISR or a CDN and served to an anonymous visitor or a different customer. | Authenticated requests are `no-store` end to end; ISR only for anonymous, keyed on the audience digest; a CDN configuration requirement documented in the README; a Playwright test asserts an anonymous request after an authenticated one gets anonymous prices | Medium — the CDN is outside the repo's control; documented as a deployment requirement rather than assumed |
| R2 | Contract pricing in structured data | **High** | A B2B buyer's negotiated price is emitted into `Product`/`Offer` JSON-LD and read by a crawler or browser extension. | Structured data uses anonymous pricing only; authenticated pages `noindex` and omit price markup (§10); asserted by test | Low |
| R3 | `storefront-ui` scope creep | Medium | The package accumulates commerce components and becomes a second design system to maintain. | Hard CI budget: 45 kB, 24 exports, a fixed dependency list, zero `@open-mercato/*` imports; commerce components live in the app | Low |
| R4 | Checkout state bug loses an order | **High** | A client-side state error resubmits, loses the version, or shows a completed checkout as failed. | Server is authoritative — the client renders session state and never derives it; typed errors for 409, 423 and `price_changed`; the idempotency key survives reload in `sessionStorage`; a Playwright suite covers reload, back-button and double-submit at every step | Low |
| R5 | Accessibility regression after launch | Medium | A later change breaks focus management; nobody notices until a user complains. | axe runs per route on every PR; the manual pass is a release gate, not a one-off audit | Low |
| R6 | Bundle growth degrades LCP | Medium | Incremental client components push catalogue routes past budget and mobile LCP misses target. | Per-route CI bundle budgets; server components by default; checkout code split away from catalogue | Low |
| R7 | Cart token exposure in the client | **High** | The cart token is stored where another script can read it, or lands in a URL and leaks via referrer. | httpOnly cookie set by a server route handler; never in `localStorage`, never in a URL (cart spec R6); the app never reads the raw token in client code | Low |
| R8 | Branding FOUC | Low | Store colours apply after hydration and the first paint is unbranded. | Branding SSR-injected into `<head>` (SPEC-029 §7.2); runtime `setProperty` reserved for the admin preview | Low |

---

## 12) Test Coverage

Playwright, headless, against a seeded fixture store. Renumbered from SPEC-029 v3's `TC-SF-*`.

**Browse:** home renders merchandising blocks; product card navigates to PDP; category page shows enrichment, filters and products; filter by category updates the URL and results; chip removal clears; search filters; pagination; sort; collection page.

**PDP:** variant selector renders for a configurable product; selecting all options updates price and availability; unavailable combinations are disabled and not hidden; gallery keyboard and swipe navigation; breadcrumbs; related products; `priceTiers` for a B2B buyer.

**Cart:** add from PDP and from the grid; quantity change re-prices at a tier boundary; increment violation refused with valid values offered; remove; promotion code apply and remove; price-change disclosure; mini-cart; persistence across reload; guest→customer merge on login shows the merge summary.

**Checkout:** full B2C purchase to confirmation; full B2B on-account purchase; over-threshold routes to approval; address change invalidates the rate and says why; price change at submit requires re-confirmation; double-submit creates one order; reload mid-checkout resumes at the right step; browser back does not corrupt state; payment failure surfaces recoverably (R4).

**Account:** order history within scope; a colleague's order is not visible under `own`; reorder preview shows every difference class and creates a cart only on confirm; address CRUD; wishlist add and add-all-to-cart; B2B approvals inbox decision; price-list export.

**Buyer isolation:** an anonymous request following an authenticated one for the same URL returns anonymous prices (R1); structured data on an authenticated page carries no price (R2).

**Accessibility:** axe zero serious/critical on every route in both auth states at both widths; keyboard-only traversal of the full purchase journey; skip link on first Tab; focus returns from every dialog; 200 % zoom without horizontal scroll.

**Performance:** Lighthouse CI on home, category and PDP meets §9; bundle budgets enforced per route.

---

## 13) Implementation Phases

### Phase 1 — Foundation
Scaffold, `@open-mercato/storefront-ui` with its CI budget, `storefrontFetch` with typed errors, `StoreContextProvider`, branding SSR, layout, skip link, error and not-found pages.

**Gate:** the package budget is enforced and passing; branding renders without FOUC.

### Phase 2 — Catalogue
Home with merchandising blocks, category, collection, PDP, search, filters, URL-synced filter state, sitemap and robots.

**Gate:** buyer isolation tests pass; catalogue bundle and LCP budgets met.

### Phase 3 — Cart
Cart page, mini-cart, add-to-cart with quantity rules and tiers, promotion codes, price-change disclosure, merge summary.

**Gate:** cart Playwright suite passes including merge and tier boundaries.

### Phase 4 — Checkout
Stepper, addresses, delivery selection, payment, review, submit with all three typed error flows, confirmation, B2B approval and on-account.

**Gate:** the full checkout suite passes including reload, back-button and double-submit at every step.

### Phase 5 — Account
Order history, detail, reorder preview, addresses, profile, wishlists, saved carts, B2B company pages.

**Gate:** visibility scope respected in the UI; reorder preview surfaces every difference class.

### Phase 6 — Hardening
Full axe sweep, manual accessibility pass, Lighthouse CI, bundle budgets, cross-browser, README with the CDN deployment requirement.

**Gate:** WCAG 2.2 AA passes automated and manual; every performance budget met.

---

## 14) Open Questions

1. **Distribution** — the roadmap decided `apps/storefront` in the monorepo. Whether it *also* ships as a `create-app` preset (per `packages/create-app` template-sync rules) is unresolved; if so, the template-sync checklist applies from Phase 1.
2. **Image transformation** — spec 4 Open Question 4. Responsive `srcset` needs width variants; whether `storage-s3` provides them is unverified and blocks the LCP budget if it does not.
3. **Analytics and consent** — no analytics is specified. A real storefront needs GA4 or equivalent behind a consent banner, and consent interacts with `consent_flags` in checkout and promotions. Out of scope, and a real gap before a production launch.
4. **PWA / offline** — the roadmap listed offline as a non-goal. Whether a service worker for asset caching alone is worth it is unaddressed.

---

## 15) Final Compliance Report

| Requirement | Status |
|---|---|
| No `@open-mercato/core` dependency | Enforced by lint; only `@open-mercato/storefront-ui` is permitted |
| `storefront-ui` isolation | Zero `@open-mercato/*` imports, asserted by lint; 45 kB and 24-export budget in CI |
| Design system rules | No hardcoded status colours, no arbitrary values, no `dark:` on semantic tokens, no hex in `className` |
| i18n | All copy through the locale files; no hard-coded user-facing strings |
| Accessibility | WCAG 2.2 AA as a phase gate: axe per route per PR, manual pass per release |
| Performance | Budgets enforced in CI; a breach fails the build |
| Security | Cart token httpOnly and never in a URL; authenticated responses `no-store`; structured data anonymous-priced only |
| API consumption | Only public endpoints; no privileged surface reachable from the app |
| Dialog UX | `Cmd/Ctrl+Enter` submits, `Escape` cancels, per root `AGENTS.md` |
| Integration coverage | §12, shipping in the same change |

---

## 16) Changelog

### 2026-08-14
- Initial specification, carrying forward SPEC-029 v3 §14 (app architecture), §15 (components), §16 (design system), §17 (RWD), §18 (WCAG) and the app half of §24 (performance).
- Softened v3 §14.2 per ADR-8: introduced `@open-mercato/storefront-ui` with a hard CI budget instead of prohibiting all shared UI, so accessible primitives are maintained once rather than twice.
- Added the rendering-strategy table and the CDN deployment requirement after concluding that buyer-aware pricing makes naive ISR a cross-buyer disclosure vector (R1) — a consequence v3 did not face because it had no B2B pricing.
- Added `AddToCart` and `CheckoutStepper`, absent from v3 because it had no cart module and its checkout was a withdrawn workflow.
- Added the Omnibus lowest-prior-price requirement to `PriceDisplay`, and the rule that `not_tracked` availability renders no badge.
- Added the structured-data pricing restriction (R2), which v3's anonymous-only model never had to consider.
- Made accessibility a phase gate rather than a hardening-phase audit, and added the WCAG 2.2-specific criteria (2.5.8, 2.4.11, 2.5.7, 3.2.6, 3.3.7) that v3's checklist predated.
