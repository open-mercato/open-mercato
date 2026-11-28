/** @jest-environment jsdom */
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import vm from 'node:vm'
import path from 'node:path'
import ts from 'typescript'
import { z } from 'zod'
import { parseISO } from 'date-fns/parseISO'
import { buildScaffoldPlan, parseScaffoldArgs } from '../index'
import { statusVariantFor } from '../field-dsl'

type FormProps = {
  schema: z.ZodType
  initialValues?: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
}
type TableProps = {
  error?: string | null
  data: Record<string, unknown>[]
  columns: { accessorKey: string; cell?: (context: { row: { original: Record<string, unknown> } }) => React.ReactNode }[]
  onSearchChange: (value: string) => void
}

const apiCall = jest.fn()
const createCrud = jest.fn().mockResolvedValue({ result: { id: 'created' } })
const updateCrud = jest.fn().mockResolvedValue({})
const reportError = jest.fn()
const translate = (_key: string, fallback: string) => fallback
const router = { push: jest.fn() }
const guardedMutation = { runMutation: jest.fn(), retryLastMutation: jest.fn() }
const confirmDialog = { confirm: jest.fn(), ConfirmDialogElement: null }
let formProps: FormProps | undefined
let tableProps: TableProps | undefined
let root: Root
let container: HTMLDivElement
let files: Map<string, string>

function Wrapper({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>
}

function evaluateFile(file: string, cache = new Map<string, Record<string, unknown>>()): Record<string, unknown> {
  const existing = cache.get(file)
  if (existing) return existing
  const source = files.get(file)
  if (!source) throw new Error(`Missing fixture source: ${file}`)
  const exports: Record<string, unknown> = {}
  cache.set(file, exports)
  const modules: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    zod: { z },
    'date-fns/parseISO': { parseISO },
    'next/navigation': { useRouter: () => router },
    'next/link': { default: Wrapper },
    '@open-mercato/ui/backend/Page': { Page: Wrapper, PageBody: Wrapper },
    '@open-mercato/ui/backend/CrudForm': {
      CrudForm: (props: FormProps) => { formProps = props; return <div>Form</div> },
    },
    '@open-mercato/ui/backend/DataTable': {
      DataTable: (props: TableProps) => { tableProps = props; return <div>{props.error ?? 'Table'}</div> },
    },
    '@open-mercato/ui/backend/forms/FormHeader': { FormHeader: Wrapper },
    '@open-mercato/ui/primitives/tabs': { Tabs: Wrapper, TabsContent: Wrapper, TabsList: Wrapper, TabsTrigger: Wrapper },
    '@open-mercato/ui/primitives/button': { Button: Wrapper },
    '@open-mercato/ui/primitives/empty-state': { EmptyState: Wrapper },
    '@open-mercato/ui/primitives/status-badge': { StatusBadge: Wrapper },
    '@open-mercato/ui/backend/RowActions': { RowActions: Wrapper },
    '@open-mercato/ui/backend/detail': {
      LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
      ErrorMessage: ({ label }: { label: string }) => <div role="alert">{label}</div>,
    },
    '@open-mercato/ui/backend/utils/apiCall': { apiCall },
    '@open-mercato/ui/backend/utils/crud': { createCrud, updateCrud },
    '@open-mercato/ui/backend/utils/optimisticLock': {},
    '@open-mercato/ui/backend/injection/useGuardedMutation': { useGuardedMutation: () => guardedMutation },
    '@open-mercato/ui/backend/FlashMessages': { flash: jest.fn() },
    '@open-mercato/ui/backend/confirm-dialog': { useConfirmDialog: () => confirmDialog },
    '@open-mercato/shared/lib/i18n/context': { useT: () => translate },
    '@open-mercato/shared/lib/telemetry/runtime': { getTelemetryRuntime: () => ({ reportError }) },
  }
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(compiled, {
    exports,
    URLSearchParams,
    require: (specifier: string) => {
      if (Object.hasOwn(modules, specifier)) return modules[specifier]
      if (specifier.startsWith('.')) {
        return evaluateFile(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)) + '.ts', cache)
      }
      throw new Error(`Unexpected fixture import: ${specifier}`)
    },
  }, { filename: file, timeout: 5000 })
  return exports
}

function page(file: string): React.ComponentType<{ params?: { id: string } }> {
  return evaluateFile(file).default as React.ComponentType<{ params?: { id: string } }>
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
beforeEach(() => {
  jest.clearAllMocks()
  formProps = undefined
  tableProps = undefined
  const parsed = parseScaffoldArgs(['tasks', '--entity', 'task', '--fields', 'name:text:required,dueDate:date:required,followUpDate:date,status:select(open|constructor)'])
  if (!parsed.ok) throw new Error(parsed.error)
  const plan = buildScaffoldPlan(parsed.options, { kind: 'app', modulesRoot: '/fixture', moduleDir: '/fixture/tasks', registrationFrom: '@app' })
  files = new Map(plan.files.map((file) => [file.relPath, file.contents]))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await React.act(async () => root.unmount())
  container.remove()
})

it('preserves civil dates through generated create, list, detail and update consumers west of UTC', async () => {
  expect(new Date('2026-11-18').getDate()).toBe(17)
  const CreatePage = page('backend/tasks/create/page.tsx')
  await React.act(async () => root.render(<CreatePage />))
  const input = { name: 'Task', dueDate: '2026-11-18', status: 'constructor' }
  const created = formProps!.schema.parse(input) as Record<string, unknown>
  expect(created.dueDate).toBe('2026-11-18')
  await formProps!.onSubmit(created)
  expect(createCrud).toHaveBeenCalledWith('tasks', expect.objectContaining({ dueDate: '2026-11-18' }))
  const record = { ...JSON.parse(JSON.stringify(created)), id: 'b73d8a12-b1e3-47b9-9d21-ce25c76f6e6d', updatedAt: '2026-11-18T12:00:00Z' }
  apiCall.mockResolvedValue({ ok: true, result: { items: [record], total: 1, totalPages: 1 } })
  const ListPage = page('backend/tasks/page.tsx')
  await React.act(async () => root.render(<ListPage />))
  const dateColumn = tableProps!.columns.find((column) => column.accessorKey === 'dueDate')!
  const rendered = dateColumn.cell!({ row: { original: record } })
  expect(rendered).toBe(parseISO('2026-11-18').toLocaleDateString())
  const DetailPage = page('backend/tasks/[id]/page.tsx')
  await React.act(async () => root.render(<DetailPage params={{ id: record.id }} />))
  expect(formProps!.initialValues!.dueDate).toBe('2026-11-18')
  expect(formProps!.initialValues!.updatedAt).toBe(record.updatedAt)
  const updated = formProps!.schema.parse(formProps!.initialValues) as Record<string, unknown>
  await React.act(async () => formProps!.onSubmit(updated))
  expect(updateCrud).toHaveBeenCalledWith('tasks', expect.objectContaining({ dueDate: '2026-11-18' }))
})

it('validates real calendar dates without converting them to instants', () => {
  const schema = evaluateFile('data/validators.ts').taskCreateSchema as z.ZodType
  for (const dueDate of ['2024-02-29', '2026-11-18']) {
    expect(schema.parse({ name: 'Task', dueDate })).toEqual({ name: 'Task', dueDate })
  }
  for (const dueDate of ['2026-02-29', '2026-02-30', '2026-13-01', '', '2026-11-18T00:00:00Z']) {
    expect(schema.safeParse({ name: 'Task', dueDate }).success).toBe(false)
  }
})

it('emits a neutral status variant for accepted prototype-member option names', () => {
  expect(statusVariantFor('constructor')).toBe('neutral')
  expect(statusVariantFor('hasownproperty')).toBe('neutral')
  const statusMap = evaluateFile('components/statusMap.ts').taskStatusMap
  expect(statusMap).toEqual({ open: 'info', constructor: 'neutral' })
})

it.each(['backend/tasks/page.tsx', 'backend/tasks/[id]/page.tsx'])('shows transport errors and recovers on the next read: %s', async (file) => {
  const failure = new Error('offline')
  apiCall.mockRejectedValueOnce(failure)
  const Page = page(file)
  await React.act(async () => root.render(<Page params={{ id: 'first' }} />))
  expect(container.textContent).toContain('Failed to load')
  expect(container.textContent).not.toContain('not found')
  expect(reportError).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'tasks', code: expect.stringMatching(/^tasks\.(list|detail)_load_failed$/) }))
  const record = { id: 'second', name: 'Task', dueDate: '2026-11-18' }
  apiCall.mockResolvedValue({ ok: true, result: { items: [record], total: 1, totalPages: 1 } })
  await React.act(async () => {
    if (file.endsWith('[id]/page.tsx')) root.render(<Page params={{ id: 'second' }} />)
    else tableProps!.onSearchChange('recovery')
  })
  expect(container.textContent).not.toContain('Failed to load')
  expect(container.textContent).toContain(file.endsWith('[id]/page.tsx') ? 'Form' : 'Table')
})

it.each(['backend/tasks/page.tsx', 'backend/tasks/[id]/page.tsx'])('ignores a rejected read after unmount: %s', async (file) => {
  let rejectRead: (error: Error) => void = () => { throw new Error('read not started') }
  apiCall.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
  const Page = page(file)
  await React.act(async () => root.render(<Page params={{ id: 'first' }} />))
  await React.act(async () => root.unmount())
  root = createRoot(container)
  await React.act(async () => rejectRead(new Error('late offline')))
  expect(reportError).not.toHaveBeenCalled()
})
