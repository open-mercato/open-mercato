/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { listMergedTodoPage } from '../todoCompatibility'
import { createRecordingKysely, isCountQuery, type RecordedRows } from './recordingKysely'

jest.mock('../interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
  loadCustomerSummaries: jest.fn(async () => new Map()),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PERSON = '33333333-3333-4333-8333-333333333333'

function setup(rowsFor: RecordedRows) {
  const kysely = createRecordingKysely(rowsFor)
  const em = { getKysely: () => kysely.db, find: jest.fn(async () => []) }
  const queryEngine = { query: jest.fn(async () => ({ items: [] })) }
  const run = (options: { page: number; pageSize: number; entityId?: string }) =>
    listMergedTodoPage(
      em as unknown as EntityManager,
      queryEngine as unknown as QueryEngine,
      { resolve: jest.fn() },
      { tenantId: TENANT, orgId: ORG, sub: 'user-1' },
      ORG,
      [ORG],
      options,
    )
  return { run, em, queries: kysely.queries }
}

describe('listMergedTodoPage', () => {
  it('counts and pages both sources through the same scoped union, hiding bridged links and deleted tasks', async () => {
    const { run, queries } = setup((query) => (isCountQuery(query) ? [{ total: '120' }] : []))

    const result = await run({ page: 3, pageSize: 50, entityId: PERSON })

    expect(result).toEqual({ items: [], total: 120 })
    expect(queries.map(isCountQuery)).toEqual([true, false])
    for (const query of queries) {
      expect(query.sql).toContain('from "customer_todo_links" as "link"')
      expect(query.sql).toContain(
        'not exists (select "bridged"."id" from "customer_interactions" as "bridged" where "bridged"."id" = "link"."todo_id"',
      )
      expect(query.sql).toContain('"task"."deleted_at" is null')
      expect(query.sql).toContain('union all')
      expect(query.sql.match(/"(link|bridged|task)"\."tenant_id" = \$\d+/g)).toHaveLength(3)
      expect(query.sql.match(/"(link|bridged|task)"\."organization_id" in \(\$\d+\)/g)).toHaveLength(3)
      expect(query.sql.match(/"(link|bridged|task)"\."entity_id" = \$\d+/g)).toHaveLength(3)
      expect(query.parameters.filter((value) => value === TENANT)).toHaveLength(3)
      expect(query.parameters.filter((value) => value === ORG)).toHaveLength(3)
      expect(query.parameters.filter((value) => value === PERSON)).toHaveLength(3)
    }
    expect(queries[1].sql).toMatch(/order by "heads"\."created_at" desc, "heads"\."id" desc limit \$\d+ offset \$\d+$/)
    expect(queries[1].parameters.slice(-2)).toEqual([50, 100])
  })

  it('skips the page query and row reads when the page starts past the last task', async () => {
    const { run, em, queries } = setup(() => [{ total: 3 }])

    const result = await run({ page: 2, pageSize: 50 })

    expect(result).toEqual({ items: [], total: 3 })
    expect(queries.map(isCountQuery)).toEqual([true])
    expect(em.find).not.toHaveBeenCalled()
  })
})
