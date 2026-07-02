import fs from 'node:fs'
import path from 'node:path'
import { extractModuleFacts } from '../module-facts'

function findCoreSrcRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, 'packages', 'core', 'src', 'modules')
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate packages/core/src/modules from the test directory')
}

describe('module-facts customers fixture (T1 anti-drift guard)', () => {
  const coreSrcRoot = findCoreSrcRoot()
  const facts = extractModuleFacts({ moduleId: 'customers', coreSrcRoot })

  it('locks the source-derived customers entity surface in colon-form ids', () => {
    expect(facts.module).toBe('customers')
    expect(facts.entities).toHaveLength(25)
    expect(facts.entities.every((entity) => entity.id.startsWith('customers:'))).toBe(true)
    expect(facts.entities[0]).toMatchObject({ id: 'customers:customer_entity' })
    for (const entity of facts.entities) {
      expect(entity.class.length).toBeGreaterThan(0)
      expect(entity.table.length).toBeGreaterThan(0)
    }
  })

  it('locks customers events, acl, search, and notification surfaces', () => {
    expect(facts.events).toHaveLength(49)
    expect(facts.aclFeatures).toHaveLength(21)
    expect(facts.searchEntities).toEqual([
      'customers:customer_person_profile',
      'customers:customer_company_profile',
      'customers:customer_comment',
      'customers:customer_deal',
      'customers:customer_activity',
      'customers:customer_todo_link',
    ])
    expect(facts.notifications).toEqual(['customers.deal.won', 'customers.deal.lost'])
  })

  it('locks the real cli commands and host table ids, not the abbreviated spec example', () => {
    expect(facts.cli).toEqual([
      'seed-dictionaries',
      'seed-examples',
      'seed-stresstest',
      'interactions:backfill',
    ])
    expect(facts.hostTokens.tableIds).toEqual([
      'customers.companies.list',
      'customers.deals.list',
      'customers.people.list',
    ])
    expect(facts.hostTokens.entityIds).toEqual(['customers:customer_entity'])
    expect(facts.diTokens).toEqual([])
  })

  it('omits API route auth and warns when no module registry is provided', () => {
    expect(facts.apiRoutes).toEqual([])
    expect(facts.warnings.some((warning) => warning.includes('module registry unavailable'))).toBe(true)
  })

  it('locks the module metadata surface extracted from index.ts', () => {
    expect(facts.title).toBe('Customer Relationship Management')
    expect(facts.description).toBe('Core CRM capabilities for people, companies, deals, and activities.')
  })
})
