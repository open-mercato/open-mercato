import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateWritableAstOracle } from '../../agentic/shared/ai/harness/writable-ast-oracles.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript-standalone') as typeof import('typescript-standalone')
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const tableFile = 'src/modules/library/components/Books.tsx'
const pageFile = 'src/modules/library/backend/books/page.tsx'

function table(binding: string, local = '', alias = 'DataTable') {
  return `import { DataTable${alias === 'DataTable' ? '' : ` as ${alias}`} } from '@open-mercato/ui/backend/DataTable'
${local}
export function Books() { return <${alias} columns={[]} data={[]} perspective={${binding}} /> }
`
}

function fixture(source: string, run: (root: string) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-table-binding-')))
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.symlinkSync(path.dirname(require.resolve('typescript-standalone/package.json')), path.join(root, 'node_modules/typescript'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"table-binding-contract","private":true,"type":"module"}')
  for (const [relative, content] of [[pageFile, "import { Books } from '../../components/Books'\nexport default function Page() { return <Books /> }"], [tableFile, source]]) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    fs.writeFileSync(path.join(root, relative), content)
  }
  try { run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function tableCheck(root: string) {
  const result = evaluateWritableAstOracle({ root, caseId: 'OMH-014', phase: 'before' }) as { checks: Array<{ id: string; passed: boolean }> }
  return result.checks.find(entry => entry.id === 'ui.table')?.passed
}

function typedTableDiagnostics(root: string) {
  const config = ts.readConfigFile(path.join(repository, 'tsconfig.base.json'), ts.sys.readFile)
  assert.equal(config.error, undefined)
  const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, repository).options
  const program = ts.createProgram([path.join(root, tableFile)], {
    ...options, noEmit: true, incremental: false, composite: false, skipLibCheck: true, jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  const modules = path.join(root, 'src/modules')
  return ts.getPreEmitDiagnostics(program).filter(entry => {
    if (!entry.file) return false
    const relative = path.relative(modules, entry.file.fileName)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  })
}

for (const [label, source] of [
  ['literal perspective', table("{ tableId: 'library.books' }")],
  ['local constant', table('perspective', "const perspective = { tableId: 'library.books' }")],
  ['component alias', table("{ tableId: 'library.books' }", '', 'BooksDataTable')],
] as const) {
  test(`a connected real DataTable accepts ${label}`, () => fixture(source, root => assert.equal(tableCheck(root), true)))
}

test('the actual DataTable type accepts perspective.tableId and rejects a non-string identifier', () => {
  fixture(table("{ tableId: 'library.books' }"), root => assert.deepEqual(typedTableDiagnostics(root).map(entry => ts.flattenDiagnosticMessageText(entry.messageText, '\n')), []))
  fixture(table('{ tableId: 42 }'), root => assert.ok(typedTableDiagnostics(root).length > 0))
})

test('canonical imported extension-point declarations supply the rendered perspective identifier', () => fixture(table('{ tableId: extensionPoints.hosts.books.tableId }', "import extensionPoints from '../extension-points'"), root => {
  fs.writeFileSync(path.join(root, 'src/modules/library/extension-points.ts'), `import { defineModuleExtensionPoints, dataTableExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'
export const extensionPoints = defineModuleExtensionPoints({ moduleId: 'library', hosts: { books: dataTableExtensionHost({ tableId: 'library.books', source: 'components/Books.tsx' }) } })
export default extensionPoints
`)
  assert.deepEqual(typedTableDiagnostics(root).map(entry => ts.flattenDiagnosticMessageText(entry.messageText, '\n')), [])
  assert.equal(tableCheck(root), true)
}))

test('ordinary UI guidance describes both runtime-supported explicit host bindings', () => {
  for (const relative of ['packages/create-app/agentic/guides/backend-ui.md', 'packages/create-app/agentic/shared/ai/skills/om-backend-ui-design/references/crud-surfaces.md']) {
    const source = fs.readFileSync(path.join(repository, relative), 'utf8')
    assert.match(source, /extensionTableId/)
    assert.match(source, /perspective\.tableId/)
  }
})

for (const [label, source] of [
  ['empty identifier', table("{ tableId: '' }")],
  ['null identifier', table('{ tableId: null }')],
  ['missing identifier', table('{}')],
  ['null perspective', table('null')],
  ['unknown factory', table('makePerspective()', "function makePerspective() { return { tableId: 'library.books' } }")],
  ['wrong component', table("{ tableId: 'library.books' }").replace('@open-mercato/ui/backend/DataTable', './local-table')],
  ['type-only component', table("{ tableId: 'library.books' }").replace('import { DataTable }', 'import type { DataTable }')],
  ['spread overriding perspective', table("{ tableId: 'library.books' }").replace(' />', ' {...{ perspective: null }} />')],
  ['unbound object', "const perspective = { tableId: 'library.books' }; export function Books() { return <div /> }"],
  ['dead render helper', table("{ tableId: 'library.books' }").replace('export function Books()', 'function Unused()') + '\nexport function Books() { return <div /> }'],
  ['mutable local shadow of an inert constant', table('perspective', "const perspective = { tableId: 'library.books' }").replace('Books() {', 'Books() { let perspective = null;')],
] as const) {
  test(`perspective binding rejects ${label}`, () => fixture(source, root => {
    fs.writeFileSync(path.join(root, 'src/modules/library/components/local-table.tsx'), 'export function DataTable(_props: unknown) { return <div /> }')
    assert.equal(tableCheck(root), false)
  }))
}

test('an orphan valid table component is not a rendered table binding', () => fixture(table("{ tableId: 'library.books' }"), root => {
  fs.writeFileSync(path.join(root, pageFile), 'export default function Page() { return <div /> }')
  assert.equal(tableCheck(root), false)
}))

test('arbitrary helper factories and out-of-module or oversized metadata cannot supply a table identifier', () => {
  for (const [specifier, metadata] of [
    ['../extension-points', "import { injectionExtensionHost as defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'; export default defineModuleExtensionPoints({ tableId: 'library.books' })"],
    ['../../../outside', "export default { tableId: 'library.books' }"],
    ['../extension-points', '// oversized\n' + ' '.repeat(512 * 1024)],
  ]) {
    fixture(table('perspective', `import perspective from '${specifier}'`), root => {
      fs.writeFileSync(path.join(root, 'src/modules/library/extension-points.ts'), metadata)
      assert.equal(tableCheck(root), false)
    })
  }
})

for (const [label, shadow, parameters] of [
  ['let', 'let dataTableExtensionHost = (value: unknown) => value', ''],
  ['var', 'var dataTableExtensionHost = (value: unknown) => value', ''],
  ['function', 'function dataTableExtensionHost(value: unknown) { return value }', ''],
  ['destructured parameter', '', '{ nested: { dataTableExtensionHost } }: { nested: { dataTableExtensionHost: (value: unknown) => unknown } }'],
  ['array parameter', '', '[dataTableExtensionHost]: [(value: unknown) => unknown]'],
] as const) {
  test(`a ${label} shadow cannot impersonate the SDK table host factory`, () => {
    const source = `import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { dataTableExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'
export function Books(${parameters}) { ${shadow}; const host = dataTableExtensionHost({ tableId: 'library.books', source: 'components/Books.tsx' }); return <DataTable columns={[]} data={[]} perspective={host} /> }
`
    fixture(source, root => assert.equal(tableCheck(root), false))
  })
}

test('typed table controls include errors in imported fixture extension-point declarations', () => fixture(table('perspective', "import perspective from '../extension-points'"), root => {
  fs.writeFileSync(path.join(root, 'src/modules/library/extension-points.ts'), "export const invalid: string = 42; export default { tableId: 'library.books' }\n")
  assert.ok(typedTableDiagnostics(root).some(entry => entry.file?.fileName.endsWith('extension-points.ts')))
}))
