import { test } from 'node:test'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import plugin from '../index.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const backendFilename = '/repo/packages/core/src/modules/example/backend/things/page.tsx'

test('require-empty-state', () => {
  ruleTester.run('require-empty-state', plugin.rules['require-empty-state'], {
    valid: [
      {
        code: `const P = () => <DataTable columns={[]} data={[]} emptyState="none" />`,
        filename: backendFilename,
      },
      {
        code: `const P = () => <div>{empty ? <EmptyState title="x" /> : <DataTable columns={[]} data={[]} />}</div>`,
        filename: backendFilename,
      },
      {
        code: `const P = () => <div>no table here</div>`,
        filename: backendFilename,
      },
    ],
    invalid: [
      {
        code: `const P = () => <DataTable columns={[]} data={[]} />`,
        filename: backendFilename,
        errors: [{ messageId: 'missingEmptyState' }],
      },
    ],
  })
})

test('require-page-wrapper', () => {
  ruleTester.run('require-page-wrapper', plugin.rules['require-page-wrapper'], {
    valid: [
      {
        code: `export default function P() { return <Page><PageBody>hi</PageBody></Page> }`,
        filename: backendFilename,
      },
      {
        code: `export function helper() { return <div /> }`,
        filename: backendFilename,
      },
      {
        code: `export default function P() { return <Page><PageBody>hi</PageBody></Page> }`,
        filename: '/repo/packages/core/src/modules/example/components/Widget.tsx',
      },
      {
        code: `export default function P() { return <div /> }`,
        filename: '/repo/packages/core/src/modules/example/backend/things/DetailPane.tsx',
      },
    ],
    invalid: [
      {
        code: `export default function P() { return <div>hi</div> }`,
        filename: backendFilename,
        errors: [{ messageId: 'missingPage' }],
      },
      {
        code: `export default function P() { return <Page><div>hi</div></Page> }`,
        filename: backendFilename,
        errors: [{ messageId: 'missingPageBody' }],
      },
    ],
  })
})

test('no-raw-table', () => {
  ruleTester.run('no-raw-table', plugin.rules['no-raw-table'], {
    valid: [
      {
        code: `const P = () => <Table><TableBody /></Table>`,
        filename: backendFilename,
      },
      {
        code: `const P = () => <table />`,
        filename: '/repo/packages/ui/src/primitives/table.tsx',
      },
    ],
    invalid: [
      {
        code: `const P = () => <table><tbody><tr><td>x</td></tr></tbody></table>`,
        filename: backendFilename,
        errors: [
          { messageId: 'noRawTable' },
          { messageId: 'noRawTable' },
          { messageId: 'noRawTable' },
          { messageId: 'noRawTable' },
        ],
      },
    ],
  })
})

test('require-loading-state', () => {
  ruleTester.run('require-loading-state', plugin.rules['require-loading-state'], {
    valid: [
      {
        code: `const P = () => { apiCall('/api/x'); return <DataTable isLoading={pending} /> }`,
        filename: backendFilename,
      },
      {
        code: `const P = () => { const [isLoading, setIsLoading] = useState(false); apiCall('/api/x'); return <div /> }`,
        filename: backendFilename,
      },
      {
        code: `const P = () => { apiCall('/api/x'); return loading ? <LoadingMessage /> : <div /> }`,
        filename: backendFilename,
      },
      {
        code: `const P = () => <div>static</div>`,
        filename: backendFilename,
      },
    ],
    invalid: [
      {
        code: `const P = () => { apiCall('/api/x'); return <div /> }`,
        filename: backendFilename,
        errors: [{ messageId: 'missingLoadingState' }],
      },
    ],
  })
})

test('require-status-badge', () => {
  ruleTester.run('require-status-badge', plugin.rules['require-status-badge'], {
    valid: [
      {
        code: `import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'\nconst cols = [{ accessorKey: 'status' }]`,
        filename: backendFilename,
      },
      {
        code: `const cols = [{ accessorKey: 'name' }]`,
        filename: backendFilename,
      },
    ],
    invalid: [
      {
        code: `const cols = [{ accessorKey: 'status' }]`,
        filename: backendFilename,
        errors: [{ messageId: 'useStatusBadge' }],
      },
    ],
  })
})

test('no-legacy-alert-variant', () => {
  const dsImport = `import { Alert } from '@open-mercato/ui/primitives/alert'\n`
  ruleTester.run('no-legacy-alert-variant', plugin.rules['no-legacy-alert-variant'], {
    valid: [
      {
        // New API — nothing to flag.
        code: `${dsImport}const P = () => <Alert status="error">Oops</Alert>`,
        filename: backendFilename,
      },
      {
        // Non-DS Alert import legitimately exposing `variant` — must not fire.
        code: `import { Alert } from 'some-other-library'\nconst P = () => <Alert variant="destructive">Oops</Alert>`,
        filename: backendFilename,
      },
      {
        // Bare name match without any DS import — must not fire.
        code: `const P = () => <Alert variant="info">FYI</Alert>`,
        filename: backendFilename,
      },
    ],
    invalid: [
      {
        code: `${dsImport}const P = () => <Alert variant="destructive">Oops</Alert>`,
        filename: backendFilename,
        errors: [
          {
            messageId: 'legacyVariant',
            suggestions: [
              {
                messageId: 'replaceWithStatus',
                data: { status: 'error' },
                output: `${dsImport}const P = () => <Alert status="error">Oops</Alert>`,
              },
            ],
          },
        ],
      },
      {
        code: `${dsImport}const P = () => <Alert variant="info">FYI</Alert>`,
        filename: backendFilename,
        errors: [
          {
            messageId: 'legacyVariant',
            suggestions: [
              {
                messageId: 'replaceWithStatus',
                data: { status: 'information' },
                output: `${dsImport}const P = () => <Alert status="information">FYI</Alert>`,
              },
            ],
          },
        ],
      },
      {
        // `default` maps to the default status — the suggestion removes the prop.
        code: `${dsImport}const P = () => <Alert variant="default">Hello</Alert>`,
        filename: backendFilename,
        errors: [
          {
            messageId: 'legacyVariant',
            suggestions: [
              {
                messageId: 'removeProp',
                output: `${dsImport}const P = () => <Alert>Hello</Alert>`,
              },
            ],
          },
        ],
      },
      {
        // Relative import from within packages/ui.
        code: `import { Alert } from '../../primitives/alert'\nconst P = () => <Alert variant="warning" className="mb-2">Careful</Alert>`,
        filename: '/repo/packages/ui/src/ai/parts/Banner.tsx',
        errors: [
          {
            messageId: 'legacyVariant',
            suggestions: [
              {
                messageId: 'replaceWithStatus',
                data: { status: 'warning' },
                output: `import { Alert } from '../../primitives/alert'\nconst P = () => <Alert status="warning" className="mb-2">Careful</Alert>`,
              },
            ],
          },
        ],
      },
      {
        // Dynamic expression — flagged, but no mechanical suggestion.
        code: `${dsImport}const P = () => <Alert variant={overdue ? 'warning' : 'info'}>Hi</Alert>`,
        filename: backendFilename,
        errors: [{ messageId: 'legacyVariant', suggestions: [] }],
      },
    ],
  })
})

test('no-hardcoded-status-colors', () => {
  ruleTester.run('no-hardcoded-status-colors', plugin.rules['no-hardcoded-status-colors'], {
    valid: [
      {
        code: `const P = () => <div className="text-status-error-text bg-status-success-bg border-border" />`,
        filename: backendFilename,
      },
      {
        code: `const P = () => <div className="text-muted-foreground bg-destructive" />`,
        filename: backendFilename,
      },
    ],
    invalid: [
      {
        code: `const P = () => <div className="text-red-600" />`,
        filename: backendFilename,
        errors: [{ messageId: 'hardcodedColor' }],
      },
      {
        code: `const P = () => <div className={cn('bg-green-100', extra)} />`,
        filename: backendFilename,
        errors: [{ messageId: 'hardcodedColor' }],
      },
      {
        code: 'const P = () => <div className={`border-amber-200 ${x}`} />',
        filename: backendFilename,
        errors: [{ messageId: 'hardcodedColor' }],
      },
      {
        code: `const P = () => <div className="hover:bg-rose-50" />`,
        filename: backendFilename,
        errors: [{ messageId: 'hardcodedColor' }],
      },
    ],
  })
})
