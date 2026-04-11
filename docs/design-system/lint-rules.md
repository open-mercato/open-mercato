# L. Structural Lint Rules

> ESLint v9 flat config plugin `eslint-plugin-open-mercato-ds` — 6 reguł, konfiguracja, CI integration.

---

Sześć reguł ESLint do egzekwowania design systemu. Projekt używa ESLint v9 flat config (`eslint.config.mjs`). Reguły zaimplementowane jako custom plugin `eslint-plugin-open-mercato-ds`.

### L.0 Strategia wdrożenia

```
eslint-plugin-open-mercato-ds/
├── index.ts                    — plugin entry, exportuje rules + recommended config
├── rules/
│   ├── require-empty-state.ts
│   ├── require-page-wrapper.ts
│   ├── no-raw-table.ts
│   ├── require-loading-state.ts
│   ├── require-status-badge.ts
│   └── no-hardcoded-status-colors.ts
└── utils/
    └── ast-helpers.ts          — wspólne selektory AST
```

Dodanie do `eslint.config.mjs`:

```js
import omDs from './eslint-plugin-open-mercato-ds/index.js'

export default [
  // ... existing config
  {
    plugins: { 'om-ds': omDs },
    files: ['packages/core/src/modules/**/backend/**/*.tsx'],
    rules: {
      'om-ds/require-empty-state': 'warn',      // warn → error po migracji
      'om-ds/require-page-wrapper': 'error',
      'om-ds/no-raw-table': 'error',
      'om-ds/require-loading-state': 'warn',
      'om-ds/require-status-badge': 'warn',
      'om-ds/no-hardcoded-status-colors': 'error',
    },
  },
]
```

**Rollout plan**: Wszystkie reguły startują jako `warn` na istniejącym kodzie. Nowe moduły (tworzone po hackathonie) mają `error`. Po migracji modułu → przełączamy na `error` globalnie.

### L.1 `om-ds/require-empty-state`

**Cel**: Każda strona z DataTable musi mieć EmptyState.

```ts
// rules/require-empty-state.ts — pseudo-implementacja
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
      // Szukamy importu DataTable
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
      // Szukamy użycia <EmptyState w JSX
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

**Cel**: Backend pages muszą używać `<Page>` + `<PageBody>` jako wrapper.

```ts
// rules/require-page-wrapper.ts — pseudo-implementacja
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
        // Tylko pliki w backend/ z default export (page components)
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

**Cel**: Zakaz użycia `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>`, `<th>` bezpośrednio w backend pages. Wymuszenie DataTable lub primitives/table.

```ts
// rules/no-raw-table.ts — pseudo-implementacja
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

**Cel**: Strony z asynchronicznym pobieraniem danych muszą mieć LoadingMessage lub przekazywać `isLoading` do DataTable.

```ts
// rules/require-loading-state.ts — pseudo-implementacja
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

**Cel**: Statusy (active/inactive, draft/published, itp.) muszą używać StatusBadge, nie surowego tekstu ani custom `<span>`.

```ts
// rules/require-status-badge.ts — pseudo-implementacja
// Heurystyka: szukamy kolumn DataTable z accessorKey zawierającym 'status'
// które nie renderują StatusBadge w cell renderer

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
    // Heurystyka: Zbieramy definicje kolumn z accessorKey zawierającym 'status'
    // i sprawdzamy czy cell renderer zawiera JSX z StatusBadge lub Badge

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
      // Szukamy obiektów z accessorKey: '...status...' i brak StatusBadge w cell
      Property(node: any) {
        if (
          node.key?.name === 'accessorKey' &&
          node.value?.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          node.value.value.toLowerCase().includes('status')
        ) {
          // Jeśli moduł nie importuje StatusBadge ani Badge — raportuj
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

**Cel**: Zakaz hardcoded kolorów statusów. Wymuszenie semantic tokens.

```ts
// rules/no-hardcoded-status-colors.ts — pseudo-implementacja
// Rozszerzenie istniejącej logiki z sekcji E

const FORBIDDEN_PATTERNS = [
  // Tailwind hardcoded status colors
  /\b(?:text|bg|border)-(?:red|green|yellow|orange|blue|emerald|amber|rose|lime)-\d{2,3}\b/,
  // Inline style colors for statuses
  /color:\s*(?:#(?:ef4444|f59e0b|10b981|3b82f6|dc2626|eab308))/i,
  // oklch hardcoded (powinny być tokeny)
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
      // Sprawdzamy atrybuty className w JSX
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

### L.7 Podsumowanie reguł

| Reguła | Severity (nowy kod) | Severity (legacy) | Auto-fix |
|--------|---------------------|--------------------|----------|
| `om-ds/require-empty-state` | error | warn | ✗ |
| `om-ds/require-page-wrapper` | error | error | ✗ |
| `om-ds/no-raw-table` | error | error | ✗ |
| `om-ds/require-loading-state` | error | warn | ✗ |
| `om-ds/require-status-badge` | error | warn | ✗ |
| `om-ds/no-hardcoded-status-colors` | error | error | ✓ (sugestia) |

**Metryka sukcesu**: 0 warnings na nowych modułach, legacy warnings ↓30% per sprint.

---

---

## See also

- [Enforcement](./enforcement.md) — szerszy plan egzekucji
- [Contributor Guardrails](./contributor-guardrails.md) — szablony i anti-patterns
- [Onboarding Guide](./onboarding-guide.md) — jak contributor konfiguruje lint
