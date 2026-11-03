import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInjectionWidgetsExtension } from '../generators/extensions/injection-widgets'
import type { ModuleScanContext } from '../generators/extension'

// A widget's `metadata.id` and the `widgetId` that mounts it are two hand-typed literals in two
// different files. Nothing linked them, so a typo in either failed silently — the widget was never
// mounted, or the table entry resolved to nothing. These cases drive the real scan → generate seam
// (real filesystem fixtures, real AST extraction) and assert the reconciliation warnings.

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-injection-widgets-'))
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

function widgetSource(id: string): string {
  return [
    "import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'",
    "import Impl from './widget.client'",
    '',
    'const widget: InjectionWidgetModule = {',
    '  metadata: {',
    `    id: '${id}',`,
    "    title: 'Fixture widget',",
    '  },',
    '  Widget: Impl,',
    '}',
    '',
    'export default widget',
  ].join('\n')
}

function tableSource(widgetIds: string[]): string {
  const entries = widgetIds
    .map((id, index) => `  'detail:fixture:tab${index}': [{ widgetId: '${id}', kind: 'tab' }],`)
    .join('\n')
  return [
    "import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'",
    '',
    'export const injectionTable: ModuleInjectionTable = {',
    entries,
    '}',
    '',
    'export default injectionTable',
  ].join('\n')
}

/**
 * Lays out one module on disk in the shape the scanner expects and returns a scan context for it.
 * `declaredIds` each get `widgets/injection/<name>/widget.ts`; `referencedIds` go into the module's
 * `widgets/injection-table.ts` (omitted entirely when the list is empty).
 */
function makeModule(moduleId: string, declaredIds: string[], referencedIds: string[]): ModuleScanContext {
  const base = path.join(tmpRoot, moduleId)
  const injectionDir = path.join(base, 'widgets', 'injection')
  fs.mkdirSync(injectionDir, { recursive: true })

  declaredIds.forEach((id, index) => {
    const dir = path.join(injectionDir, `w${index}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'widget.ts'), widgetSource(id))
  })

  const tablePath = path.join(base, 'widgets', 'injection-table.ts')
  if (referencedIds.length > 0) fs.writeFileSync(tablePath, tableSource(referencedIds))

  const roots = { appBase: base, pkgBase: base }
  return {
    moduleId,
    roots,
    imps: { appBase: `@fixture/${moduleId}`, pkgBase: `@fixture/${moduleId}` },
    importIdRef: { value: 0 },
    sharedImports: [],
    resolveModuleFile: (() =>
      referencedIds.length > 0
        ? { absolutePath: tablePath, importPath: `@fixture/${moduleId}/widgets/injection-table` }
        : null) as unknown as ModuleScanContext['resolveModuleFile'],
    resolveFirstModuleFile: (() => null) as unknown as ModuleScanContext['resolveFirstModuleFile'],
    processStandaloneConfig: () => null,
    sanitizeGeneratedModuleSpecifier: (importPath: string) => importPath,
  }
}

function runGenerate(contexts: ModuleScanContext[]): string[] {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const extension = createInjectionWidgetsExtension()
  for (const ctx of contexts) extension.scanModule(ctx)
  extension.generateOutput()
  return warn.mock.calls.map((call) => String(call[0]))
}

describe('injection widget id reconciliation at generate time', () => {
  it('stays silent when every declared widget is referenced and vice versa', () => {
    const warnings = runGenerate([makeModule('alpha', ['alpha.one', 'alpha.two'], ['alpha.one', 'alpha.two'])])

    expect(warnings).toEqual([])
  })

  it('warns when an injection table references a widget id nothing declares', () => {
    const warnings = runGenerate([makeModule('alpha', ['alpha.one'], ['alpha.one', 'alpha.typo'])])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('alpha.typo')
    expect(warnings[0]).toContain('references widget id')
    expect(warnings[0]).toContain('alpha')
  })

  it('stays silent about a declared widget that no table references', () => {
    // The mirror check is deliberately not implemented: `extractInjectionTableWidgetIds` reads only
    // statically-analyzable literals, so a table built by composition or computation exposes no ids
    // and every widget in such a module would be reported as unreferenced. Pinned so the omission is
    // a decision rather than an oversight.
    const warnings = runGenerate([makeModule('alpha', ['alpha.one', 'alpha.orphan'], ['alpha.one'])])

    expect(warnings).toEqual([])
  })

  it('reports only the unresolvable reference when the two sides disagree entirely', () => {
    const warnings = runGenerate([makeModule('alpha', ['alpha.declared'], ['alpha.referenced'])])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('alpha.referenced')
  })

  it('does not warn about a table assembled by composition, whose ids are invisible statically', () => {
    // Mirrors the real `example` module: `cond ? { ...a, ...b } : a`. The extractor sees no ids, so
    // there is nothing to reconcile — and critically, no false warning.
    const base = path.join(tmpRoot, 'composed')
    fs.mkdirSync(path.join(base, 'widgets', 'injection', 'w0'), { recursive: true })
    fs.writeFileSync(path.join(base, 'widgets', 'injection', 'w0', 'widget.ts'), widgetSource('composed.one'))
    const tablePath = path.join(base, 'widgets', 'injection-table.ts')
    fs.writeFileSync(
      tablePath,
      [
        "import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'",
        "const a: ModuleInjectionTable = { 'detail:x:tab': [{ widgetId: 'composed.one' }] }",
        "const b: ModuleInjectionTable = { 'detail:y:tab': [{ widgetId: 'composed.two' }] }",
        'export const injectionTable: ModuleInjectionTable = process.env.FLAG ? { ...a, ...b } : a',
        'export default injectionTable',
      ].join('\n'),
    )

    const ctx: ModuleScanContext = {
      ...makeModule('composed', [], []),
      resolveModuleFile: (() => ({
        absolutePath: tablePath,
        importPath: '@fixture/composed/widgets/injection-table',
      })) as unknown as ModuleScanContext['resolveModuleFile'],
    }

    expect(runGenerate([ctx])).toEqual([])
  })

  it('accepts a table in one module referencing a widget declared in another', () => {
    const warnings = runGenerate([
      makeModule('alpha', ['alpha.shared'], []),
      makeModule('beta', [], ['alpha.shared']),
    ])

    expect(warnings).toEqual([])
  })

  it('does not warn for the single-widget id inference', () => {
    // A lone widget whose metadata.id cannot be extracted adopts the table's single id; that
    // convenience path must not then report itself as a mismatch.
    const ctx = makeModule('gamma', [], ['gamma.inferred'])
    const dir = path.join(tmpRoot, 'gamma', 'widgets', 'injection', 'solo')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'widget.ts'), 'export default { Widget: () => null }\n')

    expect(runGenerate([ctx])).toEqual([])
  })

  it('stays silent for a module with no injection widgets and no table', () => {
    expect(runGenerate([makeModule('delta', [], [])])).toEqual([])
  })
})
