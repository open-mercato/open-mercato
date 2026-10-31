/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  IncidentRunbook,
  IncidentRunbookStep,
  IncidentSeverity,
  IncidentType,
} from '../data/entities'
import {
  buildRunbookActionItemDrafts,
  resolveRunbookForIncident,
} from '../commands/runbooks'

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TYPE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SEVERITY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const TYPE_RUNBOOK_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SEVERITY_RUNBOOK_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const EXPLICIT_RUNBOOK_ID = '11111111-1111-4111-8111-111111111111'
const STEP_ID = '22222222-2222-4222-8222-222222222222'

const scope = { organizationId: ORG_ID, tenantId: TENANT_ID }

function makeRunbook(id: string): IncidentRunbook {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    key: `runbook-${id}`,
    name: `Runbook ${id}`,
    description: null,
    isActive: true,
    createdAt: new Date('2026-07-03T08:00:00.000Z'),
    updatedAt: new Date('2026-07-03T08:00:00.000Z'),
    deletedAt: null,
  } as IncidentRunbook
}

function makeEntityManager(): EntityManager {
  const runbooks = new Map([
    [TYPE_RUNBOOK_ID, makeRunbook(TYPE_RUNBOOK_ID)],
    [SEVERITY_RUNBOOK_ID, makeRunbook(SEVERITY_RUNBOOK_ID)],
    [EXPLICIT_RUNBOOK_ID, makeRunbook(EXPLICIT_RUNBOOK_ID)],
  ])
  return {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === IncidentRunbook) return runbooks.get(where.id as string) ?? null
      if (entity === IncidentType) {
        return where.id === TYPE_ID
          ? ({ id: TYPE_ID, defaultRunbookId: TYPE_RUNBOOK_ID } as IncidentType)
          : null
      }
      if (entity === IncidentSeverity) {
        return where.id === SEVERITY_ID
          ? ({ id: SEVERITY_ID, defaultRunbookId: SEVERITY_RUNBOOK_ID } as IncidentSeverity)
          : null
      }
      return null
    }),
  } as unknown as EntityManager
}

describe('incident runbooks', () => {
  test('prefers explicit runbook over type and severity defaults', async () => {
    const em = makeEntityManager()

    await expect(resolveRunbookForIncident(
      em,
      scope,
      { incidentTypeId: TYPE_ID, severityId: SEVERITY_ID },
      EXPLICIT_RUNBOOK_ID,
    )).resolves.toMatchObject({ id: EXPLICIT_RUNBOOK_ID })
  })

  test('prefers incident type default over severity default', async () => {
    const em = makeEntityManager()

    await expect(resolveRunbookForIncident(
      em,
      scope,
      { incidentTypeId: TYPE_ID, severityId: SEVERITY_ID },
      null,
    )).resolves.toMatchObject({ id: TYPE_RUNBOOK_ID })
  })

  test('falls back to severity default when no type default is available', async () => {
    const em = makeEntityManager()

    await expect(resolveRunbookForIncident(
      em,
      scope,
      { incidentTypeId: null, severityId: SEVERITY_ID },
      null,
    )).resolves.toMatchObject({ id: SEVERITY_RUNBOOK_ID })
  })

  test('builds deterministic action item drafts from active steps', () => {
    const now = new Date('2026-07-03T08:00:00.000Z')
    const drafts = buildRunbookActionItemDrafts(
      makeRunbook(TYPE_RUNBOOK_ID),
      [{
        id: STEP_ID,
        title: 'Publish first update',
        description: ' Summarize impact. ',
        assigneeUserId: null,
        dueOffsetMinutes: 15,
      } as IncidentRunbookStep],
      now,
    )

    expect(drafts).toEqual([{
      title: 'Publish first update',
      description: 'Summarize impact.',
      assigneeUserId: null,
      dueAt: new Date('2026-07-03T08:15:00.000Z'),
      externalRef: `incident-runbook:${TYPE_RUNBOOK_ID}:step:${STEP_ID}`,
    }])
  })
})
