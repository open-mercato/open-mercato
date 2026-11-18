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
    // 26 since the email conversation-share feature added
    // `CustomerEmailConversationShare` (the read grant backing owner-controlled
    // conversation sharing). Bump deliberately: this guard exists to make an
    // entity-surface change visible, not to be silenced.
    expect(facts.entities).toHaveLength(26)
    expect(facts.entities.every((entity) => entity.id.startsWith('customers:'))).toBe(true)
    expect(facts.entities[0]).toMatchObject({ id: 'customers:customer_entity' })
    for (const entity of facts.entities) {
      expect(entity.class.length).toBeGreaterThan(0)
      expect(entity.table.length).toBeGreaterThan(0)
    }
  })

  it('locks customers events, acl, search, and notification surfaces', () => {
    // 50 since #5114 added `customers.person.company_assignment.detached` — the profile-only
    // sibling of the person_company_link CRUD events. Bump deliberately: this guard exists to
    // make an event-surface change visible, not to be silenced.
    //
    // 51 since the email conversation-share feature added
    // `customers.email.conversation_visibility_changed` (audit trail for the
    // owner-controlled share/un-share act), and 22 ACL features since it added
    // `customers.email.share_conversation` (owner-scoped: it only ever lets you
    // share your OWN conversation, so the existing `customers.*` admin wildcard
    // grants no escalation).
    expect(facts.events).toHaveLength(51)
    expect(facts.aclFeatures).toHaveLength(22)
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
      'customers.todos.list',
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
