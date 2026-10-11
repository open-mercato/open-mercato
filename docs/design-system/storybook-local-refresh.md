# Open Mercato Design System — local integration

The primary catalogue is the native **Settings → Developers → Design system** page at `/backend/design-system`. It uses the existing `design_system.view` permission and the shared gallery registry. It requires no separate Storybook server, iframe, repository or deployment. `yarn storybook` remains optional development and validation tooling.

Opening a component mounts one selected variant. The URL preserves family, entry and variant; an explicit All variants option remains available. The native page also has cross-family search, collapsible copyable source, responsive family navigation and canvas-width controls. Width controls resize the component container; real viewport media queries are verified separately in browser checks.

The Figma source inventory is included in Foundations → Figma source library, with source-set links and links to available code. The inventory covers 90 Figma pages: 84 non-empty pages, 6 section pages, 243 component sets and 4695 variants. This is complete structural discovery, not a claim that every source variant or product screen has been implemented or visually matched.

## Current validation checkpoint

Runner: local (Docker daemon unavailable). The shared registry currently has 150 entries and 939 variants in 17 families.

- All 25 workspace package builds pass, including the native package path. The standard build→generate→build sequence generated the previously missing entity registries.
- The native explorer's eight focused tests pass: Settings metadata and access guard, summary cards without mounted examples, selected/all variant rendering, same-URL component/family navigation while searching (desktop and mobile), and exact-code clipboard success/failure. The Settings navigation and URL/width behavior are covered by an added integration test, which is not yet verified against the local database.
- Native application startup and the login page work. Authenticated verification is blocked by the older local database: `roles.min_active_holders` is missing. A read-only check found 70 pending migrations across 30 enabled modules. No migrations have been applied; the user has been asked to approve a local backup and the existing migration command.
- The package import rewriter now parses actual import declarations. Eight regression tests pass, including an esbuild round trip proving source-code strings are preserved. Core's build also copies the gallery's original PNG/SVG assets into the published package layout.
- HR: 28 examples in both themes, all 14 mobile layouts and interactions. Finance: 32 examples in both themes and mobile layouts. Marketing: 18 widgets and 54 control/artwork examples in both themes. Crypto: 137 examples in both themes, 24 mobile checks. AI: 16 source sets / 111 variants represented by 24 compositions and 12 browser check groups. All report zero runtime errors and use local sample data. Key components cover 153 source variants through matrices/compositions with 12 browser checks; minimum measured non-text glyph contrast is 3.075:1.
- Local Code Connect parsing passes for 32 snippets across 28 verified component sets, without parser errors. Online validation is unavailable with the connected Figma plan/seat; nothing was published.
- The expanded static Storybook build and all 25 package builds pass. The complete browser smoke passes: 1113 stories and 514 interaction/measurement checks, zero runtime errors and zero tenant API requests. Generated inventories have been refreshed. The older 447-story report remains historical. Consolidated evidence is in `figma-audit/integrated-validation.json`.
- Full UI and Core TypeScript checks pass. Focused DS lint passes. Token parity and all 64 checked theme/color pairs pass; the token snapshot and create-app template are synchronized. All 61 selected UI suites / 878 tests and all 9 design-system suites / 37 tests pass. The shared class-merging tests pass (7), as do all 8 import-rewriter regression cases.

## Source coverage and remaining work

Implemented follow-up includes source Avatar sizes and stacks, all ten Badge hues, Tag/Status variants, selection cards, menus, navigation and headers, calendar/time pickers, progress, sliders, ratings, password strength, file/image uploads, rich editor layouts, text inputs, table cells/headers, filters, feeds, notices and the 34 original empty-state illustrations. Individual geometry and interaction evidence is in `docs/design-system/figma-audit/`.

The source icon catalogue contains all 1667 sheet names, with installed Lucide components for 1647 names and 20 original Figma SVG fallbacks. The complete source artwork catalogue is integrated: 439 brand assets (including 84 style variants), 263 flags, 607 emoji, 16 store badges and 10 cursors. Source artwork uses lazy-loaded collections and paginated browsing. All 1335 PNGs decode in both themes; search, pagination, exact source-node selection, clipboard output and 375 px layouts pass. The native source library also passes search and source/example-link checks for all 84 pages.

Marketing & Sales, Cryptocurrency and AI Product source component examples are implemented and individually validated. Product-screen and landing-section/template references remain inventoried; their full React implementation is not implied by the primitive or widget examples. Keep these gaps explicit until their work is complete.

Application typography remains the existing font stack. Storybook offers an Inter comparison; source sizes have named DS utilities. Where literal source colors do not meet contrast requirements, accessible semantic roles are used and the difference is recorded with measured contrast.

All work is in the existing repository and remains uncommitted. No commit, push, Figma write or publication was performed.
