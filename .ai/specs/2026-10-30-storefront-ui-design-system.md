# Storefront design system — `@open-mercato/storefront-ui` tokens, primitives and Storybook

- **Status:** Draft, implementation in progress on this branch
- **Scope:** OSS (`packages/storefront-ui`, root scripts, docs)
- **Origin:** Ecommerce suite roadmap ADR-8 ([`2026-08-14-ecommerce-suite-roadmap.md`](2026-08-14-ecommerce-suite-roadmap.md)) and the storefront app spec §3.1, §3.2, §6, §7, §8 ([`2026-08-14-storefront-app.md`](2026-08-14-storefront-app.md)); Figma hi-fi v2 (file `KTKLz5wWIOUbK67uAMfFWs`)
- **Risk:** `risk-medium` (new package, no existing contract surface changed; adds root scripts and a second Storybook config). **Priority:** `priority-medium`. **Category:** `feature`

## TLDR

Ship the storefront's own design system as the budgeted package the storefront spec already reserves: `@open-mercato/storefront-ui` with (1) a token layer that reuses the admin DS custom-property names and values so a merchant's `theme.css` brands both surfaces, plus storefront-only scale tokens (`--sf-*`) and radii derived from the store branding radius; (2) exactly the 24 primitives the storefront spec enumerates, each with the variants a storefront needs (chip and card selection, quantity stepper, badge tones, toast with action, bottom sheet), built on Radix for behaviour and on Tailwind 4 utilities for styling; (3) a dedicated Storybook with a brand switcher, density and theme toolbars, per-primitive stories with every state, and pattern stories that compose the primitives into the Figma v2 screens (product tile, cart line, checkout step, B2B order row) without exporting them; (4) CI guards for the 45 kB gzip budget, the 24-export list, the fixed dependency list and zero `@open-mercato/*` imports. Commerce components (`ProductCard`, `VariantSelector`, `FilterSidebar`, `CheckoutStepper`, price and tier blocks) stay in `apps/storefront`, per ADR-8.

## Overview

The storefront spec decided that the storefront shares tokens, not components, with the back office, and reserved a small package for the primitives it cannot afford to reimplement twice (dialog, sheet, combobox, focus management). This spec gives that package its concrete design: which tokens, which variants, which a11y behaviours, how merchants theme it, and how it is documented and guarded. The visual language is the v2 direction approved in Figma for the Ecommerce Suite screens (Inter, DS neutrals, black primary, pastel status tiles, radii 8 / 12 / 16 / 20, real photography, 44 to 56 px controls), and the component inventory and defaults follow those screens across navigation, catalogue, product page, cart and checkout, account and B2B.

## Problem statement

1. `apps/storefront` has no UI package to build on. The storefront spec forbids importing `@open-mercato/ui` (it would pull the back-office bundle: TanStack, DataTable, CrudForm, i18n context) and names a package that does not exist yet.
2. The Figma v2 screens define a language (sizes, radii, type scale, badge tones) that has no code counterpart; the first implementer would re-derive it from screenshots.
3. Merchants will re-brand the storefront (colours, fonts, radius, logo) and nothing says which tokens are theirs and which are system contracts. The admin theming spec ([`2026-07-05-ds-theming-and-brand-customization.md`](2026-07-05-ds-theming-and-brand-customization.md)) draws that boundary for the back office; the storefront needs the same boundary and the same `theme.css` slot so one brand file serves both.
4. The recurring quality gaps in storefronts are accessibility gaps (no focus ring, colour-only states, icon-only controls, toasts as the only error channel). A primitive set that carries those behaviours is the only way the app inherits them.
5. The storefront spec sets hard limits (45 kB gzip, 24 exports, fixed dependencies, no `@open-mercato/*` imports) but nothing measures them.

## Goals and non-goals

**Goals**
- `packages/storefront-ui` publishable as `@open-mercato/storefront-ui`, ESM, React 19, typed, tree-shakeable per component.
- Token contract: admin-compatible semantic names plus storefront scale; radii derived from the store branding radius; density; dark mode; a documented merchant surface and a documented fixed surface.
- 24 exported components with the variants listed in §4, every interactive one keyboard-operable and screen-reader-labelled, with visible focus and 44 px touch targets at `lg`.
- Storybook: `yarn storybook:storefront` with brand, density, theme and viewport toolbars; stories for every component and state; pattern stories reproducing the Figma v2 screens.
- Guards in `yarn test` and CI: budget, export count, dependency allowlist, import isolation.

**Non-goals**
- Commerce components (product card, variant selector, filters, checkout stepper, price and tier blocks, cart line, order card): app-level, shown only as Storybook patterns.
- Changing `packages/ui`, `globals.css`, or the admin Storybook.
- Figma library parity tooling (Code Connect) for the storefront; follow-up once the package stabilises.
- Storefront app routes, data fetching, i18n plumbing.

## Proposed solution

### 1. Package layout

```
packages/storefront-ui/
├── package.json              name @open-mercato/storefront-ui, exports ".", "./tokens.css", "./theme.css", "./<component>"
├── build.mjs                 scripts/build-package.mjs, platform browser, clearDist
├── tsconfig.json             extends ../../tsconfig.base.json
├── jest.config.cjs           jsdom, @testing-library/react
├── AGENTS.md                 import cheat sheet and rules for agents
├── README.md
├── src/
│   ├── index.ts              the 24 exports and their types, nothing else
│   ├── tokens.css            :root + .dark + [data-sf-density]
│   ├── theme.css             Tailwind 4 @theme inline mapping (--color-*, --radius-*, --font-*)
│   ├── lib/cn.ts             clsx + tailwind-merge (no @open-mercato/shared)
│   ├── primitives/<name>.tsx one file per export, tests in __tests__
│   └── __tests__/guards/     budget, exports, dependencies, isolation
└── .storybook/               main.ts, preview.tsx, preview.css, stories/, patterns/
```

Dependencies (runtime, fixed by the storefront spec): `react`, `react-dom` (peer), `clsx`, `tailwind-merge`, `class-variance-authority`, and only these Radix packages, all already used by `@open-mercato/ui`: `@radix-ui/react-slot`, `-dialog`, `-popover`, `-tooltip`, `-tabs`, `-accordion`, `-checkbox`, `-radio-group`, `-select`, `-toast`, `-label`, `-visually-hidden`, `-aspect-ratio`, `-separator`. `Sheet` is `Dialog` with a side; `Combobox` is built on `Popover` plus a listbox (no cmdk); `Pagination`, `Breadcrumbs`, `Skeleton`, `Spinner`, `SkipLink`, `Alert`, `Card`, `Badge`, `Button`, `Input` are plain React.

### 2. Tokens

`tokens.css` defines, on `:root` and `.dark`, the same semantic custom properties the admin DS uses so that a merchant `theme.css` written for the back office works unchanged: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--primary-foreground`, `--primary-hover`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`, `--status-{error|success|warning|info|neutral|pink}-{bg|text|border|icon|solid|solid-foreground}`, `--shadow-*`, `--z-index-*`, `--focus-ring-*`. Values are the storefront defaults (black primary, Inter stack, neutral greys) and match the Figma v2 foundations.

Storefront-only tokens, prefixed `--sf-`:

| Group | Tokens | Default |
|---|---|---|
| Type scale | `--sf-text-display-xl`, `-display-l`, `-display-m`, `-display-s`, `-title` (size, line-height, letter-spacing, weight 300), `-body-lg`, `-body`, `-body-sm`, `-body-xs`, `-badge` (size and line-height) | 88/88, 72/76, 56/60, 36/40, 28/32, 18/24, 16/24, 14/20, 12/16, 11/16 |
| Case | `--sf-label-case` | `none` (merchant may set `uppercase`) |
| Shape | `--sf-radius-badge`, `-button`, `-chip`, `-field`, `-card`, `-tile`, `-sheet` | `--radius` multiplied by 0.8, 1.2, 1.2, 1.2, 1.6, 1.6, 2, which gives 8, 12, 12, 12, 16, 16, 20 at the default |
| Control size | `--sf-control-sm`, `-md`, `-lg` | 36, 44, 52 px |
| Surfaces | `--sf-surface` (product image background, cards on the page), `--sf-surface-tint` (quiet sections, selected options), `--sf-primary-soft` (controls on a primary surface), `--sf-sale` (sale hue, defaults to status error), `--sf-tile-*` seven pastel tiles mapping to the admin `state/*/lighter` set | from Figma v2 |
| Layout | `--sf-gutter-sm`, `-md`, `-lg` (16 / 40 / 80), `--sf-grid-gap`, `--sf-container` (1280) | from Figma v2 |
| Media | `--sf-image-ratio-product` (`151 / 178`, the Figma tile), `--sf-image-fit` (`cover`) | per vertical |
| Density | `[data-sf-density="compact|default|comfortable"]` scales `--sf-grid-gap`, card padding and control size by one step | `default` |

`theme.css` is the Tailwind 4 `@theme inline` block mapping those properties onto utilities (`bg-background`, `text-status-error-text`, `rounded-sf-button`, `h-sf-md`, `text-sf-display-m`). Consumers import `tokens.css` once, `theme.css` in their Tailwind entry, and add `@source` for the package so utilities used in components are generated. The storefront app imports the merchant `theme.css` after `tokens.css`, exactly as the admin spec prescribes for `globals.css`.

**Merchant surface (safe to override):** `--primary` family, `--accent`, `--sf-surface`, `--sf-sale`, `--font-base` / `--font-heading`, `--sf-label-case`, `--radius`, `--sf-image-ratio-product`, `data-sf-density`, logo.

**Fixed surface (system contract):** status palette and badge mapping, `--sf-control-*`, focus ring geometry, spacing scale, z-index, motion durations, disabled and error construction, overlay widths, minimum font sizes (11 badge, 12 helper, 16 mobile input).

### 3. Components (the 24 exports)

Every component: `data-slot` attribute, `className` merge via `cn`, `asChild` where Radix provides it, forwards refs, no `any`, no hard-coded colours, no `dark:` overrides.

| Export | Variants and props beyond the basics |
|---|---|
| `Button` | `variant` named as in `@open-mercato/ui`: `default`, `outline`, `secondary` (soft), `ghost`, `link`, `destructive`; `size`: `sm` 36, `default` 44, `lg` 52, `icon` (square, 44); `loading` (spinner replaces label, width kept, label stays in DOM), `leadingIcon`, `trailingIcon`, `trailing` slot (price), `fullWidth` |
| `Badge` | `variant`: `default`, `neutral`, `outline`, `info`, `success`, `warning`, `error` as in `@open-mercato/ui`, plus storefront-only `promo`, `new`, `low-stock`, `sold-out`; `size` `sm` 18 / `default` 22 / `lg` 28; `dot` boolean for status badges; `Badge.Status` helper mapping order, payment and quote statuses to tones |
| `Input` | `size` `default` 44 / `lg` 48; `invalid`, `leadingIcon`, `trailingSlot`; compound `Input.Field` (label, helper, error wired with `aria-describedby`), `Input.Stepper` (quantity, editable, min/max, `aria-live` value, 36 / 44 buttons), `Input.Search` (search icon, clear button) |
| `Select` | Radix select, 44 px trigger, chevron, `size`, grouped options, placeholder, invalid; mobile uses the same list in a sheet-sized viewport |
| `Checkbox` | `variant`: `box` (18 px, 2 px radius), `chip` (option chip with `unavailable` state), `switch` (44x24); label as the hit area |
| `RadioGroup` | `variant`: `dot`, `chip`, `card`; `RadioGroup.Item` with `unavailable`, `badge`, `description`, `trailing` slot (price or logo), expandable `children` when selected |
| `Dialog` | sizes `sm` 400 / `md` 560 / `lg` 720; header, body, footer slots; Cmd/Ctrl+Enter submits the primary action, Esc cancels; focus trap and return |
| `Sheet` | `side` right (420 px) or bottom (grabber, 20 px top radius, sticky footer); scroll lock; same keyboard contract as Dialog |
| `Popover` | Radix popover, 12 px radius, shadow token; `Popover.Menu` list rows 40 px for account and overflow menus |
| `Tooltip` | hover and focus, 300 ms delay, text only; never required content |
| `Tabs` | `variant`: `underline` (default), `pill`, `segmented`; scrollable with fade on overflow; arrow-key navigation |
| `Accordion` | 52 px rows, `icon="plus"` or `"chevron"`, `aria-expanded`, heading wrapper level prop |
| `Skeleton` | `shape`: `text`, `rect`, `circle`, `tile` (uses `--sf-image-ratio-product`) |
| `Spinner` | sizes 16 / 20 / 24, `label` for AT, used inside Button |
| `Toast` | provider + hook; `status`; `action` button; `duration`; max two stacked; `role="status"` (error status `role="alert"`) |
| `Combobox` | input + listbox on Popover, sections, keyboard, `aria-activedescendant`; used for search typeahead and address autocomplete; `footer` slot ("Enter address manually", "See all results") |
| `Pagination` | numbered with 36 px targets and `aria-current="page"`; `variant="load-more"` renders "Showing X of Y", a 4 px bar and a button; focus moves to the first new item |
| `Breadcrumbs` | slash separator, 13 px, `aria-current` on last, `collapse` to a Back link under `sm` |
| `VisuallyHidden` | Radix |
| `SkipLink` | first focusable, visible on focus, targets `#main` |
| `AspectRatio` | Radix, default from `--sf-image-ratio-product` |
| `Separator` | horizontal and vertical, `decorative` |
| `Alert` | `status` as in `@open-mercato/ui`: `information`, `success`, `warning`, `error`, plus storefront-only `neutral`; icon, title, body, `action` slot; `role="alert"` for error, `role="status"` otherwise; the only error channel in cart and checkout besides field errors |
| `Card` | `padding` `md` 20 / `lg` 24, `surface` `white` or `alt`, `interactive` (hover and focus ring), header and footer slots |

Deliberately not exported (app compositions, documented as Storybook patterns): product tile, category header, filter sidebar and sheet, sort select, gallery, variant selector, price block, tier table, case-quantity select, buy box and sticky bars, cart line, order summary, promo code field, shipping progress, checkout stepper and collapsed sections, express pay row, choice lists for delivery and payment, cart changes dialog, order card and table, order stepper, account shell, address card, quick-order table, empty states, announcement bar, header, mega menu, nav drawer, footer, search overlay.

### 4. Storybook

A second Storybook config at `packages/storefront-ui/.storybook` using the already installed `@storybook/nextjs-vite` 10.6 and `@storybook/addon-a11y`, started with `yarn storybook:storefront` (port 6007) and built with `yarn build-storybook:storefront`. It shares nothing with the admin Storybook except the framework; it does not import `apps/mercato` CSS or `@open-mercato/ui`.

- Toolbars: Brand preset (Ziarno default, Atelier, Motion, Hearth), Density, Theme (light/dark, applied on the document root so portals follow), Viewport (390, 768, 1440).
- Foundations: tokens page rendering the live values, type scale, radii, status tones, spacing, focus ring.
- One story file per export with every variant and state (default, hover, focus-visible, disabled, loading, invalid, unavailable, selected), plus an a11y note block listing the ARIA contract.
- Patterns: product tile, listing toolbar with filter sheet, PDP buy box with chips and tier table, cart line and summary, checkout contact and delivery steps, confirmation, account order row and B2B invoice row, each composed only from exported primitives and plain markup, so the Figma v2 screens are reproducible from the package.
- `yarn test:storybook:storefront` runs the existing smoke runner against the static build.

### 5. Guards

| Guard | Where | Rule |
|---|---|---|
| Size budget | `scripts/check-storefront-ui-budget.mjs`, `yarn storefront-ui:budget`, CI after `build:packages` | esbuild-bundle `src/index.ts` with the fixed dependency list marked external, minify, gzip; fail above 45 kB; print per-dependency gzip sizes for information. Interpretation: "full package" means the package's own code, since Radix alone exceeds the budget and is shared with the app bundle. |
| Export count | `src/__tests__/guards/exports.test.ts` | the value exports of `src/index.ts` equal the 24-name list; adding one fails until the spec amends the list |
| Dependencies | `src/__tests__/guards/dependencies.test.ts` | `dependencies` keys are a subset of the fixed list; no `@open-mercato/*` in any dependency field |
| Isolation | `src/__tests__/guards/isolation.test.ts` and an ESLint `no-restricted-imports` entry for the package | no import from `@open-mercato/*`, `next/*`, `node:*` or Node built-ins in `src/` |
| Tokens | `src/__tests__/guards/tokens.test.ts` | every admin semantic name listed in §2 is declared in `tokens.css` for both `:root` and `.dark`; every `--sf-radius-*` has a value in all three presets |
| DS rules | existing `om-ds-guardian` greps extended with the package path | no hard-coded Tailwind status colours, arbitrary values or `dark:` overrides in `src/` |

## Data models and API contracts

No database, no API routes, no events. Public contract surfaces added (all new, ADDITIVE under `BACKWARD_COMPATIBILITY.md`): the package name and its 24 exports with their props, the token names in §2, the `data-sf-density` attribute, the `theme.css` import path, the root scripts `storybook:storefront`, `build-storybook:storefront`, `test:storybook:storefront`, `storefront-ui:budget`.

## Migration and backward compatibility

Additive. Nothing in `packages/ui`, `apps/mercato` or the create-app template changes. The admin theming spec's merchant `theme.css` contract is reused, not duplicated; when that spec lands its docs page, this package's README links to it and adds the `--sf-*` surface.

## Test coverage

- Unit (jest, jsdom, Testing Library): every component renders each variant; keyboard contracts (Tabs arrows, RadioGroup arrows, Dialog Esc and Cmd/Ctrl+Enter, Combobox arrows and Enter, Stepper min/max); ARIA attributes (`aria-describedby` wiring, `aria-current`, `aria-live`, `aria-disabled` on unavailable chips); focus trap and return in Dialog and Sheet.
- Guards: the five tests in §5.
- Storybook: build and smoke run; a11y addon in `todo` mode on every story, promoted to `error` for Button, Input, RadioGroup, Dialog and Sheet in Phase 5.
- Integration: none in this spec; the storefront app spec owns the axe-core route runs.

## Risks and impact review

| Scenario | Impact | Mitigation | Residual |
|---|---|---|---|
| Second Storybook config drifts from the first | Confusing DX | Shared framework version from root; separate README explains the split; smoke runner reused | Low |
| 24 exports prove too few once the app is built | Pressure to export compositions | Variants and compound sub-components absorb the storefront needs; a spec amendment is the only way to add an export, enforced by the guard | Medium |
| Token names collide with admin tokens when both surfaces load on one page | Wrong colours | Storefront and back office are separate apps; `tokens.css` is scoped to `:root` of the storefront document only; documented | Low |
| Radix versions diverge from `@open-mercato/ui` | Two copies in a monorepo app | Same version ranges as `packages/ui`; dedupe in the storefront app | Low |
| Budget check measures something nobody agrees on | False confidence | The script prints own-code and dependency sizes separately; the interpretation is written in §5 | Low |

## Implementation phases

1. **Foundation** — package scaffold, build, jest, `tokens.css`, `theme.css`, `cn`, guards, Storybook config with toolbars and a Foundations page. Validation: `yarn build:packages`, `yarn workspace @open-mercato/storefront-ui test`, `yarn storefront-ui:budget`, `yarn build-storybook:storefront`.
2. **Core primitives** — Button, Badge, Input (Field, Stepper, Search), Select, Checkbox, RadioGroup, Separator, VisuallyHidden, SkipLink, AspectRatio, Card, Spinner, Skeleton, with stories and tests.
3. **Overlays and feedback** — Dialog, Sheet, Popover, Tooltip, Toast, Alert.
4. **Navigation and composition primitives** — Tabs, Accordion, Breadcrumbs, Pagination, Combobox.
5. **Patterns, a11y hardening, docs** — pattern stories reproducing the Figma v2 screens, a11y addon promoted to error on the five core components, AGENTS.md and README, task-router row in the root AGENTS.md.

## Open questions

1. Whether the 45 kB budget means own code only (this spec's reading) or own code plus dependencies; the latter is not achievable with Radix and would need the storefront spec amended.
2. Whether the fonts offered in store branding beyond Inter and the system stacks are self-hosted by the app; the branding setting only names the family.
3. Font loading: the package ships no font files; the storefront app decides between Inter from `@fontsource-variable/inter` (already a dev dependency for the admin Storybook) and the merchant's own.

## Final compliance report

| Rule | Status |
|---|---|
| Zero `@open-mercato/*`, `next/*`, Node imports in `src/` | guarded by `isolation.test.ts`, passing |
| Fixed dependency list | `@radix-ui/react-tabs`, `-toast`, `-aspect-ratio` are not used by `@open-mercato/ui`, so Tabs, Toast and AspectRatio are implemented without Radix; guarded by `isolation.test.ts` and the budget script |
| 24 exports | guarded by `exports.test.ts`, passing |
| 45 kB gzip | own code 12.6 kB gzipped (`yarn storefront-ui:budget`) |
| DS rules (no hardcoded shades, arbitrary values, `dark:` overrides) | guarded by `ds-rules.test.ts`; the only arbitrary values are viewport calc and safe-area expressions, allowlisted there |
| Every user-facing string is a prop | yes; the package has no locale files |
| Optimistic locking | not applicable, no entities |

## Changelog

### 2026-10-30
- Initial draft from the Figma v2 foundations.
- Phases 1 to 4 implemented on this branch: package scaffold, `tokens.css`, `theme.css`, `cn` with storefront class groups, 24 primitives, guards (exports, dependencies, isolation, tokens, DS rules), budget script, Storybook with brand, density, theme and viewport toolbars, tokens page, stories for every primitive, pattern stories for catalogue, product page, cart and checkout, account and B2B. Phase 5 open: a11y addon still in `todo` mode, no smoke runner for the storefront build, no docs page under `apps/docs`.
- Decisions taken while implementing: `Input.Stepper`, `Input.Search` and `Input.Field` are compound sub-components of `Input` (not separate exports); `RadioGroup` and `Checkbox` carry the chip and card variants; `Badge.Status` carries the lifecycle mapping; `Combobox` positions its own listbox instead of a Radix popover so the input keeps focus.

### 2026-11-03
- Aligned with Open Mercato after review: shared tokens take the admin values, guarded by a parity test against `apps/mercato/src/app/globals.css` (`--focus-ring-outer` stays `--foreground` because the admin `--ring` grey is below 3:1 on white). `Button`, `Badge`, `Alert` and `Toast` use the `@open-mercato/ui` prop and value names. Radii derive from `--radius` and fonts from `--font-base` and `--font-heading`, the names store branding sets (SPEC-029 section 7); the `data-sf-shape` presets are removed. `Pagination.LoadMore` takes `hasMore` and an optional `showing` label, for the page-scoped availability filter. Product image ratio follows the Figma tile.

### 2026-11-18
- The visual source moves to the DS library: section "E-commerce", page "Foundations [E-commerce]" in the DS Open Mercato Figma file, with variable collection `07-Commerce` (mode `Open Mercato` aliased to the DS tokens, mode `Ziarno` as a sample merchant brand) and text styles `Commerce/Display XL` to `Commerce/Title`. Token names follow it: type scale renamed to `display-xl`, `display-l`, `display-m`, `display-s`, `title`, `body-lg`, `body`, `body-sm`, `body-xs`, `badge`, with the DS Paragraph sizes for body text; display sizes and `title` carry weight 300 and their letter spacing. `--sf-surface-alt` becomes `--sf-surface`, `--sf-promo` becomes `--sf-sale`, `--sf-surface-tint` and `--sf-primary-soft` are added.
- No bold or medium weight anywhere in the package or the app; hierarchy comes from size. Storybook's default brand is `Open Mercato`, `Ziarno` is a preset.
- Product phase: DS library page "Product [E-commerce]" holds `Button`, `Icon Button`, `Favourite`, `Badge`, `Option Chip`, `Option Card`, `Quantity`, `Price`, `Rating`, `Product Tile`, `Gallery` and `Buy Box`. Variant property names follow the code (`variant`, `size`, `state`), so `Option Chip` and `Option Card` are `RadioGroup` `chip` and `card`, `Quantity` is `Input.Stepper`. `Badge` text moves to `text-sf-body-xs`, primitive icons use a 1.5 stroke. The catalogue and product page pattern stories now reproduce the Figma tile, gallery and buy box with product photos served from `.storybook/public`; Rating, Favourite, Price and Product Tile are story-only copies in `.storybook/commerce.tsx` until the app needs them.
- Catalogue phase: DS library page "Catalogue [E-commerce]" holds `Checkbox`, `Filter Chip` (`Checkbox variant="chip"`), `Filter Trigger` (Popover trigger), `Select`, `Menu Item`, `Menu`, `Text Field` (`Input.Field`), `Filter Popover`, `Filter Sheet`, `Category Header` (tone plain or primary), `Listing Toolbar` (desktop row, floating mobile bar) and `No Results`. Code: side sheets float with an 8 px margin and the sheet radius, sheet and dialog close buttons sit on `bg-sf-surface`, `Breadcrumbs` gains `tone="inverse"` for primary-coloured headers (with a test), and the catalogue pattern shows the header in both tones, the filter triggers, the floating mobile bar and the no-results state.
- Navigation phase: DS library page "Navigation [E-commerce]" holds `Announcement Bar`, `Search Field`, `Locale Switcher`, `Header` (desktop and mobile, tone plain or primary), `Search Suggestions`, `Mobile Menu` and `Footer` (tone primary or plain). New pattern story `Patterns/Navigation` composes them from `Combobox` (search suggestions with photos and the "See all" footer), `Sheet side="left"` (mobile menu) and plain markup. The Figma search field is a filled field without border; `Combobox` keeps the bordered input until a quiet variant is decided.
- Cart and checkout phase: DS library page "Cart and checkout [E-commerce]" holds `Cart Line` (default, price changed, unavailable), `Promo Code` (default, applied, error), `Free Delivery` (progress, unlocked), `Order Summary` (cart, checkout), `Empty Cart`, `Checkout Steps` (numbered on desktop, segmented bar on mobile), `Checkout Section` (completed, active, upcoming), `Mini Cart` and `Order Confirmation`. The cart and checkout pattern stories follow them: photos on cart lines, applied code as a removable tag, summary on the surface colour, checkout steps, completed and upcoming sections, mini cart in the floating side sheet, empty cart and order confirmation. Free delivery has no backend yet (see the C3 mapping); the UI is ready for it.
- Templates phase: DS library page "Templates [E-commerce]" composes whole screens only from section instances: listing (desktop and mobile with the floating toolbar), product page (desktop and mobile), cart, checkout and order confirmation (desktop), and the desktop listing again in the `Ziarno` brand mode with primary header and category header, to show that one set of components carries a merchant brand. The pattern stories remain the code counterpart; account, B2B and content pages are not part of the section yet.
- Scale review: text and controls one step smaller after design review. Display sizes 64, 48, 40, 28, title 22; body 16, 14, 13, 12; controls 32, 40, 44 (density steps follow). Buttons use 12, 16, 20 px side padding and 18 px icons, the stepper cells are 40 and 44 px. The DS library section follows: `Commerce/*` styles resized, body text one `Paragraph/*` step down, control heights 52, 44, 36 mapped to 44, 40, 32.

### 2026-11-19
- Home and content phase: DS library page "Home and content [E-commerce]" holds `Hero` (desktop and mobile, tone plain or primary), `Feature Card`, `Category Tile`, `Section Header`, `Story Block` and `Empty State`. New pattern story `Patterns/Home and content` (home, home with the primary hero, phone, page not found).
- Reviews and account phase: DS library page "Reviews and account [E-commerce]" holds `Star Input`, `Rating Summary` (reviews, empty), `Review Card`, `Text Area`, `Review Form` (dialog on desktop, bottom sheet on mobile), `Sign In` and `Favourites Toolbar`. New pattern story `Patterns/Reviews and account` (reviews, no reviews, write a review, sign in, favourites, favourites empty). Reviews and favourites have no backend yet; the empty states are the launch states.
- Templates gain Home (desktop, mobile), Favourites and Not found, and both product page templates gain the Reviews section.
- Fix: `Dialog` and `Sheet` both assigned their parts onto the shared Radix `Dialog.Root`, so importing both made `Dialog.Content` render as a sheet. `Dialog`, `Sheet`, `Popover`, `Select` and `Tooltip` now export their own root component; a regression test in `overlays.test.tsx` covers Dialog with Sheet.
- Layout review: the template layout changes to "media to the edge, text in the gutter". Home opens with a full-bleed hero photo with the site header on top of it and the title in the photo; product photos have square corners, touch each other (2 px gap) and run to the page edges in 4 columns (2 on phones); the feature is a full-width band in the primary colour; the story block is two text columns. DS library: `Header` gains `tone=overlay`, `Hero` gains `tone=photo`, `Product Tile` is rebuilt (4:5 photo, name and price on one line on desktop, stacked on mobile), desktop `Gallery` is a 2 x 2 grid of touching photos, `Feature Card` loses its radius, `Feature Band` is new, `Story Block` drops its photo. Controls, cards, sheets and thumbnails keep their radii. Templates for Listing, Product page, Home, Favourites and Not found are rebuilt; the pattern stories follow, text sections use the page gutters instead of the centred container and `--sf-gutter-md` becomes 40 px.
- `Combobox` gains `tone`: `default` (bordered, unchanged), `quiet` (filled with `--sf-surface`, no border, for the site header) and `inverse` (filled with `--sf-primary-soft`, primary-foreground text, for a primary-coloured header or a header on a photo). They match the DS library `Search Field` tones plain and primary. Covered by `combobox.test.tsx` (tones plus open and select by keyboard) and two stories.
- Mobile templates added for Cart, Checkout, Order confirmation, Favourites and Not found. The mobile cart pins a bar with the total and the Checkout button to the bottom of the screen, so the summary card drops its own button below `lg`; the cart story follows.
- Mobile type hierarchy (design review): below `lg` headings step down so that a phone screen has three levels: page title 28 px (`display-s`), section and empty-state title 22 px (`title`), card, sheet and dialog title 18 px (new token `text-sf-title-sm`, regular weight). `Dialog.Title`, `Sheet.Title` and `Card.Title` switch between `title-sm` and `title` at `lg`. Text inside fields (`Input`, `Input.Stepper`, `Combobox`) is 16 px below `lg`, because iOS Safari zooms the page when a focused field uses a smaller size. The DS library mobile variants and mobile templates follow, with a "Type on mobile" board on the Foundations page.
- Repetition review: each fact appears once per screen. Removed: the pinned mobile checkout bar (the summary card carries total and button), the "Free delivery" lines that repeated the announcement bar and the Delivery row, the price-change alert that repeated the line badge, the code name in the summary (row is "Discount", the tag names the code), the selected value next to option labels, "Ships within 1 day" on the one-time option, the checkout stepper (the checkout sections already show progress; `Checkout Steps` is deleted from the library), category links in the footer and Favourites in the mobile menu (both are in the header), the repeated roast message on Home and Listing. `Breadcrumbs` gains `showCurrent` so the trail can show parents only when the page title sits right below. On phones the first and last name fields stay side by side.
- Account and B2B phase: DS library page "Account and B2B [E-commerce]" holds `Portal Nav Item`, `Portal Nav` (sidebar on desktop, scrolling tabs on mobile), `Table Header Cell` (sort none, ascending, descending), `Stat`, `Tier Prices`, `Buy Box B2B`, and `Badge` gains `success` and `error`. Screens: orders, order detail, reorder preview, shopping list, saved carts, approvals, credit, company, buyers, addresses, price list, product page with tier prices; mobile for orders and approvals. The pattern story `Patterns/Account and B2B portal` is rewritten to match (eleven stories). Rules it follows: every table column has a sorter with `aria-sort`; tables scroll inside their own container below `lg`, except orders, which becomes a list of rows; sort buttons and row links are at least 24 px tall; the reorder line moves its difference badge to a second row on phones. The portal has no backend yet, so the stories use sample data. Not drawn yet: overview, quotes, returns, profile.
- Monorepo wiring after moving onto current `main`: the package follows the repo versions (0.11.0, TypeScript 7.0.2) and is `private` until maintainers decide to publish it; its manifest is copied in both `Dockerfile` install stages; the token parity test is registered in `scripts/repo-wide-guards.mjs` because it reads `apps/mercato/src/app/globals.css`; the budget script sorts with an explicit comparator; the `Accordion` default glyph is held in a constant so the admin icon registry scan does not read it as a lucide icon name.
