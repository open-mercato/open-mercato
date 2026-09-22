# Native catalogue presentation audit

Date: 2026-09-13. Scope: all **150 entries in 18 families**, comprising **939 registered variants**. This is a source-code presentation audit, not a claim that every variant has been visually or interactively verified in a browser.

## Method and evidence

Reviewed every object with `id` and `variants` in `packages/core/src/modules/design_system/gallery/entries/*.tsx`, including mapped variant factories, and compared entry/variant IDs against `packages/create-app/scripts/design-system/design-system-inventory.json`. Examined the renderer bodies rather than title/variant counts alone. Followed the risky renderers into `demos/text-inputs.tsx`, `key-components.tsx`, `time-picker.tsx`, `selection-cards.tsx`, `menus.tsx`, `source-filters.tsx`, `shell.tsx`, `ai-product.tsx` and the local helper functions in the entry files. Widget and cryptocurrency variant dispatchers were inspected; each visual still needs browser QA at its intended size.

Classification covers presentation inside the native family catalogue. It does not change the public registry schema, component APIs, variant IDs, source inventory or deep links.

- **compact**: actual control or small composition, suitable for a two-column overview at desktop width. Natural height, no artificial large minimum height.
- **fullwidth**: structured reference, form, table, chart, feed, toolbar or layout. Span the content width and preserve natural height. Family overviews use one representative specimen; component details show every variant, as requested in the follow-up below.
- **dedicated asset browser**: the entry itself is a searchable/grouped asset collection. Give it one full-width browser surface and its own relevant controls. Never embed it in another searchable, independently scrolling component canvas.

All compact variants still need full available width on phones. All detail views must allow large state matrices to use the available content width. Size comparisons that intentionally demonstrate overflow should identify that behavior locally; the catalogue must not add another generic scroll layer.

## Highest-priority findings

1. **Identical wrappers hide unlike content.** A 24px action icon, a week calendar and a 45-icon matrix should not inherit the same padded, height-capped canvas. Remove the decorative outer card for components that already contain a card, table, panel or dialog surface. Keep the title and action to inspect details in catalogue chrome; the specimen itself comes first.
2. **The first registered variant is frequently an audit artifact.** `marketing-controls` begins with a product image, `cryptocurrency` with a tiny BTC icon, `table` with header state matrices, `alert` with 20 alerts, `time-picker` with status-chip matrices, and `button-group` with 15 groups. Those are useful detailed coverage, but poor family overviews. The table below specifies an explicit representative variant for every entry.
3. **Some entries have no small variant at all.** `compact-button` renders 16 controls in each variant. `key-icon` renders nine colors × five sizes. `banner` renders five banners. `phone-number-field` always renders three labeled fields. `source-icons`, `source-artwork` and `empty-state-illustration` are collections. A fallback heuristic cannot make these small. The accompanying `CompactEntrySpecimen.tsx` supplies real, small specimens for CompactButton, KeyIcon, Alert, Banner and one EmptyStateIllustration; icon collections use the dedicated browsing surface.
4. **Nested searches and scrolling create a navigation trap.** Asset catalogues, source inventory, filters, ScrollArea, notification feeds and schedules have meaningful internal controls. Do not stack catalogue search + variant selector + viewport selector + embedded browser search above them. Preserve only controls that affect the example. A scroll region that belongs to the demonstrated component is different from an arbitrary `max-height` applied to every preview.
5. **Heterogeneous entries need meaningful internal groups.** `marketing-controls` has 54 variants; `cryptocurrency` 137; finance widgets 32; HR widgets 28; marketing widgets 18. A flat variant dropdown with technical IDs conceals their content. Group controls/assets/layouts or widget kinds in the detail view, retaining stable variant URLs. The later user request supersedes the initial selection recommendation: render all detail examples together.
6. **Dead actions look unfinished.** Several existing renderers intentionally pass no-op handlers: basic ButtonInput copy/send; QuickFilters apply; list/result reset actions; standalone notification item actions; schedule item/slot clicks; EmailThreadsPanel compose/reply/refresh; next-step callouts and form/header action menus. They are not verified working interactions. Replace no-ops with local state/result feedback or show a clearly presentational state. Never wire these demonstrations to tenant APIs.
7. **Avoid duplicate renders.** `file-upload/default` and `drag-and-drop` both render the identical `FileUploadAreaDemo`. Keep both deep links for compatibility while sharing one visible specimen. The source inventory is a secondary catalogue view, not another layer above live examples.
8. **Large demo shells required their own layout fix.** The audit found `SectionPageMiniDemo` wrapping a viewport-sized SectionPage inside `h-80 overflow-hidden`, plus 900px sidebar specimen heights. These source demos are now corrected: SectionPage uses a natural-height responsive wrapper with the viewport minimum removed locally; HR/finance and AI sidebars use natural content height. HR/finance adjacent content wraps on narrow widths. Browser verification remains required.
9. **Chrome metadata belongs in details.** Import paths, source IDs, technical status prose, count totals and code snippets help implementation after selection. They should not displace visual specimens in the family index. Token names and values are essential in foundations and remain visible there.

## Companion configuration and integration

`gallery/presentation.ts` exports `fullWidthEntryIds`, `assetBrowserEntryIds` and `representativeVariantIds`. The representative map contains only choices differing from an unambiguous `default`, or the first variant when there is no default. Consumers should resolve explicit override → `default` → first variant. Do not insert generic `variants`/`horizontal` heuristics before the explicit mapping.

`components/CompactEntrySpecimen.tsx` exports `getCompactEntrySpecimen(entryId)`. It returns a true React specimen for `compact-button`, `key-icon`, `alert`, `banner` and `empty-state-illustration`, or `undefined` for other entries. These are overview specimens; complete registered variants and their code remain accessible in detail. The helper must not replace the complete detail variants.

Configuration validates against the current inventory. Source definitions remain the authority. This report records source-level findings and proposed treatment; final integration and browser verification are separate work in the main task.

Classified entries: **94 compact**, **52 fullwidth**, **4 dedicated asset browsers**. The full-width set includes the four asset browsers.

## Complete entry audit

### library — 1 entries

Source: `packages/core/src/modules/design_system/gallery/entries/library.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `source-library` | 1 | fullwidth | `inventory` | Own inventory search and page groups; render as one page, without a generic component card or second search. |

### foundations — 10 entries

Source: `packages/core/src/modules/design_system/gallery/entries/foundations.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `brand-colors` | 3 | fullwidth | `identity` | Show identity and gradient together; social colors are a separate labeled section. |
| `color-roles` | 3 | fullwidth | `action` | Show action/surface/status pairs together; keep copy affordance adjacent to swatches. |
| `color-tokens` | 4 | fullwidth | `primary` | Keep role tokens and dark/light values in one readable reference; no variant or viewport selector. |
| `state-tokens` | 7 | fullwidth | `info` | Compare all semantic states at once, each with role names; do not start with a state dropdown. |
| `chart-palette` | 2 | fullwidth | `numbered` | Display numbered and named swatches together; names are useful here. |
| `corner-radius` | 1 | fullwidth | `scale` | Inline labeled radius samples need no playground wrapper. |
| `typography` | 3 | fullwidth | `scale` | Actual size scale and roles require a readable full-width reference. |
| `spacing` | 2 | fullwidth | `scale` | Proportional rulers with rem/px values; no generic card or code panel. |
| `shadows` | 2 | fullwidth | `elevation` | Compare elevations on a consistent surface; separate focus example. |
| `motion` | 1 | fullwidth | `durations` | Use a live timing comparison and local replay; honor reduced motion. |

### icons — 3 entries

Source: `packages/core/src/modules/design_system/gallery/entries/icons.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `icon-registry` | 2 | dedicated asset browser | `component-usage` | Registry variant mounts searchable icon browser; overview should use tiny component-usage specimen. |
| `source-icons` | 1 | dedicated asset browser | `catalogue` | Existing catalogue owns search and groups; embed once at full width, no nested preview scroll. |
| `source-artwork` | 5 | dedicated asset browser | `brands` | Five complete artwork catalogues must become one group-filtered browser, without duplicated search fields. |

### buttons — 7 entries

Source: `packages/core/src/modules/design_system/gallery/entries/buttons.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `button` | 14 | compact | `default` | Simple primary action; keep size and state comparisons in detail, reuse compact primary/outline/ghost overview. |
| `compact-button` | 3 | compact | `default` | Every registry variant is a 16-control matrix; CompactEntrySpecimen supplies four locally toggled appearance controls for overview. |
| `icon-button` | 4 | compact | `variants` | Five appearance controls are a useful small comparison; preserve accessible names. |
| `link-button` | 3 | compact | `variants` | Four treatments fit one wrapping row; avoid repeating a separate label for every token. |
| `social-button` | 3 | compact | `icon-only` | Filled/stroke icon row is compact; full provider-label grids belong in detail. |
| `fancy-button` | 2 | compact | `intents` | Four intent examples; show their actual colors without large chrome. |
| `button-group` | 4 | compact | `horizontal` | First variant is 15 groups across sizes/quantities; choose one horizontal working composition. |

### inputs — 36 entries

Source: `packages/core/src/modules/design_system/gallery/entries/inputs.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `marketing-controls` | 54 | fullwidth | `input-filled-medium` | First variant is a product image, not a control overview; 54 heterogeneous controls need grouped detail sections. |
| `label` | 7 | compact | `normal` | Actual label variants in a small block; contextual form example only in detail. |
| `hint-text` | 4 | compact | `default` | One hint and status comparison; avoid large minimum-height frames. |
| `file-upload` | 3 | fullwidth | `default` | Interactive drop zone needs natural height; default and drag-and-drop are identical renderers and should share one specimen. |
| `file-upload-card` | 3 | compact | `success` | Completed upload is stable initial specimen; progress and failure belong in explicit state controls. |
| `file-format-icon` | 18 | compact | `red-default` | 18 single-icon variants are color/size axes; use a compact comparison rather than 18 full cards. |
| `image-upload` | 9 | compact | `avatar-horizontal-uploaded` | Use a complete image/action composition; full empty/uploaded/kind matrix stays in detail. |
| `input` | 11 | compact | `default` | Source variants each mount full field matrices; default is one practical input. |
| `textarea` | 5 | compact | `default` | Single textarea initially; source-states mounts four field cards and should remain detail-only. |
| `phone-number-field` | 4 | fullwidth | `sizes` | Every existing variant renders three complete labeled fields; needs full width until a single-field specimen is supplied. |
| `select` | 7 | compact | `default` | Single basic trigger initially; other variants are multi-kind state matrices. |
| `dropdown` | 3 | compact | `small` | One actionable dropdown trigger, with populated content reachable by click. |
| `compact-select` | 2 | compact | `trigger-label` | Labeled sort trigger clearly communicates use. |
| `inline-select` | 2 | compact | `default` | One border-on-hover field with actual selected value. |
| `inline-input` | 2 | compact | `default` | One inline editable value, no empty canvas. |
| `checkbox` | 3 | compact | `states` | Unchecked/checked/indeterminate row is small and useful. |
| `checkbox-field` | 10 | compact | `default` | One labeled control initially; selection card palettes need full-width detail. |
| `radio` | 2 | compact | `group` | One mutually exclusive group; labels remain accessible. |
| `radio-field` | 10 | compact | `default` | Two labeled options initially; avoid starting with flipped-only variant. |
| `switch` | 2 | compact | `states` | Off/on pair; keep disabled states nearby only when inspecting. |
| `switch-field` | 14 | compact | `default` | One labeled switch; integration cards and source palettes need full-width detail. |
| `slider` | 5 | compact | `single` | A single working range input; source-ranges mounts 11 examples. |
| `form-field` | 4 | compact | `default` | One label/input/description composition demonstrates the relationship. |
| `search-input` | 3 | compact | `default` | Keep as a live specimen, visually distinct from catalogue search. |
| `email-input` | 3 | compact | `default` | One usable email control. |
| `password-input` | 4 | compact | `default` | One password visibility control; do not show every state simultaneously. |
| `password-strength` | 5 | compact | `interactive` | First empty state gives no meaningful visual; interactive example communicates validation as user types. |
| `website-input` | 3 | compact | `default` | One prefix-aware URL control. |
| `amount-input` | 3 | compact | `default` | One numeric amount and currency selection. |
| `counter-input` | 3 | compact | `default` | One increment/decrement specimen. |
| `digit-input` | 3 | compact | `default` | One verification-code composition; prevent fixed-width overflow on mobile. |
| `card-input` | 2 | compact | `brand-detected` | Populated brand detection is more informative than an empty field. |
| `button-input` | 2 | compact | `copy-link` | Current copy/send callbacks are missing; wire local feedback rather than implying working actions. |
| `color-picker` | 3 | compact | `opacity` | One picker with opacity demonstrates complete interaction; existing popup owns color controls. |
| `tag-input` | 2 | compact | `default` | Editable tags with local removal/addition. |
| `rich-editor` | 11 | fullwidth | `standard` | One real editor with readable toolbar and natural height; mount other editor instances only on selection. |

### dates — 4 entries

Source: `packages/core/src/modules/design_system/gallery/entries/dates.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `calendar` | 6 | compact | `single` | One month is readable; month-selectors contains four calendars and belongs in detail. |
| `date-picker` | 5 | compact | `default` | One trigger with working popover; no duplicate catalogue viewport controls. |
| `date-range-picker` | 4 | compact | `default` | One real range interaction; preserve popup room on mobile. |
| `time-picker` | 7 | compact | `inline-card` | First three variants show primitive matrices; inline-card shows a usable list at its intended height. |

### feedback — 12 entries

Source: `packages/core/src/modules/design_system/gallery/entries/feedback.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `banner` | 5 | fullwidth | `light` | Every registry variant renders five banners; CompactEntrySpecimen supplies one dismissible overview banner at natural full width. |
| `alert` | 8 | compact | `filled` | First source-xs renders four appearances × five states; CompactEntrySpecimen supplies one complete alert for overview. |
| `empty-state` | 4 | compact | `source-illustration` | Show the actual illustration/title composition, not an empty frame. |
| `empty-state-illustration` | 2 | dedicated asset browser | `hr` | 18 HR and 16 finance illustrations are asset collections; overview now uses one real illustration, while detail needs one full-width grouped browser. |
| `skeleton` | 3 | compact | `shapes` | Small shape comparison works as-is; do not confuse it with catalogue loading. |
| `progress` | 7 | compact | `labelled` | Labeled progress communicates purpose; quantity/circular matrices remain detail examples. |
| `spinner` | 2 | compact | `sizes` | Three sizes are sufficient; do not allocate a huge specimen area. |
| `rating` | 16 | compact | `interactive` | Use working rating over an initial read-only example; review cards need full-width detail. |
| `rating-bar` | 10 | compact | `emoji-selected` | One selected scale reads immediately; feedback-area/disabled render four compositions each. |
| `step-indicator` | 7 | fullwidth | `interactive` | Horizontal multistep composition requires width; quantity matrices are detail-only. |
| `notification` | 3 | compact | `information` | One complete notice; current action links are illustrative and need local feedback. |
| `notification-feed` | 5 | fullwidth | `default` | Feed owns its header/list/footer; keep one natural-height feed, not a clipped card inside a card. |

### overlays — 6 entries

Source: `packages/core/src/modules/design_system/gallery/entries/overlays.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `dialog` | 29 | compact | `default` | Trigger should open one real dialog; do not mount dozens of status/footer examples initially. |
| `drawer` | 12 | compact | `default` | Single trigger with real drawer interaction; footer/header matrix stays selectable in detail. |
| `sheet` | 2 | compact | `right` | Right-sheet trigger demonstrates overlay; page scroll must not trap its content. |
| `popover` | 6 | compact | `default` | First positions variant renders all placements; choose one contextual popover trigger. |
| `tooltip` | 9 | compact | `default` | First six variants mount eight-placement grids; a hover/focus trigger is a useful default. |
| `command-menu` | 4 | compact | `default` | Single working command trigger; browser-owned query and grouped results belong inside its overlay. |

### navigation — 10 entries

Source: `packages/core/src/modules/design_system/gallery/entries/navigation.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `prompt-area` | 6 | fullwidth | `desktop` | Desktop prompt is 700px wide with attachments/model/actions; keep full width and local submission feedback. |
| `ai-controls` | 10 | compact | `chat-buttons` | Chat controls give an immediate specimen; heterogeneous search/auth/settings groups need sectioned detail. |
| `ai-sidebar` | 4 | fullwidth | `collapsed` | Overview uses the actual collapsed state because expanded content remains tall even at natural height; full expanded shell stays available in details. |
| `ai-mobile-navigation` | 4 | compact | `default` | One mobile toolbar; preserve working menu and project actions within specimen. |
| `sidebar` | 19 | fullwidth | `items` | Items shows expanded/collapsed controls without the 900px product shell; full HR/finance examples only on selection. |
| `tabs` | 7 | compact | `underline` | One functional tab set and its content; large quantity matrices belong in detail. |
| `breadcrumb` | 4 | compact | `slash` | One contextual trail; demonstration hrefs should not scroll the catalogue unpredictably. |
| `pagination` | 6 | compact | `basic` | One working paginator; avoid presenting all source appearances as separate large canvases. |
| `segmented-control` | 6 | compact | `default` | One selected segmented control; no duplicate navigation strip above it. |
| `accordion` | 4 | fullwidth | `card` | Readable questions/content at full width with natural expansion height. |

### display — 16 entries

Source: `packages/core/src/modules/design_system/gallery/entries/display.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `content-label` | 11 | compact | `avatar-40` | Actual leading identity/text/trailing composition; size/type axes remain detail. |
| `content-card` | 7 | compact | `basic` | The component already owns a border; remove decorative outer card around its specimen. |
| `key-icon` | 2 | compact | `stroke` | All registry variants render nine colors × five sizes; CompactEntrySpecimen supplies five icons for overview, preserving full palette in detail. |
| `payment-icon` | 1 | fullwidth | `categories` | Eight labeled categories in four columns need full width; preserve labels beside real icons. |
| `chart-legend` | 2 | compact | `colors` | Wrapped color labels are useful; duplicate visible-series cards only when testing interactive behavior. |
| `chart-legend-dot` | 2 | compact | `size-16` | A wrapped dot/label row is enough. |
| `badge` | 11 | compact | `semantic` | Six status examples; appearance matrices and nine-color palettes belong in detail. |
| `status-badge` | 4 | compact | `with-dot` | Status labels must remain visible; token meanings are conveyed by both text and dots. |
| `tag` | 6 | compact | `variants` | One wrapping appearance row; removable example deserves local interaction. |
| `avatar` | 15 | compact | `variants` | Three representations give a compact specimen; nine-size stacks should not be initial view. |
| `kbd` | 2 | compact | `shortcut` | Show shortcut composition, avoiding huge empty space around keycaps. |
| `table` | 6 | fullwidth | `default` | Default order table is more useful than first header/cell matrix; allow horizontal scroll only inside table. |
| `card` | 2 | compact | `default` | Card is the visual specimen; remove duplicated outer frame and repeated headings. |
| `separator` | 12 | compact | `default` | Show divider between two meaningful lines; section/action matrices remain detail-only. |
| `scroll-area` | 9 | compact | `vertical` | Its intrinsic scrolling is meaningful; remove any extra catalogue scroll wrapper around it. |
| `activity-feed` | 5 | fullwidth | `basic` | Two complete events first; source-composition/attachments/comments need natural height. |

### charts — 9 entries

Source: `packages/core/src/modules/design_system/gallery/entries/charts.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `marketing-widgets` | 18 | fullwidth | `total-sales` | 18 complete widget designs; start with populated sales widget, group remaining by use, never mount all initially. |
| `finance-widgets` | 32 | fullwidth | `total-balance` | 32 populated/empty widget variants; initial stock tracker is large; use balance then explicit widget selection. |
| `hr-widgets` | 28 | fullwidth | `time-off` | 28 populated/empty widget variants; show one populated example at a time. |
| `kpi-card` | 4 | compact | `suffix-and-footer` | First trend-directions mounts three cards; one KPI with sparkline footer is a stronger compact specimen. |
| `sparkline` | 3 | compact | `semantic-color` | Small trend pair gives readable shape and semantic direction. |
| `bar-chart` | 3 | fullwidth | `basic` | Preserve axes/labels and chart height; never squash into a short scrolling card. |
| `line-chart` | 3 | fullwidth | `area` | Area chart gives visible series; preserve chart height, legend, and tooltip interaction. |
| `pie-chart` | 2 | compact | `donut` | One chart with legend at natural height; no clipped legend/footer. |
| `top-n-table` | 3 | fullwidth | `basic` | Column labels and ranking need width; empty state only by explicit selection. |

### filters — 9 entries

Source: `packages/core/src/modules/design_system/gallery/entries/filters.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `filter-toolbar` | 4 | fullwidth | `table` | Real toolbar plus filtered transaction table; nested panel controls must stay in specimen and work locally. |
| `filter-bar` | 3 | fullwidth | `stacked` | Search, facets, chips and applied state form a complete toolbar requiring width. |
| `quick-filters` | 2 | compact | `presets` | Compact preset row; current onApply is no-op and should show local selected/result state. |
| `active-filter-chips` | 3 | compact | `rule-chips` | Removable chips demonstrate local state without wrapper text. |
| `advanced-filter-builder` | 2 | fullwidth | `single-rule` | Field/operator/value rows need width; nested groups only on selection. |
| `filter-empty-state` | 2 | fullwidth | `default` | Empty-state and active filters form one composition; avoid a second generic empty-state frame. |
| `list-empty-state` | 2 | compact | `with-create-action` | One clear call to action; current create callback is no-op and should demonstrate a local action. |
| `filtered-empty-results` | 2 | compact | `filters-only` | Current clear actions are no-op; add local reset feedback, not a second search bar. |
| `search-empty-results` | 2 | compact | `default` | Sample query belongs in actual empty-result message; outer catalogue query stays separate. |

### detail — 6 entries

Source: `packages/core/src/modules/design_system/gallery/entries/detail.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `detail-fields-section` | 2 | fullwidth | `field-grid` | Multi-column field grid must have room for labels and values. |
| `loading-message` | 1 | compact | `default` | Single inline loading message; no large empty container. |
| `error-message` | 2 | compact | `with-description-action` | Error and recovery action provide context; retry currently needs local demo feedback. |
| `notes-section` | 1 | fullwidth | `mock-adapter` | Local adapter supports edits; preserve natural list/form height and modal interactions. |
| `addresses-section` | 1 | fullwidth | `mock-adapter` | Local address editor/list needs full width and natural height. |
| `attachments-section` | 1 | fullwidth | `unsaved-record` | Unsaved-record is only state available; no attachment is actually shown. Add a local fixture-backed example later. |

### scaffolding — 7 entries

Source: `packages/core/src/modules/design_system/gallery/entries/scaffolding.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `cryptocurrency` | 137 | fullwidth | `swap-1` | 137 heterogeneous variants; first token icon conceals entire swap/navigation system. Group by part, default to full swap composition. |
| `page` | 14 | fullwidth | `with-actions` | Actual page header/body/actions, without extra page chrome around the specimen. |
| `section-header` | 2 | fullwidth | `count-and-action` | A horizontal header/action relationship needs width, not a tiny tile. |
| `section-page` | 2 | fullwidth | `miniature` | Fixed: removed h-80 and overflow clipping, scoped natural height to the real SectionPage, and stacked its layout on narrow screens. |
| `form-header` | 2 | fullwidth | `edit-mode` | Back/title/actions require width; current hash links do not resolve to gallery entry anchors. |
| `form-footer` | 2 | fullwidth | `embedded-with-delete` | Use nonsticky embedded footer in catalogue; default may imply page-level position. |
| `actions-dropdown` | 2 | compact | `label-trigger` | Single action-menu trigger; item callbacks need local feedback to be demonstrably useful. |

### banners — 3 entries

Source: `packages/core/src/modules/design_system/gallery/entries/banners.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `flash-messages` | 1 | compact | `kinds` | Four trigger buttons are meaningful because flash emits real notices; no fake static toast screenshot. |
| `next-step-callout` | 3 | fullwidth | `with-steps` | One complete onboarding callout with progress steps; current action callback is no-op. |
| `context-help` | 3 | compact | `default-open` | Expanded initial help shows actual content; collapsed default otherwise looks like another navigation link. |

### notifications — 4 entries

Source: `packages/core/src/modules/design_system/gallery/entries/notifications.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `notification-bell` | 1 | compact | `presentational-mock` | Presentational bell only, no inbox opening; document or replace with local panel toggle. |
| `notification-count-badge` | 1 | compact | `counts` | Three counts show overflow behavior; bell clicks do not imply backend activity. |
| `notification-item` | 3 | compact | `with-body` | One complete notice body; mark-read/dismiss/action callbacks are no-op in this standalone entry. |
| `notification-panel` | 1 | fullwidth | `mocked-inbox` | Local inbox owns read/filter/actions; display at natural height with its own intrinsic scrolling only. |

### schedule — 4 entries

Source: `packages/core/src/modules/design_system/gallery/entries/schedule.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `schedule-view` | 2 | fullwidth | `week` | Complete week calendar with toolbar; fixed internal grid size must remain legible. |
| `schedule-toolbar` | 2 | fullwidth | `week-with-timezone` | Date range/view/timezone composition needs full width. |
| `schedule-grid` | 2 | fullwidth | `three-day-board` | Time axis and three columns need wide canvas; click callbacks currently no-op. |
| `schedule-agenda` | 2 | fullwidth | `two-days` | Two grouped days at natural height; avoid surrounding scrollbox. |

### messages — 3 entries

Source: `packages/core/src/modules/design_system/gallery/entries/messages.tsx`.

| Entry | Variants | Presentation | Representative | Finding / required treatment |
|---|---:|---|---|---|
| `email-threads-panel` | 4 | fullwidth | `conversations` | Browser found narrow-container metadata overflow. Fixed real component with container-based master/detail stacking, wrapping headers and address/date lines; compose/reply/refresh demos remain no-op. |
| `message-priority-selector` | 1 | compact | `interactive` | Small stateful selector with local value update. |
| `message-object-preview` | 2 | compact | `preview-data` | Provided fixture prevents API reads; real object summary fits a compact specimen. |

## Browser verification still required

Check the complete family route set, then the risky detail variants: asset browsers, source input/select matrices, key-icon palette, long tables, editor toolbar, filter-builder nested groups, page/sidebar specimens, all four schedule entries and the three widget bundles. At desktop and mobile widths verify: the page title and escape route remain visible; no duplicate catalogue nav; no outer horizontal overflow; only meaningful intrinsic scrollbars; labels and values fit; opening an overlay preserves focus and Escape; every claimed live action produces local visible feedback. Do not infer this validation from registry counts or successful static rendering.


## Implemented treatment and verification

All 18 native family routes were opened in the authenticated Open Mercato Settings shell. DOM geometry was checked for every component family at 390px; targeted screenshots covered icons/logos, buttons, inputs, charts, foundations, source inventory, component index and messages. This is overview coverage, not visual verification of all 939 registered variants.

The final presentation removes viewport controls everywhere, duplicate detail headers/import lines, duplicate overview navigation strips and nested asset browsers. Large examples use natural height and full available width. The sidebar gives details a sibling list and named return link; mobile navigation retains exits from deep foundation sections. The landing page has one pair of browse actions instead of repeated destination grids. Source inventory has one search and compact topic rows; full technical details remain optional.

Responsive QA found and corrected actual overflow in DigitInput, RichEditor, AI mobile navigation, Tabs, table previews and EmailThreadsPanel. The final repeat check reports no document overflow in Inputs, Dates, Navigation, Display or Messages at 390px. EmailThreadsPanel now uses its own container width for master/detail columns, wraps metadata and stacks on narrow screens. RichEditor confines its invisible measurement layer without clipping the visible toolbar. Tables retain their meaningful internal horizontal scrolling. TimePicker uses its supported maximum-width class. The source inventory search no longer shrinks vertically in its mobile column.

Verified interactions:

- Home “Browse components” opens the complete `?view=components` index.
- Button detail shows one H1, named family return and sibling navigation.
- Mobile foundation Color roles deep link retains the selector's Start/Components exits; Components returns to the full index.
- Icon search narrows the collection, a tile opens its named popover, and Copy JSX places the actual SourceIcon import/example in the clipboard. Switching to Logos shows the 439-resource collection.
- Table deep links retain the targeted example; Copy code puts that example in the clipboard.
- Cryptocurrency now renders all 137 examples; the variant picker was removed in the follow-up below.
- FileUploadArea `drag-and-drop` deep link remains usable, while its identical default appears only once in the detail page.

Validation runner: **local**. Core and UI typechecks passed; core and UI builds passed. **52 gallery tests** and **44 RichEditor tests** passed. Storybook generation/check reports **18 families, 150 entries, 939 variants in sync**. `git diff --check` passed. The integration spec was updated for the native navigation, absent viewport control, icon collections and actual clipboard assertions; its automated runner was not executed in this session. Equivalent targeted checks above were exercised through the browser.

Remaining boundary: some legacy detailed examples use intentionally inert callbacks, as recorded in finding 6. Overview cards deliberately behave as links with inert specimens; this audit does not claim every detailed variant is a complete working application workflow. No tenant services, commits, pushes, migrations or publication were used.


## Follow-up: translations and all variants (2026-09-13)

Component detail pages now show every available variant immediately, with localized captions and no variant dropdown. Existing variant URLs scroll to the corresponding example; overview specimens remain compact. Code disclosures mount their code only when expanded and retain per-example copying.

English, Polish, German, Spanish and Korean dictionaries cover every registered variant caption and 140 usage rules, as well as sample content and the source library's 84 topic names. Component identifiers and copied source code remain stable. Storybook uses the same translations and exposes a language toolbar.

Validation used the local runner: 54 gallery tests, core typecheck/build and Storybook build passed. Translation coverage loads the actual registry, including generated variants. Native browser checks confirmed all 14 Button variants in Polish, all 137 cryptocurrency examples without a selector, and translated source-library search.


## Navigation follow-up — 2026-09-13

Heuristic assessment of the supplied sidebar: 6/10, with a major orientation issue (other categories disappeared in detail) and minor hierarchy/icon issues (flat, identical item treatment). The implemented tree keeps every category reachable, nests plain component links, marks the current page, separates expansion from overview navigation, and provides the same structure on mobile. Reaching a full 10/10 requires confirming discoverability with actual users; the checks here are an expert review and functional verification.

Browser verification: expand Inputs with Enter while remaining on Button; navigate directly to Input and verify aria-current; open the tree at 390px, navigate to All components and verify it closes with no horizontal page overflow. Desktop screenshot confirms category chevrons fit within the sidebar. Local validation: 55 gallery tests across 14 suites, core typecheck and build passed.
