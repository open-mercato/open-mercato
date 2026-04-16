# L. Structural Lint Rules

> ESLint v9 flat config plugin `eslint-plugin-open-mercato-ds` — 6 rules, configuration, CI integration.

---

Six ESLint rules for enforcing the design system. The project uses ESLint v9 flat config (`eslint.config.mjs`). Rules are implemented as a custom plugin `eslint-plugin-open-mercato-ds`.

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

**Rollout plan**: All rules start as `warn` on existing code. New modules (created after the hackathon) use `error`. After migrating a module, switch to `error` globally.

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

### L.7 Rules Summary

| Rule | Severity (new code) | Severity (legacy) | Auto-fix |
|------|---------------------|--------------------|----------|
| `om-ds/require-empty-state` | error | warn | No |
| `om-ds/require-page-wrapper` | error | error | No |
| `om-ds/no-raw-table` | error | error | No |
| `om-ds/require-loading-state` | error | warn | No |
| `om-ds/require-status-badge` | error | warn | No |
| `om-ds/no-hardcoded-status-colors` | error | error | Yes (suggestion) |

**Success metric**: 0 warnings on new modules, legacy warnings down 30% per sprint.

---

---

## See also

- [Enforcement](./enforcement.md) — broader enforcement plan
- [Contributor Guardrails](./contributor-guardrails.md) — templates and anti-patterns
- [Onboarding Guide](./onboarding-guide.md) — how a contributor configures lint
