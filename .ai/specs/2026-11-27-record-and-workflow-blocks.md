# Record and workflow blocks

Status: in progress
Date: 2026-11-27
Related: `.ai/specs/2026-11-24-business-blocks-and-component-showcase.md` (block rules, contracts, showcase), `.ai/specs/2026-11-27-list-and-form-blocks.md`, `.ai/ds-rules.md` ("Frames: one level only", "Tables")

## TLDR

A survey of backend screens showed that the nine existing blocks cover layout, while the structures people build by hand most often have no block. This spec adds six blocks chosen by how often the structure is hand-built today: `section`, `record-list`, `stat-strip`, `decision-panel`, `comment-thread` and `stage-path`. Each is presentational, has a zod contract and ships with a showcase entry. Adoption on real screens follows per block.

## Problem

- Only two of the nine blocks are imported by a module. `key-value`, `entity-header` and `timeline` have no consumer outside the gallery.
- The same structures are rebuilt per module: about 448 hand-built framed sections in 202 files; about 31 short record lists with an Add button, row actions and their own loading, empty and error handling; about 26 hand-built figure tiles that bypass the shared `KpiCard` because it takes only a number, cannot be clicked and has no container for a row; seven approve / reject panels in six modules; about six comment lists with a composer; four stage strips that bypass the `StepIndicator` primitive.
- A builder, human or agent, has no vocabulary above layout: there is no part that means "the frame of a section", "a list of child records" or "a decision".

## Decisions

1. **Selection by evidence.** A block is added only when the structure is hand-built in several modules today. Structures seen once or twice are not blocks.
2. **`section` is the frame.** A detail or settings screen is a stack of sections; everything inside a section is unframed. The other five blocks take `variant="plain"` when they sit inside a section and `variant="card"` when they stand alone.
3. **Existing shared components are not changed.** `KpiCard`, `StepIndicator`, `NotesSection` and `SectionHeader` keep their behaviour. The blocks are self-contained, as the import boundary requires.
4. **Preformatted values.** `stat-strip` takes values as strings; the host formats numbers, money and durations.
5. **Confirmation inside `decision-panel` is inline.** The shared confirm dialog lives outside the paths a block may import, so a decision that needs confirmation shows a second step in place.
6. **Not blocks:** a status change bar (it is `entity-header` with a badge and actions), a line items table (columns differ too much between modules), a permission matrix and a calendar.
7. **Screen archetypes.** Record detail: `entity-header`, `stat-strip`, then sections holding `key-value`, `record-list`, `comment-thread`, `timeline` or `decision-panel`. List: `entity-header`, `stat-strip`, `list-toolbar`, `DataTable`, `bulk-action-bar`. Settings: sections with controls and `form-save-bar`.

## Contracts

All extend the shared base props (`status`, `errorMessage`, `onRetry`, `emptyState`, `className`). Events are callbacks, slots are React nodes. The zod schemas in `packages/ui/src/blocks/contracts/` are the source of truth; the list below names the shape.

### `section`

- **Input:** `title`, `description?`, `icon?`, `count?`, `headingLevel?`, `actions?`, `maxVisibleActions?`, `variant?: 'card' | 'plain'`, `tone?: 'neutral' | 'error'`, `padding?: 'default' | 'none'`, `collapsible?`, `defaultCollapsed?`, `collapsed?`.
- **Events:** `onAction(actionKey)`, `onCollapsedChange(collapsed)`.
- **Slots:** `children`, `footer`, `headerTrailing`.
- **State ownership:** the host owns the content and runs actions. The block owns the overflow menu, pending while a returned promise is unresolved and the collapsed state when uncontrolled.

### `record-list`

- **Input:** `items: { id, title, href?, icon?, avatarLabel?, badge?, subtitle?, meta?, trailing?, actions?, disabled? }[]`, `title?` or `ariaLabel?`, `count?`, `addAction?`, `layout?: 'rows' | 'cards'`, `density?`, `variant?`, `maxItems?`, `showAllLabel?`, `emptyTitle?`, `emptyDescription?`.
- **Events:** `onAdd()`, `onItemClick(itemId)`, `onItemAction(itemId, actionKey)`, `onShowAll()`.
- **Slots:** `renderItem(item)`, `emptyState`.
- **State ownership:** the host owns the records and their loading. The block owns which action is inline, the menus, in-place expansion when `onShowAll` is absent and pending per action.

### `stat-strip`

- **Input:** `items: { id, label, value, caption?, icon?, delta?: { direction, label, sentiment? }, badge?, tone?, href?, disabled? }[]`, `selectedId?`, `columns?`, `variant?`, `size?`, `align?`, `ariaLabel?`, `skeletonCount?`.
- **Events:** `onItemClick(itemId)`.
- **State ownership:** the host owns the figures, their formatting and what a click filters. The block owns the column count from its own width.

### `decision-panel`

- **Input:** `state: 'pending' | 'submitting' | 'decided'`, `title`, `description?`, `decisions: { id, label, tone?, icon?, disabled?, disabledReason?, commentRequired?, confirm? }[]` (one to four), `commentMode?: 'none' | 'optional' | 'required'`, `comment?`, `decided?: { decisionId?, label, tone?, by?, at?, comment? }`, `disabledReason?`, `submittingDecisionId?`, `variant?`, `layout?`.
- **Events:** `onDecide(decisionId, comment?)`, `onCommentChange(value)`, `onUndo()`.
- **Slots:** `children` (the item under decision), `footer`.
- **State ownership:** the host owns the record, who may decide and the outcome. The block owns the comment draft when uncontrolled, comment validation, the inline confirmation step and pending while a returned promise is unresolved.

### `comment-thread`

- **Input:** `comments: { id, author, body, createdAt, editedAt?, visibility?, own?, pending?, failed?, actions? }[]`, `order?`, `canComment?`, `composerDisabledReason?`, `value?`, `maxLength?`, `visibilityOptions?: { value, label, description?, tone? }[]`, `visibility?`, `defaultVisibility?`, `posting?`, `postErrorMessage?`, `hasEarlier?`, `loadingEarlier?`, `title?`, `count?`, `variant?`.
- **Events:** `onPost(body, visibility?)`, `onValueChange(value)`, `onVisibilityChange(value)`, `onCommentAction(commentId, actionKey)`, `onRetryComment(commentId)`, `onLoadEarlier()`.
- **Slots:** `composerExtras`, `renderBody(comment)`, `emptyState`.
- **State ownership:** the host owns the comments and persistence. The block owns the draft when uncontrolled, pending while posting and the announcement of new comments.
- **Out of scope:** replies, mentions, a composer without a list.

### `stage-path`

- **Input:** `stages: { id, label, description?, icon?, disabled?, disabledReason?, meta? }[]` (at least two), `currentStageId`, `completedStageIds?`, `outcome?: { label, tone, description? }`, `pendingStageId?`, `readOnly?`, `orientation?`, `size?`, `overflow?: 'scroll' | 'collapse'`, `variant?`, `ariaLabel?`.
- **Events:** `onStageSelect(stageId)`.
- **State ownership:** the host owns the process definition, the current stage and what a move does. The block owns the derived state per stage, the roving focus, pending per stage and the collapsed or scrolled layout from its own width.

## Backward compatibility

Additive only. New import paths `@open-mercato/ui/blocks/section`, `/record-list`, `/stat-strip`, `/decision-panel`, `/comment-thread`, `/stage-path` and their contracts under `@open-mercato/ui/blocks/contracts/`. No existing block, primitive, prop, slot, event, `data-slot`, API route or database object changes.

## Integration coverage

No API paths change. Coverage in this change is unit and gallery level: contract tests and component tests per block, gallery render and translation coverage, inventory parity. Integration coverage is added with each screen that adopts a block.

## Risks

- **Contract fit.** The earlier blocks needed additions once they met real screens. Each of these was shaped against named screens, and gaps found there are listed in the changelog rather than hidden.
- **Warning tone.** The warning status tokens read brownish in dark mode on large text. Examples avoid the tone; the tokens themselves are a separate decision.
- **Two ways to do one thing.** `stat-strip` and `KpiCard`, `stage-path` and `StepIndicator`, `comment-thread` and `NotesSection` now overlap. The showcase usage text says when to use which; converging them is later work.

## Changelog

- 2026-11-27: Spec written; six blocks built with contracts, tests and showcase entries. Known contract gaps from the first fit against real screens: `record-list` has one badge per item and no description line; `stat-strip` cannot mark only some tiles as clickable and has no per-tile action; `comment-thread` has no replies, mentions or composer-only mode; `decision-panel` allows at most four decisions.
- 2026-11-27: Visual and interaction pass on all six blocks after a design review. `stat-strip`: change chip, optional `trend` sparkline, per-item `interactive` and `action` with `onItemAction`, selected tile as a filled cell with an accent bar, tone shown as a dot or tinted icon and never on the figure, `align` removed. `stage-path`: segmented bar as the default horizontal appearance (`appearance: 'bar' | 'markers'`), one summary line for the current stage, a closed record restyles the whole bar, outcome tone `warning` removed. `decision-panel`: `requester`, `requestedAt`, `statusLabel` and `highlight`, decisions in a footer bar with the primary last, the outcome as a tinted banner that replaces the header chip. `comment-thread`: non-default visibility as a tinted bubble, one-field composer with the visibility menu and Post inside it, `currentUser`, `groupConsecutive`, per-option `icon`, short relative time. `record-list`: status as a dot with text, leading visual only when given, actions and chevron on hover and focus, `description`, `badges`, `avatarUrl`, `emptyIcon`, `skeleton`. `section`: quiet header actions, `layout: 'split'` for settings, `divider`, `summary`, `footerNote`, `emptyTitle`, `emptyDescription`. Two of the gaps listed above are closed (`record-list` badges and description, `stat-strip` mixed clickable tiles and a per-tile action).
