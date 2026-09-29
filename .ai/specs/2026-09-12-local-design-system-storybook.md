# Local design system and Storybook refresh

## TLDR

Integrate the refreshed design-system catalogue into Open Mercato at Settings → Developers → Design system. Reuse the production components, gallery registry and canonical stylesheet. Optional Storybook tooling provides isolated developer validation of the same examples. No commits, pushes, publication, or Figma writes are authorized.

## Overview and problem

The existing application gallery needs complete source discovery, corrected component examples, searchable families, isolated variants and copyable code. The user wants to access it from Settings as part of Open Mercato, without a separate running Storybook instance. An honest source coverage record must distinguish available components from remaining full-screen references.

## Proposed solution and architecture

- Native `/backend/design-system`, registered in Settings under Developers, retaining the existing `design_system.view` permission. Family summaries mount no interactive examples; selected entries render all variants and retain family/entry/variant URLs.
- Optional Storybook 10.6 with the Next.js/Vite framework and accessibility/docs addons, configured in `packages/ui/.storybook`, generated from the same registry.
- Generate CSF stories and catalogue metadata from the existing gallery AST reader. Every variant renders the existing production component with the gallery's mock props. Stable entry IDs become deep links.
- Derive preview CSS from `apps/mercato/src/app/globals.css`, excluding only application-specific generated source scanning. Do not fork the tokens.
- Apply theme at the document root, including portaled overlays. Provide application-font and Figma Inter comparison modes; do not silently change application typography.
- Keep the catalogue documentation separate from runtime component exports. Extend missing foundation specimens and fix the demonstrated feature-alert preview/snippet mismatch in the existing gallery.
- Continue the read-only Figma audit with measured Button and Basic Input variants. Add Controls for Input/SearchInput/PasswordInput and missing shared gallery states. Correct disabled text/placeholder/decorative icon/hint roles and secondary-action focus styling using existing tokens.
- English developer documentation; existing gallery chrome keeps its locale dictionaries.

## Figma evidence

Source file: `qCq9z6q1if0mpoRstV5OEA`. The supplied node `210:4004` is a section page. Read-only inspection on 2026-09-12 resolved actual foundation frames. `199703:1538` confirms brand lime #B4F372, yellow #EEFB63, violet #BC9AFF. `2697:315` specifies Inter Display 56/64, weight 500, tracking -1% for display H1. Existing app font tokens use system sans/mono. This is a documented difference, not evidence that every primitive matches Figma. Local Code Connect declarations use verified source node IDs; publication is not evidenced.

## Data models and API contracts

No database, tenant records or external writes. Next.js navigation is supplied by the Storybook framework. Existing gallery IDs, app routes and permissions remain intact. Following the user's request to cover the complete Figma library, additive primitive capabilities are in scope: numeric Avatar sizes, Badge/Tag appearances, color opacity, rating bars, half ratings, password-strength presentation, scrollbar sizes, compact buttons, progress sizes and overlay arrangements. Existing prop values and defaults remain supported. No production dependencies are added.

## Complete-library follow-up

The user corrected the limited initial review and requested every DS element. The source inventory now covers all 90 pages (84 non-empty and 6 section pages), 243 component sets and 4695 variants. Each non-empty page has a representative design context. Counts establish the audit boundary; they do not prove visual parity. The native `Complete library` family and the optional local Storybook list every page, source axes, standalone assets, related runtime examples and outstanding differences. The current implementation scope includes the complete DS library, widgets, landing sections and product-screen compositions. The user reiterated complete Figma coverage on 2026-09-15; inventory-only pages remain outstanding work, not excluded scope.

The native catalogue lists all 84 non-empty source pages as compact inventory entries, filters them by source group and searches page names, component sets and variant values. It shows counts, axes and working Open Mercato examples without whole-page image previews. Source node IDs remain internal parity metadata; the native catalogue and Storybook expose no outbound Figma links.

Implementation proceeds through measured source properties, additive production components, localized live gallery examples and focused browser checks. Each related Figma page remains partial until its dimensions, assets, states and combinations have been checked; a working generic slot is not full coverage.

## Migration and backward compatibility

Additive local tooling and developer documentation. Gallery IDs remain stable; new foundation entries and state variants are additive. Regenerate the existing design-system inventory when entries change. Runtime extensions remain additive and preserve existing prop values, defaults and import paths. No production dependency additions. Input, FormField, SearchInput and PasswordInput receive token-only disabled/focus fixes; dimensions, exported props and interaction behavior remain stable. A disabled input does not recolor independently enabled trailing actions. FormField no longer compounds disabled tokens with opacity on the entire field.

## Validation plan

Runner: local (Docker daemon unavailable). Build the static Storybook; verify every generated entry/variant and theme against the source registry. Run existing gallery integrity/render coverage and token parity checks. Browser checks cover search/filter/deep-link, light/dark portals, keyboard dismissal, responsive catalogue and representative inputs/overlays. Capture local screenshots. Report actual results and any limitations in the handoff.

## Risks and impact review

| Scenario | Impact | Mitigation | Residual |
|---|---|---|---|
| Gallery and Storybook drift | Misleading examples | Generate stories from the live registry before start/build | Snippet semantics still require review |
| Imported backend code needs services | Preview failure | Existing mock renderers and Next.js test context; inspect browser errors/requests | Complex families require browser verification |
| Dark overlays inherit light tokens | Visual regression | Theme the document element, test a real dialog | None expected after verification |
| Figma completeness overstated | Misleading design handoff | Separate verified foundations from pending component comparisons | Full Figma parity remains explicitly unverified |

## Validation status

The initial 117-entry/313-variant and 447-story validation was an earlier checkpoint, superseded by the expanded source audit and native Settings integration. Current evidence and remaining checks are maintained in `docs/design-system/storybook-local-refresh.md`; no current full-library or authenticated application pass is inferred from that older result.

## Changelog

- 2026-09-12: Local implementation started; reference catalogue and Figma foundation frames inspected.
- 2026-09-12: Foundation specimens, five locales, generated catalogue, Storybook, documentation and browser validation completed locally. No external publication.
- 2026-09-12: Continued with eight missing shared state examples, three additional Controls playgrounds, measured Button/Input Figma references and disabled/focus token corrections. No API or dimension changes.
- 2026-09-13: Promoted the complete source inventory to its own native family, bundled local previews for all 84 non-empty pages, removed visible Figma links and verified the first and last catalogue pages in Open Mercato.
- 2026-09-13: Removed whole-page image previews at the user's request; retained the complete compact inventory, variant axes and links to working Open Mercato examples.


## Native Settings integration — 2026-09-13

The user clarified that the complete DS catalogue must be a native part of Open Mercato, visible in Settings and usable without another Storybook instance. The primary UI is the existing `/backend/design-system` module, sharing every family, entry, variant and source snippet with optional local Storybook tooling. No iframe, proxy, second repository or separate deployment is introduced.

The page uses `pageContext: settings` and the existing Developers navigation group, retaining the route and `design_system.view` guard. Family/search results show concise component cards; opening a component renders every distinct variant immediately, with localized captions and copyable code. There is no variant selector. Existing family/entry links remain valid, and the additive `variant` query scrolls to a reproducible example within the complete component page. Examples use the available content width; responsive behavior is verified at actual browser sizes. The catalogue has no preview-width selector.

Validation adds the Settings→DS navigation, variant URL, component isolation, absence of preview-width controls and no-6006/iframe path to the existing integration suite. Local app startup uses the existing local database if available; it does not authorize migrations, database initialization, commits, pushes or publication.

The internal family navigation uses the supported scoped menu surface `menu:sidebar:settings:design_system`, so global Settings extensions remain in the application Settings menu. Native search clears on an actual component or family navigation even when the destination URL is unchanged.

The general browse action opens `?view=components`, a category index with live representative components. Component details expose the actual entry title and an outlined return action naming the owning category. Navigation scrolls to the heading below the application header rather than past the return action. Existing family and entry URLs remain valid.

Foundations render as a continuous visual guide. The same sidebar contains Start, Foundations, Components and Guidelines, followed by localized foundation section links; other family links are omitted in that context. Existing entry deep links scroll to the corresponding section. Color specimens are enlarged, spacing bars show proportional lengths with rem/px measurements, and the token reference compares light/dark values from the actual application CSS. Color values are displayed as browser-rendered sRGB hex; inherited theme values are retained. Code and implementation guidance remain collapsed after examples. Validation covers browse destination, multiple-category index, return actions, scroll targets, theme declaration inheritance and browser checks at desktop/mobile sizes.

### Designer-facing entry point

The user supplied `https://ui.ai-created.com/designers` as a reference for presentation. The native root route now opens an overview with a clear introduction, direct links to foundations/components and a live Button playground. Usage guidance has its own navigation destination. The primary navigation belongs to the existing gallery shell. `?view=principles` shows the usage guide; existing `family`, `entry` and `variant` links keep their destinations. Source inventory remains available through `?family=library` as a secondary reference, with no whole-page screenshots or outbound Figma links.

The overview uses existing UI primitives and registry families, local interaction state and five locales. No new component family, public primitive API, dependency, tenant data call or standalone application is introduced. The landing page avoids repeating the sidebar destinations in additional card grids.

Following the user's review, the overview, guidelines and component families share one sidebar navigation (a single equivalent selector on mobile); the separate horizontal menu is removed. Foundations display all reference sections together at the available width without the variant/viewport toolbar. Component examples omit viewport controls, and single-variant entries omit the redundant variant selector.

Family overview cards now show representative live specimens immediately. The duplicate row of component-name links is removed, and import paths, counts, prose and code remain in component details rather than the visual overview. Dense button matrices are represented by small working samples. Search results stay lightweight; the existing component title links open the full variants and documentation.

Validation uses the local runner: core typecheck, 38 existing gallery tests, core build and module generation. Browser verification covers the default overview, native Button documentation, the guidelines view, appearance selection, disabled state, action feedback and the 390 px responsive layout. Visual diagnostic: 7/8 checks verified (9/10); a complete color-contrast matrix across themes remains outside this layout check.


### Whole-catalogue presentation audit — 2026-09-13

The source audit covers all 150 entries, 18 families and 939 variants; individual browser verification is recorded separately in `docs/design-system/native-catalogue-visual-audit.md`. Registry IDs, primitive import paths and existing deep links remain unchanged.

- Overview specimens use explicit representative states and natural height. Dense matrices and asset browsers are not mounted in preview cards. Small samples are inert visual links to working details; large forms, charts and layouts span the content width. Container queries select columns from the actual available width.
- Detail views show one page title, a named return action and sibling components in the sidebar. Code and guidance remain collapsed below the specimen; import paths and duplicate titles do not occupy the primary reading area.
- Icons, logos, flags, emoji, store badges, cursors and registered menu icons share one collection browser, one local search, readable paginated tiles and an on-demand copyable JSX popover. The shell adds no second search or variant/viewport toolbar.
- Source inventory is a compact topic directory with direct native example links. Technical source inventory remains collapsed. No screenshots or outbound Figma links are introduced.
- All component variants appear together without a selector. The duplicate FileUploadArea drag-and-drop option is presented once while both existing URLs remain valid.
- SectionPage and sidebar demos no longer impose a 900 px height or clip a viewport-sized page. Narrow layouts are verified in the native Settings shell.

Validation runner: local. Core typecheck, gallery unit tests, core build and Storybook inventory generation/check are required. Browser checks cover every family overview and targeted interactions, not all 939 variant behaviors. No database migrations, commits, pushes or publication are performed.


### Localized catalogue and all variants — 2026-09-13

At the user's request, every component detail now shows all distinct registered variants without a selector. Existing `variant` query links scroll to the corresponding example; `__all` remains a valid equivalent of the default view. The known duplicate FileUploadArea example is presented once. Asset collection navigation remains a collection browser rather than a component-variant selector. Code is mounted only when its disclosure opens, keeping large all-variant pages from mounting repeated source listings; copying still uses the exact registered snippet.

Presentation captions are translated through locale dictionaries without changing entry/variant IDs, component APIs or copied prop values. Descriptive captions, demonstration actions, input labels, placeholders, messages, mock content and usage guidance use the active locale. Component names, personal/brand names and technical identifiers in code remain stable. Translation coverage tests load the real registry so mapped variants and usage rules cannot silently miss dictionaries; native rendering verifies Polish Button text and absence of variant selectors.

This update remains local in the existing repository and existing Settings route. No commits, pushes, migrations or external publication are authorized.


## Persistent category navigation — 2026-09-13

Replace the flat contextual sidebar with a stable category tree. All categories remain reachable from a component detail; the active category opens its indented component links automatically. Category labels open the visual overview, while separately labeled disclosure buttons expand the child list without navigation. Component links have no repeated decorative icons; active links expose aria-current. Retain the existing menu injection surface and stable URLs. Mobile uses the same tree behind a labeled disclosure, closing on navigation. Families are loaded only on navigation or expansion. Validate cross-category navigation, keyboard disclosure, current-page state and mobile closing.


## Source completeness continuation — 2026-09-15

The new source audit found genuine missing landing sections, product compositions and thumbnail collections. Preserve a per-page evidence ledger in docs/design-system/figma-audit/coverage-2026-09-15.json; source links alone do not establish implementation or parity. The native foundations now share the measured source reference data with Storybook. A new landing category contains actual responsive, interactive section examples. Announcements covers six content types, three surfaces and desktop/mobile; FAQ covers ten distinct layouts and desktop/mobile with meaningful local disclosures and topic selection. Further landing categories and product compositions remain within the requested scope.

Validation adds fixture-free unit coverage of local interactions and translation completeness, generates the shared Storybook and harness inventories, and checks native category navigation, desktop/mobile examples and source assets. Existing permissions, module APIs and runtime tokens remain stable. No migrations or remote writes.

## Source continuation and preview recovery — 2026-09-16

The shared registry now includes all 18 landing-section categories (521 specimens), six referenced custom CTA examples, and ten full-page template compositions with four explicit desktop/mobile/theme variants each. Scoped template themes reuse application tokens. Dark embedded media and dialog portal theming remain documented review gaps; numerical coverage does not certify source pixel parity.

The HR mapping covers 77 recorded source frames with 76 specimens. Finance adds eight authentication examples to its 18 dashboard/card/transaction examples, leaving 22 settings/transfer frames. CRM person and company examples use retained full source contexts and local state only. Every registered family and variant needs translated captions in all five supported locales; no tenant APIs, new permissions or database entities are involved.

A separate remaining-work audit classifies pages, dialogs, component specimens, annotations and source references. The previous raw 412-frame total is not a valid completeness denominator. Preserve the original coverage snapshot and retain new evidence under `docs/design-system/figma-audit/`; do not treat missing temporary responses or sparse XML metadata as full source verification.

Runtime package validation found locale JSON imports excluded from the core build. The scoped DS asset-copy step now includes its locale JSON files alongside local visual assets. Native preview remains the existing Settings route, with its existing authentication guard. The app is running locally; a signed-in session is required for native visual review. Continue to validate registry/harness parity, source asset integrity, interactions, translations, type checking and the package build. No commit, push or publication is authorized.

## Button contrast correction — 2026-09-16

User review exposed unreadable FancyButton labels in dark mode. The brand gradient now uses the existing theme-invariant brand foreground and yellow token. The basic action uses normal foreground. Filled destructive Button, IconButton and FancyButton use the existing solid error surface/foreground pair. FancyButton darkens its lower gradient edge instead of adding a white sheen; hover changes elevation without washing out the fill. Public props, imports and action behavior remain unchanged. Quiet destructive buttons retain their existing treatment.

Native browser checks covered light/dark rendering. Measured sRGB contrast for the corrected brand gradient is at least 8.57:1 across sampled stops and 4.76:1 for the brightest destructive surface. Unit regression tests sample the actual token values for both themes and gradient overlays. This is a targeted button correction, not a certification of the entire catalogue.

## User-requested catalogue scope revision — 2026-09-16

The user explicitly removed landing pages, CRM, Finance and HR from the design-system catalogue. This supersedes the earlier complete-product-screen scope. The shared registry no longer registers `landing`, `landing-assets`, `crm-pages`, `finance-pages` or `hr-management`. Charts retain general-purpose chart components and marketing widgets; HR/Finance widget examples are removed. Shared Sidebar examples omit their HR/Finance product variants. Native navigation, search and optional Storybook derive the same smaller catalogue.

The source-library generator applies `docs/design-system/figma-audit/catalogue-scope.json`, excluding the Landing Page group and the dedicated CRM, Finance, HR and HR/Finance Widgets source pages. It publishes 60 topic pages; the original 90-page audit remains intact, with 24 excluded pages and six section markers recorded separately. Removed section links and presentation overrides are cleaned up. Reusable primitives, including original empty-state illustrations, remain documented. Previously authored demo source and audit evidence remain local, but have no catalogue registration. No actual Open Mercato business module, tenant data, permission or database schema is removed.

Validation includes `node --test scripts/__tests__/storybook-catalogue-scope.test.mjs` for registry families, entries, Sidebar variants and source-library search data. Regenerate both inventories and run existing gallery coverage/parity tests without weakening primitive coverage rules. Verify the resulting native menu in the authenticated Settings route. Work remains local, without commits or pushes.

## Schedule readability correction — 2026-09-16

The shared ScheduleCalendar now uses quiet semantic event surfaces and normal foreground text in both themes, subtle scoped grid borders, readable day headings and 24-hour times. Full-day closures occupy the all-day row; timed and overnight items retain their time placement. The initial scroll targets 08:00 without removing overnight hours. Event titles wrap, and hourly rows provide room for time and two title lines. Toolbar dates follow the active locale and appear once, in the date picker; switching views retains the selected date. Gallery fixtures derive the sample week around June 10 from the active locale so all sample events remain visible. Month headers contain weekdays only.

No public ScheduleItem props, callbacks, routes, data or business-module registration change. Calendar loading and labels are localized in five languages, and app styles/locales are mirrored into create-app. Validate calendar behavior, locale-specific fixture boundaries, UI/core type checking and package builds, then visually inspect native Settings in light and dark themes.

User review further established a status-first color hierarchy shared by calendar, grid and agenda: confirmed → success, negotiation → warning, cancelled → error, draft/unspecified → neutral. Cards blend 8% of the status accent with the card surface; ordinary foreground titles remain dominant. Grid and agenda use labeled, dotted semantic status badges. Item kind is translated secondary text, with no competing color classification. Native light/dark checks and card interaction tests cover the updated presentation.

## Typography usage hierarchy — 2026-09-16

Typography now opens with five practical roles: page title, section heading, body, label and helper text. Each row has a real specimen, size/line-height and guidance on when to use it. Repeated scale/font-family blocks are consolidated. All 22 source styles remain accessible inside an optional technical-reference disclosure; no tokens or public UI props are removed. Guidance is localized in five languages. The shared typography entry retains the `roles` and `source-typography` variants, bringing the catalogue to 877 variants across 148 entries and 18 families. Regenerate Storybook and packed inventories; verify the compact default, full-reference disclosure and native Settings presentation.

## Local color preview — 2026-09-16

Add a compact, reversible accent-color playground to the native DS home and color-token guide. It reuses shipped primitives and the host's light/dark CSS-token definitions, scoped only to the specimen container. The user chooses a HEX color or picker preset, switches preview theme, resets, and copies the derived accent values. Do not modify root theme, user preferences, tenant settings or global/status palettes. Semantic status examples remain unchanged across accent selections. Compute readable foreground/hover pairs and display their measured contrast without claiming whole-theme accessibility certification. Show actual button/input/status/form examples rather than static color screenshots. No new dependency, endpoint or public component API.

Validation: pure color math on extreme and mid-tone inputs; component tests for input validation, reset, interaction, status preservation and root-theme isolation; native authenticated UI check for accent and local theme changes. Extend the gallery integration coverage for this read-only page interaction; no API path is added. Work remains local, with no commits/pushes.

Local validation completed: 43 focused unit/component/navigation tests passed; core typecheck and package build passed. Authenticated browser checks confirmed blue/orange/white accents, independent light/dark preview, invalid-input feedback, reset, sample save feedback and the color-token guide placement. A matching Playwright regression scenario is included; its standalone integration runner has not been executed in this local session.

## Designer color studio — 2026-09-16

The initial four-swatch/form preview is insufficient for design work. Expand the same local consumer into an accent studio: perceptual 11-step shade generation with an exact base-color anchor, neutral temperature selection, independent light/dark action-shade mapping, simultaneous theme comparison, real interactive project/table/form specimens, and explicit default/hover/focus/disabled states. Show color-role guidance and measured foreground/background contrast pairs rather than a single ratio. Export both theme token maps and shade scales as CSS or JSON; retain semantic status tokens from the host. Invalid edits retain the last valid palette; reset clears all local overrides. No global writes, APIs, production dependencies, registry contracts or application themes change.

Validation: deterministic shade generation and gamut/contrast math; controls and export integration; native layout and interaction checks in both themes, comparison and narrow view. Extend the existing local tests rather than claim whole-theme accessibility from text contrast alone.

Implemented three independently editable 11-step palettes, with analogous, triadic and split-complementary harmony suggestions. OKLCH interpolation preserves the exact seed and reduces chroma to fit sRGB. Both themes show creative cards and interactive table/form specimens. Dark soft surfaces blend 15% accent into the neutral card surface; light surfaces use pastel stops. Contrast inspection covers selected text/background shades and the actual action, hover, body, muted, selected-row and focus pairs. Export includes all three palettes, neutrals and both scoped themes. This is an independent implementation, not a reproduction of UI Colors' proprietary algorithm.

Local runner validation: 190 focused tests across five suites passed, core typecheck and core build passed, and focused diff whitespace checks passed. Authenticated browser review confirmed the three scales, manual secondary/tertiary edits, and simultaneous light/dark card rendering. The updated integration scenario was authored but its standalone runner was not executed; narrow-viewport review remains outstanding.

## Inline dialog presentation — 2026-09-16

The 27 visual dialog variants render their header, body and footer directly in the catalogue using the shared dialog primitives. They create no modal portal, backdrop or focus trap and no longer require the repeated opening action. Separate behavior demos retain real modal opening/closing. Code examples match the inline specimens. Seven of the focused tests cover these variants and modal behavior; native authenticated visual review confirmed inline presentation in the existing Open Mercato route. Public dialog APIs remain unchanged.

## Catalogue spacing correction — 2026-09-16

Audit the rendered control bounds rather than assuming padding classes guarantee visible breathing room. The AI Google sign-in example constrains a translated label to 172px; native measurement shows its logo starts 1.125px outside the button despite 10px/16px CSS padding. Remove that fixed width and preserve intrinsic control padding. Apply the same correction to the add-project action and response-length selector; let translated labels wrap within constrained settings/navigation rows. Align the settings controls at the standard 36px height and give the counter sufficient input width. Search and icon grids must fit their available stage width. Shared framed stages keep 16px padding on narrow screens and 24px on larger screens, top-aligned examples while preserving each specimen’s own maximum width; summary previews keep 16px inset and item gaps.

No primitive API, theme, module registration or behavior changes. Regenerate consumer code snippets through the existing generator. Validate existing gallery regressions, package type checking/build, and native control geometry, including a narrow viewport and the exact reported Polish label. Work stays local without commits or pushes.

Validation (local runner): core typecheck and core build passed; four focused gallery suites passed, and the six native-navigation tests passed after restoring the real QueryClientProvider and browser mocks in their harness. Generated snippets are in sync. Native Polish Google button now measures 196.26 × 40px with an 11px logo inset and 17px trailing text inset. At a 390 × 844 viewport, Google, auth icons and settings controls fit their frames; the response-length selector opens and changes its value. Temporary viewport override was reset.

## Color harmony feedback correction — 2026-09-16

The former “Generate harmony” action only cleared manual secondary/tertiary overrides. In the default automatic state it silently did nothing. Keep deterministic automatic derivation, show its current state next to a short definition, and describe each selected harmony's visual purpose. Offer “Restore automatic colors” only after a supporting input has been edited, including an invalid draft. Restoring replaces both supporting colors, preserves the primary color and reports completion. Primary changes preserve manually edited supporting colors; changing the harmony explicitly selects a new automatic combination. Local preview only; no contracts or global theme changes.

Regression coverage exercises mode changes, primary changes, manual overrides, invalid inputs, restoration, disappearing redundant action and confirmation, alongside existing color math tests.

Validation: local runner; 152 tests passed across color studio math and UI suites; core typecheck and build passed. Native Polish preview verified: manual secondary #123456 restores to #00B78C with confirmation; switching Triadic to Analogous changes supporting seeds to #CD8F00 / #F76471 while preserving primary #F4700D. Reloaded the local runtime to verify the final short definition.

## Open Mercato empty-state artwork — 2026-09-16

Replace the catalogue's Align UI illustration presentation with four newly generated Open Mercato images: records, search, files and messages. Art direction uses off-white matte objects with graphite, lime and lavender accents; transparent backgrounds and no embedded text. Store the original PNG files in the UI package and generate its self-contained image registry from those sources. Add new `mercato-*` illustration kinds while keeping earlier kinds available to existing consumers. The native collection displays four real EmptyState components with translated titles/descriptions; the compact preview and first EmptyState example use the new records image. Remove the obsolete Figma attribution from the new illustration entry.

Validation: all four PNGs have transparent alpha; UI and core package builds passed, core typecheck passed, 15 existing EmptyState tests and 12 gallery registry/presentation/render tests passed. Generated Storybook inventory/snippets refreshed using the existing generator.

Native preview verified in dark and light themes at `/backend/design-system?family=feedback&entry=empty-state-illustration`: all four transparent images display with Polish titles/descriptions and balanced card spacing. Restored the original dark appearance after checking. No commits or pushes.

## Empty-state art direction correction — 2026-09-16

Replace the initial 3D images with universal flat black-and-white illustrations following the user’s visual reference and 1990s programmer/gamer direction. Retain the four existing Mercato kinds and translated empty-state content. The new collection uses transparent backgrounds, desktop/terminal, magnifier, floppy-folder and chat motifs; no brand-specific colors. Invert only the Mercato collection in dark mode so its outlines remain visible. Preserve legacy consumer artwork and interfaces.

Correction validation (local runner): the UI package build passed, generated image registry is in sync, and all four 1254 × 1254 originals have transparent alpha. Native authenticated preview verified all four illustrations in light and dark appearances; the original dark appearance was restored. No commits or pushes.
