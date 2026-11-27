import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Linter, RuleTester } from 'eslint'
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

test('no-off-grid-spacing', () => {
  const primitive = '/repo/packages/ui/src/primitives/thing.tsx'
  ruleTester.run('no-off-grid-spacing', plugin.rules['no-off-grid-spacing'], {
    valid: [
      { code: `const P = () => <div className="p-card gap-y-field-stack px-3 py-2 gap-2" />`, filename: primitive },
      { code: `const variants = cva('h-9 px-4', { variants: { size: { sm: 'h-8 px-3 gap-1' } } })`, filename: primitive },
      { code: `const P = () => <div className="pl-(--accordion-indent) size-3.5 w-1.5" />`, filename: primitive },
    ],
    invalid: [
      { code: `const P = () => <div className="px-2.5" />`, filename: primitive, errors: [{ messageId: 'offGrid' }] },
      { code: `const variants = cva('h-9', { variants: { size: { sm: 'gap-1.5 py-0.5' } } })`, filename: primitive, errors: [{ messageId: 'offGrid' }, { messageId: 'offGrid' }] },
      { code: `const P = () => <div className={cn('hover:p-[13px]', x)} />`, filename: primitive, errors: [{ messageId: 'offGrid' }] },
      { code: 'const P = () => <div className={`-ml-1.5 ${x}`} />', filename: primitive, errors: [{ messageId: 'offGrid' }] },
      { code: `const c = '[&>*]:px-3.5'`, filename: primitive, errors: [{ messageId: 'offGrid' }] },
    ],
  })
})

test('prefer-business-block', () => {
  const moduleFile = (name) => `/repo/packages/core/src/modules/example/components/${name}.tsx`
  const rule = plugin.rules['prefer-business-block']
  const hit = (block) => ({
    message: new RegExp(`use the \`${block}\` block from @open-mercato/ui/blocks/${block} \\(showcase page /blocks/${block}/\\)`),
  })
  ruleTester.run('prefer-business-block', rule, {
    valid: [
      { code: `export function OrdersPanel() { return <div /> }`, filename: moduleFile('OrdersPanel') },
      { code: `export function CompanyKpiBar() { return <div /> }`, filename: moduleFile('CompanyKpiBar') },
      { code: `export function DealClosureActionBar() { return <div /> }`, filename: moduleFile('DealClosureActionBar') },
      { code: `export function CalendarHeader() { return <h1 /> }`, filename: moduleFile('CalendarHeader') },
      { code: `export function TimelineItemHeader() { return <div /> }`, filename: moduleFile('TimelineItemHeader') },
      { code: `export function CalendarToolbar() { return <div /> }`, filename: moduleFile('CalendarToolbar') },
      { code: `export function PipelineStepper() { return <ol /> }`, filename: moduleFile('PipelineStepper') },
      { code: `export function KanbanColumn() { return <div /> }`, filename: moduleFile('KanbanColumn') },
      { code: `export function KeyValueRowsEditor() { return <div /> }`, filename: moduleFile('KeyValueRowsEditor') },
      { code: `export function SaveIndicator() { return <span /> }`, filename: moduleFile('SaveIndicator') },
      { code: `type WizardStep = 'one' | 'two'\nconst STEPS: WizardStep[] = ['one', 'two']\nexport function Flow() { return <div>{STEPS.length}</div> }`, filename: moduleFile('Flow') },
      { code: `const DealTimeline = { limit: 5 }\nexport function Panel() { return <div>{DealTimeline.limit}</div> }`, filename: moduleFile('Panel') },
      { code: `import { OrderDetailHeader } from './header'\nexport function Panel() { return <OrderDetailHeader /> }`, filename: moduleFile('Panel') },
      {
        code: `export function Footer({ onSend }) { return <div className="sticky bottom-0 border-t"><Button onClick={onSend}>Send</Button></div> }`,
        filename: moduleFile('Footer'),
      },
      {
        code: `export function Hint({ isDirty }) { return <div className="sticky top-0">{isDirty ? 'x' : 'y'}<Button>Save</Button></div> }`,
        filename: moduleFile('Hint'),
      },
      {
        code: `import { BulkActionBar } from '@open-mercato/ui/blocks/bulk-action-bar'\nexport function BulkActionsBar(props) { return <BulkActionBar {...props} /> }`,
        filename: moduleFile('BulkActionsBar'),
      },
      {
        code: `import { KeyValue } from '@open-mercato/ui/blocks/key-value'\nexport function OrderFactsList({ items }) { return <KeyValue items={items} /> }`,
        filename: moduleFile('OrderFactsList'),
      },
      {
        code: `import type { TimelineProps } from '@open-mercato/ui/blocks/timeline/index'\nexport function DealTimeline(props: TimelineProps) { return <div /> }`,
        filename: moduleFile('DealTimeline'),
      },
      {
        code: `export function OrdersBulkActionsBar() { return <div /> }`,
        filename: moduleFile('OrdersBulkActionsBar'),
        options: [{ baseline: [{ file: 'packages/core/src/modules/example/components/OrdersBulkActionsBar.tsx', block: 'bulk-action-bar' }] }],
      },
      {
        code: `export function Facts() { return <dl><dt>Owner</dt><dd>Ada</dd></dl> }`,
        filename: 'C:\\repo\\packages\\core\\src\\modules\\example\\components\\Facts.tsx',
        options: [{ baseline: [{ file: 'packages/core/src/modules/example/components/Facts.tsx', block: 'key-value' }] }],
      },
    ],
    invalid: [
      { code: `export function OrdersBulkActionsBar() { return <div /> }`, filename: moduleFile('OrdersBulkActionsBar'), errors: [hit('bulk-action-bar')] },
      { code: `export const RowSelectionBar = () => <div />`, filename: moduleFile('RowSelectionBar'), errors: [hit('bulk-action-bar')] },
      { code: `export function OrderDetailHeader() { return <h1 /> }`, filename: moduleFile('OrderDetailHeader'), errors: [hit('entity-header')] },
      { code: `export const AgentHeaderCard = React.memo(function Inner() { return <h1 /> })`, filename: moduleFile('AgentHeaderCard'), errors: [hit('entity-header')] },
      { code: `export function FilterBarRow() { return <div /> }`, filename: moduleFile('FilterBarRow'), errors: [hit('list-toolbar')] },
      { code: `export function OrdersTableToolbar() { return <div /> }`, filename: moduleFile('OrdersTableToolbar'), errors: [hit('list-toolbar')] },
      { code: `export function UnsavedChangesBar() { return <div /> }`, filename: moduleFile('UnsavedChangesBar'), errors: [hit('form-save-bar')] },
      {
        code: `export function Settings({ isDirty, onSave }) { return <div className={\`sticky bottom-0 border-t \${isDirty ? 'a' : 'b'}\`}><Button disabled={!isDirty} onClick={onSave}>Save</Button></div> }`,
        filename: moduleFile('Settings'),
        errors: [hit('form-save-bar')],
      },
      {
        code: `export function Settings({ dirty, onSave }) { return <div className="fixed inset-x-0 bottom-4"><span>{dirty ? 'x' : 'y'}</span><button onClick={onSave}>Save</button></div> }`,
        filename: moduleFile('Settings'),
        errors: [hit('form-save-bar')],
      },
      { code: `export function ActivityTimeline() { return <ul /> }`, filename: moduleFile('ActivityTimeline'), errors: [hit('timeline')] },
      { code: `function TimelineItem() { return <li /> }\nexport function History() { return <TimelineItem /> }`, filename: moduleFile('History'), errors: [hit('timeline')] },
      { code: `export function AccountActivityFeed() { return <ul /> }`, filename: moduleFile('AccountActivityFeed'), errors: [hit('timeline')] },
      { code: `export function KanbanBoard() { return <div /> }`, filename: moduleFile('KanbanBoard'), errors: [hit('kanban')] },
      { code: `export default function DealsKanbanPage() { return <div /> }`, filename: '/repo/packages/core/src/modules/example/backend/deals/page.tsx', errors: [hit('kanban')] },
      { code: `export default function SsoConfigCreateWizard() { return <div /> }`, filename: '/repo/packages/core/src/modules/example/backend/new/page.tsx', errors: [hit('wizard')] },
      { code: `function ImportStepIndicator() { return <ol /> }\nexport function ImportDialog() { return <ImportStepIndicator /> }`, filename: moduleFile('ImportDialog'), errors: [hit('wizard')] },
      { code: `export function FactsGrid() { return <div /> }`, filename: moduleFile('ProposalFacts'), errors: [hit('key-value')] },
      { code: `export function Panel() { return <dl><dt>Owner</dt><dd>Ada</dd></dl> }`, filename: moduleFile('Panel'), errors: [hit('key-value')] },
      { code: `export function EntryFilterPresets() { return <div /> }`, filename: moduleFile('EntryFilterBar'), errors: [{ ...hit('list-toolbar'), line: 1 }] },
      {
        code: `import { Timeline } from '@open-mercato/ui/blocks/timeline'\nexport function DealDetailHeader() { return <Timeline items={[]} /> }`,
        filename: moduleFile('DealDetailHeader'),
        errors: [hit('entity-header')],
      },
      {
        code: `export function OrdersBulkActionsBar() { return <dl /> }`,
        filename: moduleFile('OrdersBulkActionsBar'),
        options: [{ baseline: [{ file: 'packages/core/src/modules/example/components/OrdersBulkActionsBar.tsx', block: 'bulk-action-bar' }] }],
        errors: [hit('key-value')],
      },
      {
        code: `export function OrdersBulkActionsBar() { return <div /> }`,
        filename: '/repo/packages/core/src/modules/other/components/OrdersBulkActionsBar.tsx',
        options: [{ baseline: [{ file: 'packages/core/src/modules/example/components/OrdersBulkActionsBar.tsx', block: 'bulk-action-bar' }] }],
        errors: [hit('bulk-action-bar')],
      },
    ],
  })
})

test('prefer-business-block message and opt-out', () => {
  const linter = new Linter({ configType: 'flat' })
  const config = [
    {
      files: ['**/*.tsx'],
      languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { 'om-ds': plugin },
      rules: { 'om-ds/prefer-business-block': 'warn' },
    },
  ]
  const lint = (code) => linter.verify(code, config, { filename: 'packages/core/src/modules/example/components/Panel.tsx' })

  const reported = lint(`export function OrderTimeline() { return <ul /> }`)
  assert.equal(reported.length, 1)
  assert.equal(reported[0].severity, 1)
  assert.equal(
    reported[0].message,
    'Hand-built component `OrderTimeline` — use the `timeline` block from @open-mercato/ui/blocks/timeline (showcase page /blocks/timeline/), or wrap it in a thin adapter.',
  )

  const lineOptOut = lint(
    `// eslint-disable-next-line om-ds/prefer-business-block -- renders a chart axis, not an activity history\nexport function OrderTimeline() { return <ul /> }`,
  )
  assert.deepEqual(lineOptOut, [])

  const fileOptOut = lint(
    `/* eslint-disable om-ds/prefer-business-block -- print layout, blocks are screen only */\nexport function OrderTimeline() { return <dl /> }`,
  )
  assert.deepEqual(fileOptOut, [])

  const otherLine = lint(
    `// eslint-disable-next-line om-ds/prefer-business-block -- renders a chart axis, not an activity history\nexport function OrderTimeline() { return <ul /> }\nexport function Facts() { return <dl /> }`,
  )
  assert.equal(otherLine.length, 1)
  assert.match(otherLine[0].message, /`key-value` block/)
})
