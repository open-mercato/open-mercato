import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GeneratedImportSpec } from '../ast'
import type { ModuleScanContext, StandaloneConfigOptions } from '../extension'
import { createInboxActionsExtension } from '../extensions/inbox-actions'
import {
  resolveFirstModuleFile,
  resolveModuleFile,
  type ModuleImports,
  type ModuleRoots,
} from '../scanner'
import { toVar } from '../../utils'

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-actions-extension-test-'))
}

function touchFile(filePath: string, content = 'export {}\n'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function createModuleContext(
  tmpDir: string,
  moduleId: string,
  calls: StandaloneConfigOptions[],
  importIdRef: { value: number },
): ModuleScanContext {
  const roots: ModuleRoots = {
    appBase: path.join(tmpDir, 'app', 'src', 'modules', moduleId),
    pkgBase: path.join(tmpDir, 'packages', 'core', 'src', 'modules', moduleId),
  }
  const imps: ModuleImports = {
    appBase: `@/modules/${moduleId}`,
    pkgBase: `@open-mercato/core/modules/${moduleId}`,
  }

  return {
    moduleId,
    roots,
    imps,
    importIdRef,
    sharedImports: [],
    resolveModuleFile,
    resolveFirstModuleFile,
    sanitizeGeneratedModuleSpecifier: (importPath: string) => importPath,
    processStandaloneConfig: (options: StandaloneConfigOptions) => {
      calls.push(options)

      const resolved = resolveModuleFile(options.roots, options.imps, options.relativePath)
      if (!resolved) {
        return null
      }

      const importName = `${options.prefix}_${toVar(options.modId)}_${options.importIdRef.value++}`
      const importSpec: GeneratedImportSpec = {
        namespaceImport: importName,
        moduleSpecifier: resolved.importPath,
      }

      ;(options.standaloneImports as GeneratedImportSpec[]).push(importSpec)

      if (options.sharedImports) {
        ;(options.sharedImports as GeneratedImportSpec[]).push(importSpec)
      }

      if (options.standaloneEntries && options.writeConfig) {
        options.standaloneEntries.push(options.writeConfig({ importName, moduleId: options.modId }))
      }

      return importName
    },
  }
}

describe('createInboxActionsExtension', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('scans inbox-actions.ts files via the standalone config helper', () => {
    const extension = createInboxActionsExtension()
    const calls: StandaloneConfigOptions[] = []
    const importIdRef = { value: 0 }
    const roots: ModuleRoots = {
      appBase: path.join(tmpDir, 'app', 'src', 'modules', 'orders'),
      pkgBase: path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'orders'),
    }

    touchFile(path.join(roots.pkgBase, 'inbox-actions.ts'))

    extension.scanModule(createModuleContext(tmpDir, 'orders', calls, importIdRef))

    expect(extension.id).toBe('registry.inbox-actions')
    expect(extension.outputFiles).toEqual(['inbox-actions.generated.ts'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.relativePath).toBe('inbox-actions.ts')
    expect(calls[0]?.prefix).toBe('INBOX_ACTIONS')
    expect(calls[0]?.modId).toBe('orders')
    expect(calls[0]?.writeConfig).toBeDefined()

    const output = extension.generateOutput().get('inbox-actions.generated.ts')
    expect(output).toBeDefined()
    const normalizedOutput = collapseWhitespace(output ?? '')

    expect(normalizedOutput).toContain('@open-mercato/core/modules/orders/inbox-actions')
    expect(normalizedOutput).toContain('moduleId: "orders"')
    expect(normalizedOutput).toContain('for (const key of [ "default", "inboxActions" ])')
  })

  it('generates filtered entries, flattened actions, and map-based helpers', () => {
    const extension = createInboxActionsExtension()
    const calls: StandaloneConfigOptions[] = []
    const importIdRef = { value: 0 }

    touchFile(path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'orders', 'inbox-actions.ts'))
    touchFile(path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'returns', 'inbox-actions.ts'))

    extension.scanModule(createModuleContext(tmpDir, 'orders', calls, importIdRef))
    extension.scanModule(createModuleContext(tmpDir, 'returns', calls, importIdRef))

    const output = extension.generateOutput().get('inbox-actions.generated.ts')
    expect(output).toBeDefined()
    const normalizedOutput = collapseWhitespace(output ?? '')

    expect(normalizedOutput).toContain('entries = entriesRaw.filter((entry) => entry.actions.length > 0)')
    expect(normalizedOutput).toContain('export const inboxActionConfigEntries = entries, inboxActions: InboxActionDefinition[] = entries.flatMap((entry) => entry.actions);')
    expect(normalizedOutput).toContain('const actionTypeMap = new Map(inboxActions.map((action) => [ action.type, action ]));')
    expect(normalizedOutput).toContain('return actionTypeMap.get(type);')
    expect(normalizedOutput).toContain('return Array.from(actionTypeMap.keys());')
    expect(normalizedOutput).toContain('@open-mercato/core/modules/orders/inbox-actions')
    expect(normalizedOutput).toContain('@open-mercato/core/modules/returns/inbox-actions')
    expect(normalizedOutput).toContain('moduleId: "orders"')
    expect(normalizedOutput).toContain('moduleId: "returns"')
  })
})
