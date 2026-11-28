# Component spacing standard

Status: approved 2026-11-25, primitives and blocks aligned; backend components and modules next
Date: 2026-11-25
Related: `.ai/specs/2026-11-24-business-blocks-and-component-showcase.md` (spacing roles), `.ai/ds-rules.md` § Spacing, `.ai/reports/2026-11-25-spacing-audit.md`

## TLDR

One table of inner padding, heights and gaps for every component class, on a strict 4 px grid. Values are written as spacing roles where a role exists, otherwise as the 4 px scale. Every primitive is then reviewed against this table, family by family, with before and after screenshots.

## Principles

1. Everything sits on the 4 px grid. No half steps (2, 6, 10, 14 px) for padding, margin or gap, inside controls too. Borders sit inside the box.
2. Height drives vertical padding for controls and rows: a control or row has a fixed height and centres its content, so vertical padding is never set by hand.
3. Inner padding grows with the container: control 8 to 12, panel 16, card and dialog 24, page 16 to 24.
4. Related things sit closer than unrelated things: label to field 8, field to field 24, group to group 40, section to section 32 on a page.
5. Compact density is one scope (`data-density="compact"` or `DesignScope density="compact"`), never hand-picked smaller values.

## Standard

Columns: **OM** is the standard; **Today** is what our primitive did before the alignment.

### Controls

| Component | OM | Today |
| --- | --- | --- |
| Button height sm / md / lg | 32 / 36 / 40 | 32 / 36 / 40 |
| Button horizontal padding sm / md / lg | 12 / 16 / 20 | 12 / 16 / 24 |
| Button side with a leading icon | padding minus 4 | 10 / 12 / 16 |
| Button icon gap sm / md / lg | 4 / 8 / 8 | 6 / 8 / 8 |
| Gap between buttons | 8 | mixed 8 to 12 |
| Input / select height sm / md / lg | 32 / 36 / 40 | 32 / 36 / 40 |
| Input horizontal padding sm / md / lg | 8 / 12 / 12 (`px-control-x`) | 10 / 12 / 12, source sizes 8 to 10 |
| Input inner gap (icon, prefix) | 8 | 6 / 8 |
| Checkbox / radio to label | 8 | 8 |
| Stacked checkbox / radio options | 8 | mixed |

### Forms

| Rhythm | OM | Today |
| --- | --- | --- |
| Label to field | 8 (`field-label`) | 8 |
| Field to hint or error | 8 (`field-hint`) | 8 |
| Field to field | 24 (`field-stack`) | 24 |
| Form section title to first field | 16 | mixed |
| Field group to field group | 40 (`group`) | 40 |
| Last field to form actions | 32 (`section`) | mixed |

### Overlays

| Component | OM | Today |
| --- | --- | --- |
| Menu container padding | 4 | 4 |
| Menu item height | 32 | 32 to 36 |
| Menu item horizontal padding | 8 | 8 |
| Menu item icon gap | 8 | 8 |
| Menu separator margin | 4 | 4 |
| Menu section label | 8 sides, 8 top, 4 bottom | 8 / 8 / 4 |
| Popover padding | 16 (`panel`) | 0 to 16 |
| Tooltip padding sm / md | 4 × 8 / 8 × 12 | 2 × 6 / 4 × 10 |
| Dialog padding | 24 (`dialog`) | 24 |
| Dialog header to body / body to footer | 16 / 24 | 16 / 16 |
| Dialog footer button gap | 8 | 8 |

### Surfaces and feedback

| Component | OM | Today |
| --- | --- | --- |
| Card padding | 24 (`card`), compact 16 | 24 |
| Section inside a page or form | 16 (`panel`) | 16 |
| Alert default padding | 16 | 14 |
| Alert sm / xs | 12 × 8 / 8 × 4 | 10 × 8 / 8 × 6 |
| Alert icon gap | 12 | 12 |
| Toast padding | 16 | mixed |
| Tag / badge height md / sm | 24 / 20 | 22 / 16 |
| Tag / badge horizontal padding | 8 | 8 to 10 |
| Empty state and Result padding | 24 sides, 48 vertical; compact 16 / 24 | 16 to 24 |

### Data and navigation

| Component | OM | Today |
| --- | --- | --- |
| Table row height compact / default / comfortable | 32 / 40 / 48 | about 36 |
| Table cell horizontal padding | 16 | 16 |
| Table header height | same as rows | about 36 |
| Tabs height | 36 pill / 40 underline | 36 / 40 |
| Tab horizontal padding | 12 | 12 |
| Gap between underline tabs | 16 | 16 |
| Tab bar to content | 16 | mixed |
| Toolbar padding and gap | 8 padding, 8 gap | 2 to 8 |

### Layout

| Rhythm | OM | Today |
| --- | --- | --- |
| Page margin | 16, 24 from 640 px (`page`) | 16 / 24 |
| Grid gutter | 16, 24 from 640 px (`gutter`) | 16 / 24 |
| Section to section | 32 (`section`) | 32 |

## Rationale for the key values

- Control heights 32 / 36 / 40: back-office density, and the sizes our Figma library already uses.
- Input padding 12: 36 px fields with 14 px text read better at 12 than at 16.
- Field to field 24: dense forms that still separate fields clearly.
- Dialog padding 24: our dialogs carry forms and need the room.
- Menu item padding 8: our menus are narrow and carry icons and shortcuts.

## Rollout

1. Approve this table.
2. Copy the standard into `.ai/ds-rules.md` § Spacing and `.ai/ui-components.md` per component.
3. Review and fix family by family, highest traffic first: buttons and inputs, select and menus, cards and dialogs, alerts, badges and tags, tables, tabs and navigation, then the rest. Before and after screenshots per family for approval.
4. Guard: a DS lint rule that rejects half-step and arbitrary spacing in `packages/ui/src/primitives` and `packages/ui/src/blocks`; the visual audit script stays for overflow and clipping.

## Changelog

- 2026-11-25: Draft written.
- 2026-11-25: Approved. Family 1 (buttons, inputs, select triggers) aligned.
- 2026-11-25: Family 2 (select lists, command menu, dropdown, popover, tooltip) aligned. PopoverContent keeps p-0 by contract (28 call sites rely on it); content compositions use `p-panel`.
- 2026-11-25: Family 3 (alert, badge, tag, dialog) aligned; card already matched (24).
- 2026-11-25: Family 4 (table with `size` compact / default / comfortable, tabs, breadcrumb, segmented control on a 36 / 32 px track, step indicator, accordion) aligned.
- 2026-11-25: Family 5: the remaining 30 primitives rounded up to the 4 px grid (84 values), rich editor arbitrary pixels removed. `om-ds/no-off-grid-spacing` guards primitives and blocks at `error`; three geometry exceptions are marked per line.
