import fs from 'node:fs'
import path from 'node:path'
import { extractAllModuleFacts, MODULE_FACTS_ALLOWLIST } from '../module-facts'

function findCoreSrcRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, 'packages', 'core', 'src', 'modules')
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate packages/core/src/modules from the test directory')
}

function isUnique(values: string[]): boolean {
  return values.length === new Set(values).size
}

describe('module-facts BC resolve guard (T3)', () => {
  const coreSrcRoot = findCoreSrcRoot()
  const { factsByModule } = extractAllModuleFacts({ coreSrcRoot })

  it('emits facts for every allowlisted module', () => {
    expect(Object.keys(factsByModule).sort()).toEqual([...MODULE_FACTS_ALLOWLIST].sort())
  })

  for (const moduleId of MODULE_FACTS_ALLOWLIST) {
    describe(`${moduleId}`, () => {
      it('namespaces entity / event / acl / notification ids under the module and keeps them unique', () => {
        const facts = factsByModule[moduleId]
        const entityIds = facts.entities.map((entity) => entity.id)

        expect(entityIds.every((id) => id.startsWith(`${moduleId}:`))).toBe(true)
        expect(isUnique(entityIds)).toBe(true)
        expect(facts.events.every((event) => event.id.startsWith(`${moduleId}.`))).toBe(true)
        expect(isUnique(facts.events.map((event) => event.id))).toBe(true)
        expect(facts.aclFeatures.every((feature) => feature.startsWith(`${moduleId}.`))).toBe(true)
        expect(isUnique(facts.aclFeatures)).toBe(true)
        expect(facts.notifications.every((notification) => notification.startsWith(`${moduleId}.`))).toBe(true)
      })

      it('resolves search and host-token references against the module entity set', () => {
        const facts = factsByModule[moduleId]
        const entityIds = new Set(facts.entities.map((entity) => entity.id))

        for (const searchEntity of facts.searchEntities) {
          expect(entityIds.has(searchEntity)).toBe(true)
        }
        for (const hostEntityId of facts.hostTokens.entityIds) {
          expect(entityIds.has(hostEntityId)).toBe(true)
          expect(hostEntityId.endsWith('_entity')).toBe(true)
        }
      })
    })
  }
})
