# Local style agents

Status: Implemented locally; standalone integration runner pending. Scope: local browser branding in the existing Open Mercato checkout; no commits or pushes.

## Problem and behavior

The designer needs one dedicated Design System destination for uploading a replacement logo and experimenting with existing color studio palettes, then explicitly applying the result across Open Mercato. Add `?view=style-agents`, labelled “Agenty stylu” in Polish, in the existing catalogue navigation. Show the logo with the existing live light/dark specimens. Upload remains local; accept decoded PNG/JPEG/WebP images up to 1 MB and 4096 pixels per axis. Provide clear validation and recovery feedback.

Editing is a draft. Apply persists an explicitly selected browser-local style and updates real app chrome and identity colors. Navigation and reload retain the applied style; other tabs synchronize. Restore defaults removes that override and reveals the host's existing organization logo and theme. State is specific to this browser/origin and is not organization-wide server configuration. The UI explains this distinction. There are no API writes, database changes or new dependencies.

## Architecture and boundaries

Reuse ColorPlayground and existing primitives. Add an additive UI theme utility for validated local style storage, a subscription hook and a runtime mounted by ThemeProvider. The runtime uses one owned stylesheet for light/dark identity overrides; removing it restores original CSS without mutating underlying token definitions. AppShell reads the optional logo override while preserving its prior organization logo fallback.

Only primary/hover/foreground and Open Mercato brand lime/yellow/violet/foreground tokens are eligible. Reject malformed storage, oversized images, unrecognized CSS properties and non-HEX color values; ensure foreground/primary and foreground/hover pairs meet 4.5:1. Never change statuses, destructive actions, selection-control indigo, third-party brand tokens or focus anatomy. Studio exploratory palettes stay scoped; not every experimental token is a supported global override.

## Migration & Backward Compatibility

No existing props, routes, identifiers or token defaults are removed. New optional theme utilities and the additive catalogue view preserve existing consumers. Previously stored theme selection continues independently. Reset restores the app's previous theme tokens and organization logo rather than assuming a particular default image.

## Validation

Local runner. Unit coverage: storage validation, token allowlist, contrast rejection, malformed saved data, failure without partial application, synchronization, reset, dark/light stylesheet rules and cleanup. UI coverage: upload validation, draft isolation, apply, restoration and navigation. Extend native gallery integration scenario for the new destination and controls; no affected API paths. Native browser check: local preview, explicit apply in real shell, navigation/reload persistence, reset, light/dark rendering. Restore original app appearance after verification.

## Rich palette examples

Following the user's UI Colors screenshot, expand the existing compositions into eight distinct, responsive visual cards: portrait/editorial, product, subscription selection, creative categories, tasks and related studio content. Use existing local photo/product assets rather than remote dependencies. All three studio colors drive large surfaces, soft cards, accents and readable foreground pairs. Maintain equal-height grid rows, generous DS spacing and real local selection/toggle feedback. Comparison mode shows two columns per theme; a full-width theme may show four. Preserve the earlier exclusion of CRM, HR, financial modules and landing-page sections from the catalogue.

## Validation record

Local runner: initial runtime/provider/shell tests passed (40 tests); core style-agent/navigation/color-playground tests passed (22 tests), UI and core type checks passed, both packages built, and module generation passed. Native Chrome check verified draft isolation, applying blue primary, the unchanged error-status token, persistence on another catalogue page and after reload, separate light/dark action colors, rehydrated primary seed and reset removing the owned stylesheet. Original host appearance restored. Browser file chooser automation was blocked by the extension's file-URL permission; upload validation and decode/race/error flows are covered by unit tests. An integration scenario was added; its standalone runner has not been executed.

Final rich-composition coverage: 26 core tests passed (including four composition tests), for 66 relevant tests with the UI suites. Final UI typecheck and core build passed. Native Chrome verified local photos, light/dark cards, selecting the team option, completing a task and the reference three-color draft. At 390 px, all eight cards had no internal horizontal overflow and the document fit the viewport; the viewport override was reset. Composition surfaces now own their theme background to keep headings readable under the opposite host theme. Four columns are reserved for containers at least 1280 px wide; normal sidebar layouts use two. The apply bar is compact on desktop and non-sticky on mobile.

## Palette role swaps and compact specimen

Add reversible, accessible pairwise swaps for all three color roles. Preserve the exact three seeds, switch supporting colors to manual overrides, and derive safe action shades again if primary changes. Incomplete HEX drafts disable swapping. The same draft/export/apply pipeline consumes the swapped palette; no new API paths. Cover every pair, reversibility, and incomplete-input guards in ColorPlayground tests. Replace the stretched project specimen with a compact list/detail composition; keep search, local creation, selection, status and settings behavior. Verify these paths with existing specimen tests and native browser checks.

Swap/specimen validation (local): 15 focused tests passed, core typecheck passed, core build passed. Native browser confirmed primary/secondary exchange and reversal, and the compact two-column list/detail panel with circular progress. The integration scenario now includes swapping and seed preservation; the standalone integration runner remains unexecuted.

## Single editing destination

Remove the duplicate ColorPlayground from FoundationGuide. Foundations remain read-only palette/token documentation (copying remains available); one localized link points to Style agents as the sole logo and color editor. The studio link uses the destination name consistently across all five locales. Verified in the native browser: foundations show the explanatory link and no HEX editor. Local core build and typecheck passed.

Inline swap refinement: each seed label now owns a compact swap popover showing the other two roles with live swatches and HEX values. Removed the detached swap toolbar. Local validation: 11 playground tests passed, single-entry incremental build passed, native browser verified opening, swapping and reversing while preserving all three seeds.

Direct manipulation refinement supersedes the popover: left/right arrows swap adjacent seeds immediately; a drag handle supports swapping any two fields. Outer arrows are disabled. Incomplete drafts block both interactions, and drop targets receive a focus-token outline. All five locales include direction and drag labels. Local validation: 13 playground tests passed (adjacent arrows, boundary guards, reversal, non-adjacent drop), single-entry incremental build passed. Native browser verification was blocked by browser automation timeouts.

Apply actions refinement: remove the floating bottom toolbar entirely. Keep compact Apply and Restore defaults actions in the page header, with restoration guidance in a tooltip and result/error feedback below the header. Short labels localized in all five locales. Local validation: 8 style-agent tests passed; single-entry incremental build passed.

Gallery code presentation: replace repeated code accordions with Preview/Code tabs in component examples and foundation sections. Default to visual content, preserve per-variant copy, and localize tabs in all five locales. Local validation: 8 clipboard/explorer tests passed; incremental build of the three affected components passed.

Disclosure audit follow-up: removed all six remaining native details/summary wrappers across token export, entry/foundation usage guidance, source inventory, shadow layers and typography reference. Content is directly visible with static headings; token label no longer says Show. Actual accordion component demonstrations retain their behavior. Search confirmed no disclosure wrappers in gallery chrome/foundation references. Local validation: 25 tests across four affected suites passed; six-entry incremental build passed without clearing dist.

Catalogue masonry: family previews and the component index use responsive CSS columns with unbroken cards and consistent vertical gaps. Wide specimens retain full-width spans; narrow containers retain one column. No measurement observers or dependencies. Incremental build passed. Browser visual check unavailable because Chrome debugger detached.
