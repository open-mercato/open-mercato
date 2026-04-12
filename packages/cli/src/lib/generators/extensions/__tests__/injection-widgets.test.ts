import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleScanContext } from '../../extension'
import { createInjectionWidgetsExtension } from '../injection-widgets'
import { resolveFirstModuleFile, resolveModuleFile, type ModuleImports, type ModuleRoots } from '../../scanner'

let tmpDir: string

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'injection-widgets-extension-test-'))
}

function writeModuleFile(
  roots: ModuleRoots,
  location: 'app' | 'pkg',
  relativePath: string,
  content = 'export default null\n',
): void {
  const base = location === 'app' ? roots.appBase : roots.pkgBase
  const filePath = path.join(base, ...relativePath.split('/'))
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createContext(options: {
  moduleId: string
  roots: ModuleRoots
  imps: ModuleImports
  importIdRef?: { value: number }
}): ModuleScanContext {
  return {
    moduleId: options.moduleId,
    roots: options.roots,
    imps: options.imps,
    importIdRef: options.importIdRef ?? { value: 0 },
    sharedImports: [],
    resolveModuleFile,
    resolveFirstModuleFile,
    processStandaloneConfig: () => null,
    sanitizeGeneratedModuleSpecifier: (importPath: string) => importPath.replace(/\\/g, '/'),
  }
}

function createRoots(tmpDir: string, moduleId: string): { roots: ModuleRoots; imps: ModuleImports } {
  return {
    roots: {
      appBase: path.join(tmpDir, 'app', 'src', 'modules', moduleId),
      pkgBase: path.join(tmpDir, 'packages', 'core', 'src', 'modules', moduleId),
    },
    imps: {
      appBase: `@/modules/${moduleId}`,
      pkgBase: `@open-mercato/core/modules/${moduleId}`,
    },
  }
}

beforeEach(() => {
  tmpDir = createTmpDir()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('createInjectionWidgetsExtension', () => {
  it('prefers app widget files and emits sorted widget entries', () => {
    const { roots, imps } = createRoots(tmpDir, 'sales')
    writeModuleFile(roots, 'pkg', 'widgets/injection/sidebar/widget.tsx')
    writeModuleFile(roots, 'app', 'widgets/injection/sidebar/widget.tsx')
    writeModuleFile(roots, 'pkg', 'widgets/injection/z-panel/widget.tsx')
    writeModuleFile(roots, 'pkg', 'widgets/injection/a-panel/widget.tsx')

    const extension = createInjectionWidgetsExtension()
    extension.scanModule(createContext({ moduleId: 'sales', roots, imps }))

    const output = extension.generateOutput().get('injection-widgets.generated.ts')

    expect(output).toBeDefined()
    expect(output).toContain('export const injectionWidgetEntries: ModuleInjectionWidgetEntry[]')
    expect(output).toContain('key: "sales:a-panel:widget"')
    expect(output).toContain('key: "sales:sidebar:widget"')
    expect(output!.indexOf('key: "sales:a-panel:widget"')).toBeLessThan(
      output!.indexOf('key: "sales:sidebar:widget"'),
    )
    expect(output).toContain('source: "app"')
    expect(output).toContain('source: "package"')
    expect(output).toContain('import("@/modules/sales/widgets/injection/sidebar/widget")')
    expect(output).not.toContain('@open-mercato/core/modules/sales/widgets/injection/sidebar/widget')
  })

  it('emits injection tables with sanitized import names and app-first resolution', () => {
    const sharedImportIdRef = { value: 4 }

    const crmOps = createRoots(tmpDir, 'crm-ops')
    writeModuleFile(
      crmOps.roots,
      'pkg',
      'widgets/injection-table.ts',
      'export const injectionTable = { source: "package" }\n',
    )
    writeModuleFile(
      crmOps.roots,
      'app',
      'widgets/injection-table.ts',
      'export const injectionTable = { source: "app" }\n',
    )

    const billing = createRoots(tmpDir, 'billing')
    writeModuleFile(
      billing.roots,
      'pkg',
      'widgets/injection-table.ts',
      'export default { source: "package" }\n',
    )

    const extension = createInjectionWidgetsExtension()
    extension.scanModule(
      createContext({
        moduleId: 'crm-ops',
        roots: crmOps.roots,
        imps: crmOps.imps,
        importIdRef: sharedImportIdRef,
      }),
    )
    extension.scanModule(
      createContext({
        moduleId: 'billing',
        roots: billing.roots,
        imps: billing.imps,
        importIdRef: sharedImportIdRef,
      }),
    )

    const output = extension.generateOutput().get('injection-tables.generated.ts')

    expect(output).toBeDefined()
    expect(output).toContain('import * as InjTable_crm_ops_4 from "@/modules/crm-ops/widgets/injection-table"')
    expect(output).toContain('import * as InjTable_billing_5 from "@open-mercato/core/modules/billing/widgets/injection-table"')
    expect(output).not.toContain('@open-mercato/core/modules/crm-ops/widgets/injection-table')
    expect(output).toContain('moduleId: "crm-ops"')
    expect(output).toContain('moduleId: "billing"')
    expect(output).toContain('"default"')
    expect(output).toContain('"injectionTable"')
    expect(output).toContain('return {};')
    expect(output).toContain('as ModuleInjectionTable')
  })
})
