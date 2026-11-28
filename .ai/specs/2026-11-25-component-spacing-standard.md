# Component spacing standard

Status: approved 2026-11-25, primitives and blocks aligned; backend components and modules next
Date: 2026-11-25
Related: `.ai/specs/2026-11-24-business-blocks-and-component-showcase.md` (spacing roles), `.ai/ds-rules.md` § Spacing, `.ai/reports/2026-11-25-spacing-audit.md`

## TLDR

One table of inner padding, heights and gaps for every component class, on a strict 4 px grid, anchored to IBM Carbon and cross-checked with Ant Design and Atlassian. Values are written as spacing roles where a role exists, otherwise as the 4 px scale. Every primitive is then reviewed against this table, family by family, with before and after screenshots.

## Reference systems

- **IBM Carbon** (primary): the most complete published per-component spacing, with a Style tab per component and form rhythm. https://carbondesignsystem.com/elements/spacing/overview/ and `/components/<name>/style/`.
- **Ant Design** (density cross-check): component tokens on a 4 px base with 24 / 32 / 40 control heights, closest to our product density. https://ant.design/docs/react/customize-theme and component token tables.
- **Atlassian** (sanity check): spacing tokens on an 8 px base; component values come from compiled CSS, not stated standards. https://atlassian.design/foundations/spacing.

Where they disagree we follow Carbon's steps and Ant's density, and round to the 4 px grid. Ant's border-subtracted values (15, 11, 7, 5) and Atlassian's 6 / 2 are not copied.

## Principles

1. Everything sits on the 4 px grid. No half steps (2, 6, 10, 14 px) for padding, margin or gap, inside controls too. Borders sit inside the box.
2. Height drives vertical padding for controls and rows: a control or row has a fixed height and centres its content, so vertical padding is never set by hand.
3. Inner padding grows with the container: control 8 to 12, panel 16, card and dialog 24, page 16 to 24.
4. Related things sit closer than unrelated things: label to field 8, field to field 24, group to group 40, section to section 32 on a page.
5. Compact density is one scope (`data-density="compact"` or `DesignScope density="compact"`), never hand-picked smaller values.

## Standard

Columns: **OM** is the standard; **Today** is what our primitive does now; **Carbon** and **Ant** are the references.

### Controls

| Component | OM | Today | Carbon | Ant |
| --- | --- | --- | --- | --- |
| Button height sm / md / lg | 32 / 36 / 40 | 32 / 36 / 40 | 32 / 40 / 48 | 24 / 32 / 40 |
| Button horizontal padding sm / md / lg | 12 / 16 / 20 | 12 / 16 / 24 | 16 | 7 / 15 / 15 |
| Button side with a leading icon | padding minus 4 | 10 / 12 / 16 | 16 | n/d |
| Button icon gap sm / md / lg | 4 / 8 / 8 | 6 / 8 / 8 | 8 (ghost) to 16 | 8 |
| Gap between buttons | 8 | mixed 8 to 12 | 16 | 8 |
| Input / select height sm / md / lg | 32 / 36 / 40 | 32 / 36 / 40 | 32 / 40 / 48 | 24 / 32 / 40 |
| Input horizontal padding sm / md / lg | 8 / 12 / 12 (`px-control-x`) | 10 / 12 / 12, source sizes 8 to 10 | 16 | 7 / 11 / 11 |
| Input inner gap (icon, prefix) | 8 | 6 / 8 | n/d | n/d |
| Checkbox / radio to label | 8 | 8 | 8 | 8 |
| Stacked checkbox / radio options | 8 | mixed | 4 / 8 | 8 |

### Forms

| Rhythm | OM | Today | Carbon | Ant |
| --- | --- | --- | --- | --- |
| Label to field | 8 (`field-label`) | 8 | 8 | 8 |
| Field to hint or error | 8 (`field-hint`) | 8 | 4 | n/d |
| Field to field | 24 (`field-stack`) | 24 | 32 | 24 |
| Form section title to first field | 16 | mixed | 40 | n/d |
| Field group to field group | 40 (`group`) | 40 | 40 | n/d |
| Last field to form actions | 32 (`section`) | mixed | 48 | n/d |

### Overlays

| Component | OM | Today | Carbon | Ant | Atlassian |
| --- | --- | --- | --- | --- | --- |
| Menu container padding | 4 | 4 | n/d | 4 | n/d |
| Menu item height | 32 | 32 to 36 | 32 / 40 | 32 / 40 | 32 / 40 |
| Menu item horizontal padding | 8 | 8 | 16 | 12 to 16 | 12 to 16 |
| Menu item icon gap | 8 | 8 | n/d | 10 | 8 / 12 |
| Menu separator margin | 4 | 4 | 4 | n/d | n/d |
| Menu section label | 8 sides, 8 top, 4 bottom | 8 / 8 / 4 | n/d | n/d | 8 / 20 / 6 |
| Popover padding | 16 (`panel`) | 0 to 16 | 16 | 12 | n/d |
| Tooltip padding sm / md | 4 × 8 / 8 × 12 | 2 × 6 / 4 × 10 | 16 | 6 × 8 | 4 × 6 |
| Dialog padding | 24 (`dialog`) | 24 | 16 | 24 | 24 |
| Dialog header to body / body to footer | 16 / 24 | 16 / 16 | 16 / 48 | 8 / 12 | 16 / 16 |
| Dialog footer button gap | 8 | 8 | full bleed | 8 | 8 |

### Surfaces and feedback

| Component | OM | Today | Carbon | Ant | Atlassian |
| --- | --- | --- | --- | --- | --- |
| Card padding | 24 (`card`), compact 16 | 24 | 16 | 24 / 12 | n/d |
| Section inside a page or form | 16 (`panel`) | 16 | n/d | n/d | n/d |
| Alert default padding | 16 | 14 | 12 vertical, 48 min height | 12 × 8, 24 × 20 with text | 16 |
| Alert sm / xs | 12 × 8 / 8 × 4 | 10 × 8 / 8 × 6 | n/d | n/d | n/d |
| Alert icon gap | 12 | 12 | 16 | n/d | n/d |
| Toast padding | 16 | mixed | 16 | 24 × 20 | n/d |
| Tag / badge height md / sm | 24 / 20 | 22 / 16 | 24 / 18 | about 20 | n/d |
| Tag / badge horizontal padding | 8 | 8 to 10 | 8 / 12 | 7 | n/d |
| Empty state and Result padding | 24 sides, 48 vertical; compact 16 / 24 | 16 to 24 | n/d | n/d | n/d |

### Data and navigation

| Component | OM | Today | Carbon | Ant | Atlassian |
| --- | --- | --- | --- | --- | --- |
| Table row height compact / default / comfortable | 32 / 40 / 48 | about 36 | 32 / 40 / 48 | 39 / 47 / 55 | n/d |
| Table cell horizontal padding | 16 | 16 | 16 | 16 / 12 / 8 | 8 |
| Table header height | same as rows | about 36 | n/d | n/d | n/d |
| Tabs height | 36 pill / 40 underline | 36 / 40 | 40 / 48 | n/d | n/d |
| Tab horizontal padding | 12 | 12 | 16 | 16 (card) | 8 |
| Gap between underline tabs | 16 | 16 | 1 | 32 | n/d |
| Tab bar to content | 16 | mixed | n/d | 16 | n/d |
| Toolbar padding and gap | 8 padding, 8 gap | 2 to 8 | n/d | n/d | n/d |

### Layout

| Rhythm | OM | Today | Carbon | Ant |
| --- | --- | --- | --- | --- |
| Page margin | 16, 24 from 640 px (`page`) | 16 / 24 | 0 to 24 | n/d |
| Grid gutter | 16, 24 from 640 px (`gutter`) | 16 / 24 | 16 narrow, 32 wide | 16 + 8n |
| Section to section | 32 (`section`) | 32 | from the scale | n/d |

## Deviations from Carbon, and why

- Control heights 32 / 36 / 40 instead of 32 / 40 / 48: back-office density; matches Ant and our Figma library.
- Input padding 12 instead of 16: 36 px fields with 14 px text read better at 12; Ant uses 11.
- Field to field 24 instead of 32: denser forms; matches Ant.
- Dialog padding 24 instead of 16: matches Ant and Atlassian; our dialogs carry forms.
- Menu item padding 8 instead of 16: our menus are narrower and carry icons and shortcuts.

## Rollout

1. Approve this table.
2. Copy the standard into `.ai/ds-rules.md` § Spacing and `.ai/ui-components.md` per component.
3. Review and fix family by family, highest traffic first: buttons and inputs, select and menus, cards and dialogs, alerts, badges and tags, tables, tabs and navigation, then the rest. Before and after screenshots per family for approval.
4. Guard: a DS lint rule that rejects half-step and arbitrary spacing in `packages/ui/src/primitives` and `packages/ui/src/blocks`; the visual audit script stays for overflow and clipping.

## Changelog

- 2026-11-25: Draft written from Carbon, Ant and Atlassian references.
- 2026-11-25: Approved. Family 1 (buttons, inputs, select triggers) aligned.
- 2026-11-25: Family 2 (select lists, command menu, dropdown, popover, tooltip) aligned. PopoverContent keeps p-0 by contract (28 call sites rely on it); content compositions use `p-panel`.
- 2026-11-25: Family 3 (alert, badge, tag, dialog) aligned; card already matched (24).
- 2026-11-25: Family 4 (table with `size` compact / default / comfortable, tabs, breadcrumb, segmented control on a 36 / 32 px track, step indicator, accordion) aligned.
- 2026-11-25: Family 5: the remaining 30 primitives rounded up to the 4 px grid (84 values), rich editor arbitrary pixels removed. `om-ds/no-off-grid-spacing` guards primitives and blocks at `error`; three geometry exceptions are marked per line.
