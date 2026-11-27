# L. Structural Lint Rules

> ESLint v9 flat config plugin — 7 rules, configuration, CI integration.

---

> **STATUS: IMPLEMENTED (2026-07-05).** The plugin ships as the workspace `@open-mercato/eslint-plugin-ds` (`packages/eslint-plugin-ds/`), wired via the dedicated `eslint.ds.config.mjs` and run with `yarn lint:ds`. It is separate from `yarn lint` because `turbo run lint` only lints `apps/mercato` — the six structural rules target `packages/{core,enterprise}/src/modules/**/backend/**` and `packages/ui/src/backend/**`; the seventh rule (`no-legacy-alert-variant`, added 2026-07-20) alone scopes wider (`packages/*/src/**/*.tsx` + `apps/*/src/**/*.tsx`), and `yarn lint:ds` accordingly scans `packages apps`. All rules currently run at `warn` (rollout baseline 2026-07-05: 231 findings for the six structural rules; the Alert rule entered at 0 after the migration campaign). Rule tests: `yarn workspace @open-mercato/eslint-plugin-ds test`. The pseudo-implementations below are the original design sketches; the shipped code hardens them (page-file scoping, `emptyState` prop detection, variant-prefix handling in color checks).
>
> **CI + escalation (2026-07-20).** The advisory `ds-lint` job in `.github/workflows/ci.yml` reports per-rule counts and the delta vs the base branch on every PR (`scripts/ci/ds-lint-report.mjs`). A rule flips from `warn` to `error` per module via the escalation override block in `eslint.ds.config.mjs` once the module's counter reads zero in two consecutive runs of the rolling report — the current `.ai/reports/ds-health-latest.txt` and the previous committed revision of that same file (`git show "$(git log -2 --format=%H -- .ai/reports/ds-health-latest.txt | tail -1):.ai/reports/ds-health-latest.txt"`); per-line opt-outs (`// eslint-disable-next-line om-ds/<rule> -- <reason>`, reason mandatory) are available and counted by the health check. See `.ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md` for the full policy.

Seven ESLint rules for enforcing the design system. The project uses ESLint v9 flat config. Rules are implemented as the custom plugin `@open-mercato/eslint-plugin-ds`.

### L.0 Deployment Strategy

```
eslint-plugin-open-mercato-ds/
├── index.ts                    — plugin entry, exports rules + recommended config
├── rules/
│   ├── require-empty-state.ts
│   ├── require-page-wrapper.ts
│   ├── no-raw-table.ts
│   ├── require-loading-state.ts
│   ├── require-status-badge.ts
│   └── no-hardcoded-status-colors.ts
└── utils/
    └── ast-helpers.ts          — shared AST selectors
```

Add to `eslint.config.mjs`:

```js
import omDs from './eslint-plugin-open-mercato-ds/index.js'

export default [
  // ... existing config
  {
    plugins: { 'om-ds': omDs },
    files: ['packages/core/src/modules/**/backend/**/*.tsx'],
    rules: {
      'om-ds/require-empty-state': 'warn',      // warn -> error after migration
      'om-ds/require-page-wrapper': 'error',
      'om-ds/no-raw-table': 'error',
      'om-ds/require-loading-state': 'warn',
      'om-ds/require-status-badge': 'warn',
      'om-ds/no-hardcoded-status-colors': 'error',
    },
  },
]
```

**Rollout plan**: All rules start as `warn` on existing code. New modules get a full `error` override block in the same PR that scaffolds them (no baseline debt — see the escalation spec). A rule flips to `error` per module (escalation override block in `eslint.ds.config.mjs`) once the module's counter is zero in two consecutive runs of `.ai/reports/ds-health-latest.txt` (the current file and its previous committed revision); when every module is at zero, the per-module entries are deleted and the rule flips to `error` in `configs.recommended` — the terminal state.

### L.1 `om-ds/require-empty-state`

**Goal**: Every page with a DataTable must include an EmptyState.

```ts
// rules/require-empty-state.ts — pseudo-implementation
import type { Rule } from 'eslint'

export const requireEmptyState: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require EmptyState component in pages that use DataTable',
    },
    messages: {
      missingEmptyState:
        'Pages with DataTable must include an EmptyState component for the zero-data case. ' +
        'Import EmptyState from @open-mercato/ui/backend/EmptyState.',
    },
    schema: [],
  },
  create(context) {
    let hasDataTable = false
    let hasEmptyState = false

    return {
      // Look for a DataTable import
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source === 'string' && source.includes('DataTable')) {
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'DataTable') {
              hasDataTable = true
            }
          }
        }
        if (typeof source === 'string' && source.includes('EmptyState')) {
          hasEmptyState = true
        }
      },
      // Look for <EmptyState usage in JSX
      JSXIdentifier(node: any) {
        if (node.name === 'EmptyState') {
          hasEmptyState = true
        }
      },
      'Program:exit'(node) {
        if (hasDataTable && !hasEmptyState) {
          context.report({ node, messageId: 'missingEmptyState' })
        }
      },
    }
  },
}
```

### L.2 `om-ds/require-page-wrapper`

**Goal**: Backend pages must use `<Page>` + `<PageBody>` as a wrapper.

```ts
// rules/require-page-wrapper.ts — pseudo-implementation
export const requirePageWrapper: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require Page and PageBody wrappers in backend pages',
    },
    messages: {
      missingPage: 'Backend pages must wrap content in <Page><PageBody>...</PageBody></Page>. ' +
        'Import from @open-mercato/ui/backend/Page.',
      missingPageBody: 'Found <Page> without <PageBody> child.',
    },
    schema: [],
  },
  create(context) {
    let hasPageImport = false
    let hasPageBodyImport = false
    let hasPageJSX = false
    let hasPageBodyJSX = false

    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source === 'string' && source.includes('/Page')) {
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier') {
              if (spec.imported.name === 'Page') hasPageImport = true
              if (spec.imported.name === 'PageBody') hasPageBodyImport = true
            }
          }
        }
      },
      JSXIdentifier(node: any) {
        if (node.name === 'Page') hasPageJSX = true
        if (node.name === 'PageBody') hasPageBodyJSX = true
      },
      'Program:exit'(node) {
        // Only files in backend/ with a default export (page components)
        const filename = context.filename ?? context.getFilename()
        if (!filename.includes('/backend/')) return

        const hasDefaultExport = node.body.some(
          (n: any) => n.type === 'ExportDefaultDeclaration' ||
            (n.type === 'ExportNamedDeclaration' && n.declaration?.declarations?.[0]?.id?.name === 'default'),
        )
        if (!hasDefaultExport) return

        if (!hasPageJSX) {
          context.report({ node, messageId: 'missingPage' })
        } else if (!hasPageBodyJSX) {
          context.report({ node, messageId: 'missingPageBody' })
        }
      },
    }
  },
}
```

### L.3 `om-ds/no-raw-table`

**Goal**: Prohibit direct use of `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>`, `<th>` in backend pages. Enforce DataTable or primitives/table.

```ts
// rules/no-raw-table.ts — pseudo-implementation
const RAW_TABLE_ELEMENTS = ['table', 'thead', 'tbody', 'tr', 'td', 'th']

export const noRawTable: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw HTML table elements in backend pages',
    },
    messages: {
      noRawTable:
        'Do not use raw <{{element}}> in backend pages. ' +
        'Use DataTable from @open-mercato/ui/backend/DataTable or ' +
        'Table primitives from @open-mercato/ui/primitives/table.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node: any) {
        const filename = context.filename ?? context.getFilename()
        if (!filename.includes('/backend/')) return

        if (node.name.type === 'JSXIdentifier' && RAW_TABLE_ELEMENTS.includes(node.name.name)) {
          context.report({
            node,
            messageId: 'noRawTable',
            data: { element: node.name.name },
          })
        }
      },
    }
  },
}
```

### L.4 `om-ds/require-loading-state`

**Goal**: Pages with asynchronous data fetching must include LoadingMessage or pass `isLoading` to DataTable.

```ts
// rules/require-loading-state.ts — pseudo-implementation
export const requireLoadingState: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require explicit loading state handling in pages with async data',
    },
    messages: {
      missingLoadingState:
        'Pages using apiCall() must handle loading state. ' +
        'Use LoadingMessage from @open-mercato/ui/backend/detail ' +
        'or pass isLoading prop to DataTable.',
    },
    schema: [],
  },
  create(context) {
    let hasApiCall = false
    let hasLoadingMessage = false
    let hasIsLoadingProp = false
    let hasSpinner = false

    return {
      CallExpression(node: any) {
        if (node.callee.name === 'apiCall' || node.callee.name === 'apiCallOrThrow') {
          hasApiCall = true
        }
      },
      JSXIdentifier(node: any) {
        if (node.name === 'LoadingMessage') hasLoadingMessage = true
        if (node.name === 'Spinner') hasSpinner = true
      },
      JSXAttribute(node: any) {
        if (node.name?.name === 'isLoading') hasIsLoadingProp = true
      },
      'Program:exit'(node) {
        if (hasApiCall && !hasLoadingMessage && !hasIsLoadingProp && !hasSpinner) {
          context.report({ node, messageId: 'missingLoadingState' })
        }
      },
    }
  },
}
```

### L.5 `om-ds/require-status-badge`

**Goal**: Statuses (active/inactive, draft/published, etc.) must use StatusBadge, not raw text or a custom `<span>`.

```ts
// rules/require-status-badge.ts — pseudo-implementation
// Heuristic: look for DataTable columns with an accessorKey containing 'status'
// that do not render StatusBadge in the cell renderer

export const requireStatusBadge: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require StatusBadge for status-like columns in DataTable',
    },
    messages: {
      useStatusBadge:
        'Status columns should use <StatusBadge> for consistent visual treatment. ' +
        'Import from @open-mercato/ui/primitives/status-badge.',
    },
    schema: [],
  },
  create(context) {
    // Heuristic: collect column definitions with an accessorKey containing 'status'
    // and check whether the cell renderer contains JSX with StatusBadge or Badge

    let hasStatusBadgeImport = false
    let hasBadgeImport = false

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value)
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier') {
            if (spec.imported.name === 'StatusBadge') hasStatusBadgeImport = true
            if (spec.imported.name === 'Badge') hasBadgeImport = true
          }
        }
      },
      // Look for objects with accessorKey: '...status...' and no StatusBadge in cell
      Property(node: any) {
        if (
          node.key?.name === 'accessorKey' &&
          node.value?.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          node.value.value.toLowerCase().includes('status')
        ) {
          // If the module does not import StatusBadge or Badge — report
          if (!hasStatusBadgeImport && !hasBadgeImport) {
            context.report({ node, messageId: 'useStatusBadge' })
          }
        }
      },
    }
  },
}
```

### L.6 `om-ds/no-hardcoded-status-colors`

**Goal**: Prohibit hardcoded status colors. Enforce semantic tokens.

```ts
// rules/no-hardcoded-status-colors.ts — pseudo-implementation
// Extension of existing logic from section E

const FORBIDDEN_PATTERNS = [
  // Tailwind hardcoded status colors
  /\b(?:text|bg|border)-(?:red|green|yellow|orange|blue|emerald|amber|rose|lime)-\d{2,3}\b/,
  // Inline style colors for statuses
  /color:\s*(?:#(?:ef4444|f59e0b|10b981|3b82f6|dc2626|eab308))/i,
  // oklch hardcoded (should be tokens)
  /oklch\(\s*0\.(?:577|704)\s+0\.(?:245|191)\s+(?:27|22)\b/,
]

const ALLOWED_REPLACEMENTS: Record<string, string> = {
  'text-red-600': 'text-destructive',
  'text-red-500': 'text-destructive',
  'bg-red-50': 'bg-status-error-bg',
  'bg-red-100': 'bg-status-error-bg',
  'border-red-200': 'border-status-error-border',
  'text-green-600': 'text-status-success-text',
  'text-green-500': 'text-status-success-text',
  'bg-green-50': 'bg-status-success-bg',
  'bg-green-100': 'bg-status-success-bg',
  'text-yellow-600': 'text-status-warning-text',
  'text-amber-600': 'text-status-warning-text',
  'bg-yellow-50': 'bg-status-warning-bg',
  'bg-amber-50': 'bg-status-warning-bg',
  'text-blue-600': 'text-status-info-text',
  'bg-blue-50': 'bg-status-info-bg',
}

export const noHardcodedStatusColors: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description: 'Disallow hardcoded status colors — use semantic DS tokens',
    },
    messages: {
      hardcodedColor:
        'Hardcoded status color "{{found}}" detected. ' +
        'Use semantic token instead: {{replacement}}. ' +
        'See globals.css for --status-* tokens.',
    },
    schema: [],
  },
  create(context) {
    return {
      // Check className attributes in JSX
      JSXAttribute(node: any) {
        if (node.name?.name !== 'className') return

        const value = node.value
        if (!value) return

        // String literal
        if (value.type === 'Literal' && typeof value.value === 'string') {
          checkClassString(context, node, value.value)
        }

        // Template literal
        if (value.type === 'JSXExpressionContainer' && value.expression?.type === 'TemplateLiteral') {
          for (const quasi of value.expression.quasis) {
            checkClassString(context, node, quasi.value.raw)
          }
        }
      },
    }

    function checkClassString(ctx: Rule.RuleContext, node: any, classStr: string) {
      const classes = classStr.split(/\s+/)
      for (const cls of classes) {
        const replacement = ALLOWED_REPLACEMENTS[cls]
        if (replacement) {
          ctx.report({
            node,
            messageId: 'hardcodedColor',
            data: { found: cls, replacement },
          })
        }
      }
    }
  },
}
```

### L.7 `om-ds/no-legacy-alert-variant`

**Goal**: Keep the deprecated Alert `variant` prop out of in-repo code after the 2026-07 migration campaign drove the count from 119 to 0. The BC shim in `packages/ui/src/primitives/alert.tsx` still maps `variant` → `status` for third-party code; in-repo call sites must use `status` (+ optional `style`/`size`).

Shipped implementation (`packages/eslint-plugin-ds/rules/no-legacy-alert-variant.js`):

- Fires only when `Alert` is imported from a path ending in `primitives/alert` (or the intra-primitives `./alert`) — a bare name match is deliberately avoided because other libraries legitimately expose `Alert variant=`.
- Provides ESLint **suggestions** (not autofix — the `light` vs `lighter` style decision is a human call): `variant="destructive"` → `status="error"`, `variant="info"` → `status="information"`, `variant="success"`/`variant="warning"` map 1:1, `variant="default"` → remove the prop (information is the default). Dynamic `variant={expr}` is flagged without a suggestion.
- Unlike the six structural rules it is not backend-scoped: `eslint.ds.config.mjs` applies it to `packages/*/src/**/*.tsx` and `apps/*/src/**/*.tsx`.

Mapping table: `.ai/skills/om-ds-guardian/references/token-mapping.md` § "Legacy Alert `variant` → `status`".

### L.7a `om-ds/no-off-grid-spacing`

**Goal**: Keep primitives and blocks on the 4 px spacing grid set by `.ai/specs/2026-11-25-component-spacing-standard.md`.

Shipped implementation (`packages/eslint-plugin-ds/rules/no-off-grid-spacing.js`):

- Scans every string literal and template chunk, so class lists inside `cva`, `cn` and variant maps are covered, not only `className` attributes.
- Flags half steps (`px-2.5`, `gap-1.5`, `-ml-0.5`, also behind variants such as `hover:` or `[&>*]:`) and arbitrary spacing (`p-[13px]`). CSS-variable shorthands such as `pl-(--accordion-indent)` and sizing utilities (`size-3.5`, `w-1.5`) are not spacing and pass.
- Scope: `packages/ui/src/primitives/**` and `packages/ui/src/blocks/**` at `error`. Structural geometry opts out per line with `eslint-disable-next-line om-ds/no-off-grid-spacing -- <reason>` (today: switch track inset, file-format artwork, avatar stack overlap).

### L.7b `om-ds/prefer-business-block`

**Goal**: Module code reaches for a business block instead of hand-building the same surface again. Advisory (`warn`); it never fails CI in its current form.

Shipped implementation (`packages/eslint-plugin-ds/rules/prefer-business-block.js`):

| Block | Import | Showcase | What the rule recognises |
|-------|--------|----------|--------------------------|
| `bulk-action-bar` | `@open-mercato/ui/blocks/bulk-action-bar` | `/blocks/bulk-action-bar/` | Components named `*BulkActionBar`, `*BulkActionsBar`, `*BulkBar`, `*SelectionBar` (also with `Toolbar`) |
| `entity-header` | `@open-mercato/ui/blocks/entity-header` | `/blocks/entity-header/` | `*DetailHeader`, `*RecordHeader`, `*EntityHeader`, `*HeaderCard` |
| `list-toolbar` | `@open-mercato/ui/blocks/list-toolbar` | `/blocks/list-toolbar/` | `*FilterBar`, `*FilterBarRow`, `*ListToolbar`, `*TableToolbar` |
| `form-save-bar` | `@open-mercato/ui/blocks/form-save-bar` | `/blocks/form-save-bar/` | `*SaveBar`, `*UnsavedChangesBar`; or an element pinned to the bottom (`sticky`/`fixed` with a `bottom-*` class) that contains a button and reads a `dirty`/`unsaved` identifier |
| `timeline` | `@open-mercato/ui/blocks/timeline` | `/blocks/timeline/` | `*Timeline`, `*TimelineItem`, `*TimelineEntry`, `*ActivityFeed` |
| `kanban` | `@open-mercato/ui/blocks/kanban` | `/blocks/kanban/` | `*KanbanBoard`, `*KanbanPage`, `*KanbanView`, `*PipelineBoard` |
| `wizard` | `@open-mercato/ui/blocks/wizard` | `/blocks/wizard/` | `*Wizard`, `*WizardDialog`, `*WizardPage`, `*WizardNav`, `*WizardFlow`, `*StepIndicator` |
| `key-value` | `@open-mercato/ui/blocks/key-value` | `/blocks/key-value/` | `*FactsList`, `*FactsGrid`, `*DetailsList`, `*MetadataList`, `*InfoList`, `*PropertiesList`, `*KeyValue`, `*KeyValueList`; or a raw `<dl>` element |

- A name counts only on a component declaration: a `function` declaration, or a `const` initialised with a function, `memo(...)` or `forwardRef(...)`. Types, constants and imported components are ignored. The `.tsx` file name is checked against the same patterns when no declaration in the file already matched (reported on line 1).
- Names were tuned against the modules as they are today. Deliberately not matched, because every hit was something else: bare `*Bar` and `*ActionBar` (KPI strips, timers, drop indicators, closure menus), bare `*Header` and `*Toolbar` (calendar chrome, section headers), `*Stepper` (stage paths and status progress, not user-driven flows), `*KanbanColumn`/`*KanbanCard` (parts of a board that is already reported once), `*Editor` variants of key-value names.
- `stack` has no detection: spacing wrappers have no reliable name or structure.
- **Adapter exemption**: a file that imports the matching block from `@open-mercato/ui/blocks/<id>` is not reported for that block. A thin module component that maps module data to block props is the intended shape.
- **Scope** (`preferBusinessBlockScope` in `packages/eslint-plugin-ds/index.js`, registered in `eslint.ds.config.mjs`): `.tsx` under `packages/core/src/modules/**`, `packages/enterprise/src/modules/**` and `apps/mercato/src/modules/**`; tests, generated files, the `design_system` gallery, module `frontend/` pages and `ui/public/` renderers are excluded. `packages/ui` is out of scope.
- **Opt-out**: `// eslint-disable-next-line om-ds/prefer-business-block -- <reason>` on the reported line, or `/* eslint-disable om-ds/prefer-business-block -- <reason> */` at the top of the file (the only form that covers a file-name finding). The reason is mandatory, as for every `om-ds` rule, and opt-outs are counted by the `DS lint opt-outs` row of the CI report.

**Baseline (ratchet)**: hand-built surfaces that existed when the rule landed are listed in `packages/eslint-plugin-ds/baselines/prefer-business-block.json` as `{ "file": "<repo-relative path>", "block": "<id>" }` pairs. `eslint.ds.config.mjs` passes the list as the rule option `baseline`, and a finding whose file and block are listed is not reported. `yarn lint:ds` is therefore quiet for the listed files and warns when a new hand-built surface appears, including a second block's surface in a file that is listed for another block.

```bash
# adoption backlog: every finding without the baseline, plus new and stale entries
node packages/eslint-plugin-ds/scripts/prefer-business-block-baseline.mjs --list
# remove entries that no longer produce a finding (never adds one)
node packages/eslint-plugin-ds/scripts/prefer-business-block-baseline.mjs --prune
# rewrite the baseline from the current findings (only when the rule's patterns change)
node packages/eslint-plugin-ds/scripts/prefer-business-block-baseline.mjs --write
```

An entry leaves the baseline when its file adopts the block (the import exempts the file, so the entry becomes stale) or the hand-built component is deleted; run `--prune` in the same change. Do not use `--write` to silence a new finding: adopt the block, or opt out on the line with a reason.

### L.7c `om-ds/no-nested-frames`

**Goal**: Enforce "Frames: one level only" from `.ai/ds-rules.md`: a bordered rounded surface does not sit inside another bordered rounded surface. Advisory (`warn`); it never fails CI in its current form.

Shipped implementation (`packages/eslint-plugin-ds/rules/no-nested-frames.js`):

**What counts as a frame**

- An element whose always-applied classes hold a full border and a radius. Border: `border`, `border-2`, `border-4`, `border-8` or `border-[1px]`, alone or with a colour token. Radius: `rounded` or any all-corner `rounded-*` (`rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-card`, `rounded-content-card`, `rounded-alert`, ...).
- Not a border: side utilities (`border-t`, `border-b`, `border-x`, `border-l-4`), a colour token without `border`, `border-0`, `border-none`, `border-hidden`, a border whose only colour is `border-transparent`. Not a radius: `rounded-none`, `rounded-full`, `rounded-badge`, corner-only utilities (`rounded-t-lg`).
- Dashed and dotted borders are not frames. Every dashed hit in the audit was a drop zone, an add-new slot or an empty placeholder, which is a different affordance from a container.
- Known framed components, without inspecting classes: `Card`, `ContentCard`, `FileUploadCard`, `Notice`, `JsonDisplay`, `JsonBuilder`, `CollapsibleGroup`, `DataTable` (unless `embedded`), `AccordionItem` (default `card` variant), `EmptyState variant="outlined"`. `className="border-0"` (or a transparent border) on any of them turns the frame off.
- A component declared in the same file whose returned root element is a frame counts as a frame under its own name (for example a local `StatTile`). A local component whose root is an overlay counts as a boundary.

**What is never a frame**

- Controls and small chrome: `button`, `input`, `select`, `textarea`, `label`, `a`, `span`, `kbd`, `code`, `summary`, media elements, and components whose name ends in `Button`, `Input`, `Select`, `Textarea`, `Trigger`, `Badge`, `Tag`, `Chip`, `Pill`, `Avatar`, `Checkbox`, `Switch`, `Radio`, `Kbd`, `Link`, `Icon`, `Picker`, `Slider`, `Toggle`, `Skeleton`, `Label`, `TabsList`, `SegmentedControl`, `Image`, `Thumbnail`.
- Anything interactive as a whole: an `onClick` handler or `role="button|option|radio|checkbox|tab|switch|menuitem|link"`.
- Anything sized like a control: `size-*` or matching `h-*`/`w-*` up to 12 (48 px), a fixed height up to `h-12` without a width, inline display (`inline-flex`, `inline-block`), or the input border token `border-input`.
- Components left out on purpose: `Alert` and `ErrorNotice` (tinted background with an inset ring, no border), `Banner` (square, edge to edge), `LoadingMessage`, `ErrorMessage` and `AccessDeniedMessage` (transient state rows whose look belongs to the primitive), `Table` (no border of its own), `Tabs variant="card"` (control chrome), rich text and markdown editors (form controls).

**How classes are read**

- `className` string literals, template literals (static chunks; a chunk glued to an expression such as `border-${tone}` is dropped), `cn` / `clsx` / `cx` / `classNames` / `twMerge` / `twJoin` calls including nested arrays, `cva(...)` base classes, and `const` identifiers that resolve to any of those in the same file.
- Only classes that always apply count: `selected && 'border'` is ignored, and a ternary contributes the classes both branches share.
- Variants are ignored except responsive ones (`sm:` to `2xl:`): `hover:border` is not a border, `md:border` is.

**What gets reported**

- A frame whose nearest enclosing frame or boundary, walking up the JSX of the same file, is a frame. `.map` callbacks, conditionals, render props and elements passed as props are all inside the tree.
- Boundaries reset the walk, because the overlay is the frame for what it shows: `Dialog`, `DialogContent`, `Drawer`, `DrawerContent`, `Sheet`, `SheetContent`, `Popover`, `PopoverContent`, `DropdownMenuContent`, `Tooltip`, `TooltipContent`, `SimpleTooltip`, `HoverCardContent`, `AlertDialogContent`, namespaced overlay parts (`PopoverPrimitive.Content`), and a bordered element positioned `absolute` or `fixed` (a hand-built floating menu). One frame directly inside an overlay is therefore not reported; a second level inside it is.
- Message: ``Frame `<div>` is nested inside frame `<Card>` — separate it with spacing, a heading, a divider or a muted background instead of a second border (see "Frames: one level only" in .ai/ds-rules.md).``

**Not covered** (static analysis of one file): nesting across files (a page that wraps an imported section component in a `Card`, or a frame passed in through `children`), frames built from a class string that arrives through props or a helper call, JSX stored in a variable and rendered elsewhere, and surfaces outlined with `ring-1 ring-border` on a plain element.

- **Scope** (`noNestedFramesScope` in `packages/eslint-plugin-ds/index.js`, registered in `eslint.ds.config.mjs`): `.tsx` under `packages/ui/src/{backend,blocks,primitives}/**`, `packages/core/src/modules/**`, `packages/enterprise/src/modules/**` and `apps/mercato/src/modules/**`; tests, stories, generated files and the `design_system` gallery (its examples show framed components inside preview frames) are excluded.
- **Opt-out**: `{/* eslint-disable-next-line om-ds/no-nested-frames -- <reason> */}` above the reported element, or `/* eslint-disable om-ds/no-nested-frames -- <reason> */` at the top of the file. The reason is mandatory, as for every `om-ds` rule.

**Baseline (ratchet)**: nesting that existed when the rule landed is listed in `packages/eslint-plugin-ds/baselines/no-nested-frames.json` as `{ "file": "<repo-relative path>", "outer": "<element>", "inner": "<element>", "count": <n> }`. The key is the file plus the two element names; `count` covers occurrences 1 to n of that pair in source order, so line shifts and unrelated edits do not invalidate an entry. The rule reports occurrence n + 1 onward, which means a new nested frame of an already listed pair is reported once, on the last occurrence in the file rather than on the line that was added.

```bash
# backlog: every finding without the baseline, per module, plus new and stale counts
node packages/eslint-plugin-ds/scripts/no-nested-frames-baseline.mjs --list
# lower counts and drop entries that no longer produce a finding (never adds one)
node packages/eslint-plugin-ds/scripts/no-nested-frames-baseline.mjs --prune
# rewrite the baseline from the current findings (only when the rule's detection changes)
node packages/eslint-plugin-ds/scripts/no-nested-frames-baseline.mjs --write
# dump the findings with line numbers for an audit
node packages/eslint-plugin-ds/scripts/no-nested-frames-baseline.mjs --json <path>
```

When a nested frame is flattened, run `--prune` in the same change. Do not use `--write` to silence a new finding: remove the inner border, or opt out on the line with a reason.

### L.8 Rules Summary

| Rule | Severity (new code) | Severity (legacy) | Auto-fix |
|------|---------------------|--------------------|----------|
| `om-ds/require-empty-state` | error | warn | No |
| `om-ds/require-page-wrapper` | error | error | No |
| `om-ds/no-raw-table` | error | error | No |
| `om-ds/require-loading-state` | error | warn | No |
| `om-ds/require-status-badge` | error | warn | No |
| `om-ds/no-hardcoded-status-colors` | error | error | Yes (suggestion) |
| `om-ds/no-legacy-alert-variant` | error | warn | No (suggestions) |
| `om-ds/no-off-grid-spacing` | error (primitives, blocks) | n/a | No |
| `om-ds/prefer-business-block` | warn (advisory) | baselined | No |
| `om-ds/no-nested-frames` | warn (advisory) | baselined | No |

**Success metric**: 0 warnings on new modules, legacy warnings down 30% per sprint.

---

---

## See also

- [Enforcement](./enforcement.md) — broader enforcement plan
- [Contributor Guardrails](./contributor-guardrails.md) — templates and anti-patterns
- [Onboarding Guide](./onboarding-guide.md) — how a contributor configures lint
