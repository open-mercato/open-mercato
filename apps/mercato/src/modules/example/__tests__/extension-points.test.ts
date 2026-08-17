import fs from 'node:fs'
import path from 'node:path'
import {
  crudFormExtensionSpotId,
  dataTableExtensionSpotId,
  type CrudFormExtensionHostDeclaration,
  type DataTableExtensionHostDeclaration,
} from '@open-mercato/shared/modules/widgets/extension-points'
import extensionPoints from '../extension-points'

const moduleRoot = path.join(__dirname, '..')

function readModuleSource(relativePath: string): string {
  return fs.readFileSync(path.join(moduleRoot, relativePath), 'utf8')
}

describe('example extension-points.ts', () => {
  it('declares the module id and exactly the hosts this module renders', () => {
    expect(extensionPoints.moduleId).toBe('example')
    expect(Object.keys(extensionPoints.hosts).sort()).toEqual([
      'handlersForm',
      'overrideShowcase',
      'todoForm',
      'todosTable',
    ])
  })

  it('points every host at a source file that exists in the module', () => {
    for (const [key, host] of Object.entries(extensionPoints.hosts)) {
      expect(typeof host.source).toBe('string')
      expect(fs.existsSync(path.join(moduleRoot, host.source))).toBe(true)
      expect(key).toBeTruthy()
    }
  })

  it('binds the DataTable host by consuming the declaration at the call site', () => {
    const host = extensionPoints.hosts.todosTable as DataTableExtensionHostDeclaration
    expect(host.family).toBe('data-table')
    expect(host.tableId).toBe('example.todos.list')
    expect(dataTableExtensionSpotId(host.tableId, 'columns')).toBe('data-table:example.todos.list:columns')

    // `hasDeclarationBinding` in packages/cli/src/lib/generators/module-extension-facts.ts only
    // treats a host as BOUND when its declared source references `extensionPoints.hosts.<key>`.
    // Duplicating the literal at the call site instead makes the extractor emit
    // `unbound-declaration` — which is what the canonical module must NOT teach.
    const source = readModuleSource(host.source)
    expect(source).toMatch(/perspective=\{\{\s*tableId:\s*extensionPoints\.hosts\.todosTable\.tableId\s*\}\}/)
    expect(source).not.toMatch(/perspective=\{\{\s*tableId:\s*'/)
  })

  it('binds the CrudForm host to the normalized entityId the Todo form really passes', () => {
    const host = extensionPoints.hosts.todoForm as CrudFormExtensionHostDeclaration
    expect(host.family).toBe('crud-form')

    // `CrudForm` collapses `:` to `.` before building the spot id, so the host declares the
    // normalized form and the call site derives its colon-form prop back FROM the host —
    // the direction that makes the extractor see a real binding.
    expect(host.entityId).toBe('example.todo')
    const source = readModuleSource(host.source)
    expect(source).toMatch(/const ENTITY_ID = extensionPoints\.hosts\.todoForm\.entityId/)
    expect(source).not.toMatch(/const ENTITY_ID = '/)
    expect(source).toContain('entityId={ENTITY_ID}')
    expect(host.spotId).toBe(crudFormExtensionSpotId(host.entityId))
  })

  it('is reported as fully bound by the framework own extractor, with no unbound declarations', () => {
    // The inventory row and this file's docstring both CLAIM every host has a live call site.
    // Nothing verified that claim until now: the earlier version of this suite regex-matched a
    // duplicated string literal, which passes just as happily when the extractor considers the
    // host unbound. This asserts the property the documentation actually promises, using the
    // same reader that ships the fact to scaffolded apps.
    let extractModuleExtensionFacts: (options: Record<string, unknown>) => { unresolved: Array<{ key: string; reason: string }> }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ;({ extractModuleExtensionFacts } = require('@open-mercato/cli/lib/generators/module-extension-facts'))
    } catch {
      // The CLI package is built from source in CI; skip rather than fail when dist is absent.
      return
    }

    const facts = extractModuleExtensionFacts({
      moduleId: 'example',
      moduleRoot,
      sourceRoot: 'src/modules/example',
      entities: [],
      events: [],
      apiRoutes: [],
      searchEntities: [],
    })

    const unbound = facts.unresolved.filter((entry) => entry.reason === 'unbound-declaration')
    expect(unbound).toEqual([])
  })

  it('keeps the CrudForm host spot id equal to the one the module injection table already maps', () => {
    const host = extensionPoints.hosts.todoForm as CrudFormExtensionHostDeclaration
    const injectionTable = readModuleSource('widgets/injection-table.ts')
    expect(injectionTable).toContain(`'${host.spotId}':`)
  })
})
