import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractModuleFacts } from '../module-facts'

let tmpRoot: string

function writeModuleFile(moduleId: string, relativePath: string, content: string): void {
  const fullPath = path.join(tmpRoot, moduleId, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content)
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'module-facts-malformed-'))
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('module-facts malformed source handling (T4)', () => {
  it('returns empty sections plus warnings (never throws) for malformed convention files', () => {
    writeModuleFile('broken', 'data/entities.ts', 'export const notAnEntity = 1\nexport class LooseClass {}\n')
    writeModuleFile('broken', 'search.ts', 'export const unrelatedConfig = { entities: [] }\n')
    writeModuleFile('broken', 'notifications.ts', 'export const notifications = "not-an-array"\n')
    writeModuleFile('broken', 'cli.ts', 'export const commands = []\n')

    const run = (): ReturnType<typeof extractModuleFacts> =>
      extractModuleFacts({ moduleId: 'broken', coreSrcRoot: tmpRoot })
    expect(run).not.toThrow()

    const facts = run()
    expect(facts.entities).toEqual([])
    expect(facts.events).toEqual([])
    expect(facts.aclFeatures).toEqual([])
    expect(facts.searchEntities).toEqual([])
    expect(facts.notifications).toEqual([])
    expect(facts.cli).toEqual([])
    expect(facts.apiRoutes).toEqual([])

    const warnings = facts.warnings.join('\n')
    expect(warnings).toContain('search.ts present but no searchConfig')
    expect(warnings).toContain('notifications.ts present but no notificationTypes array')
    expect(warnings).toContain('cli.ts present but no default export')
    expect(warnings).toContain('module registry unavailable')
  })

  it('survives a syntactically broken source file without throwing', () => {
    writeModuleFile('broken', 'search.ts', 'export const searchConfig = { entities: [ this is not valid typescript\n')

    const run = (): ReturnType<typeof extractModuleFacts> =>
      extractModuleFacts({ moduleId: 'broken', coreSrcRoot: tmpRoot })
    expect(run).not.toThrow()
    expect(run().searchEntities).toEqual([])
  })

  it('returns all-empty facts (never throws) for a module with no convention files', () => {
    fs.mkdirSync(path.join(tmpRoot, 'empty'), { recursive: true })

    const run = (): ReturnType<typeof extractModuleFacts> =>
      extractModuleFacts({ moduleId: 'empty', coreSrcRoot: tmpRoot })
    expect(run).not.toThrow()

    expect(run()).toMatchObject({
      module: 'empty',
      entities: [],
      events: [],
      aclFeatures: [],
      searchEntities: [],
      notifications: [],
      cli: [],
      diTokens: [],
    })
  })
})
