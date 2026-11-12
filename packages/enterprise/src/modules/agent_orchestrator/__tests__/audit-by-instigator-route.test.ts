/** @jest-environment node */
import { GET } from '../api/audit/by-instigator/[humanUserId]/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const HUMAN = '44444444-4444-4444-8444-444444444444'
const AGENT_USER = '55555555-5555-4555-8555-555555555555'
const OTHER_HUMAN = '66666666-6666-4666-8666-666666666666'

type Row = {
  id: string
  command_id: string | null
  action_type: string | null
  action_label: string | null
  source_key: string | null
  resource_kind: string | null
  resource_id: string | null
  actor_user_id: string | null
  on_behalf_of_user_id: string | null
  created_at: Date
  tenant_id: string | null
  organization_id: string | null
  deleted_at: Date | null
}

/**
 * Minimal in-memory kysely fake for `action_logs`: it records the where-predicates
 * the route applies (equality + the actor/obo OR group) and filters the seeded rows
 * accordingly, so the test exercises the route's real org-scope + direct/via-agent
 * union logic without a database.
 */
function createKyselyFake(rows: Row[]) {
  type Pred = (row: Row) => boolean
  const preds: Pred[] = []

  const expressionBuilder = {
    or(list: Pred[]): Pred {
      return (row: Row) => list.some((fn) => fn(row))
    },
    and(list: Pred[]): Pred {
      return (row: Row) => list.every((fn) => fn(row))
    },
  }

  function makeColumnPred(column: string, op: string, value: unknown): Pred {
    const key = column.replace('action_logs.', '') as keyof Row
    return (row: Row) => {
      const cell = row[key]
      if (op === 'is') return cell === null
      if (op === '=') return cell === value
      return false
    }
  }

  const builder: Record<string, unknown> = {
    selectFrom() {
      return builder
    },
    select() {
      return builder
    },
    where(arg: unknown, op?: string, value?: unknown): unknown {
      if (typeof arg === 'function') {
        const eb = (column: string, innerOp: string, innerValue: unknown) =>
          makeColumnPred(column, innerOp, innerValue)
        ;(eb as Record<string, unknown>).or = expressionBuilder.or
        ;(eb as Record<string, unknown>).and = expressionBuilder.and
        preds.push((arg as (b: typeof eb) => Pred)(eb as never))
      } else {
        preds.push(makeColumnPred(arg as string, op as string, value))
      }
      return builder
    },
    orderBy() {
      return builder
    },
    limit() {
      return builder
    },
    async execute() {
      const matched = rows.filter((row) => preds.every((fn) => fn(row)))
      return matched.map((row) => ({
        id: row.id,
        commandId: row.command_id,
        actionType: row.action_type,
        actionLabel: row.action_label,
        sourceKey: row.source_key,
        resourceKind: row.resource_kind,
        resourceId: row.resource_id,
        actorUserId: row.actor_user_id,
        onBehalfOfUserId: row.on_behalf_of_user_id,
        createdAt: row.created_at,
      }))
    },
  }
  return builder
}

function seedRow(overrides: Partial<Row>): Row {
  return {
    id: 'row-1',
    command_id: 'customers.update_deal',
    action_type: 'edit',
    action_label: 'Update deal',
    source_key: 'ui',
    resource_kind: 'deal',
    resource_id: 'deal-1',
    actor_user_id: HUMAN,
    on_behalf_of_user_id: null,
    created_at: new Date('2026-06-25T10:00:00.000Z'),
    tenant_id: TENANT_A,
    organization_id: ORG_A,
    deleted_at: null,
    ...overrides,
  }
}

async function setup(rows: Row[]) {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const kysely = createKyselyFake(rows)
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'em') return { fork: () => ({ getKysely: () => kysely }) }
      return null
    },
  })
}

function makeRequest() {
  return new Request(`http://localhost/api/agent_orchestrator/audit/by-instigator/${HUMAN}`, { method: 'GET' })
}

const params = Promise.resolve({ humanUserId: HUMAN })

describe('GET /api/agent_orchestrator/audit/by-instigator/:humanUserId', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns actions a human caused directly AND via agents, tagged accordingly', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: HUMAN, tenantId: TENANT_A, orgId: ORG_A })

    await setup([
      // direct: human is the actor
      seedRow({ id: 'direct-1', actor_user_id: HUMAN, on_behalf_of_user_id: null }),
      // via-agent: agent is the actor, human is on-behalf-of, source agent
      seedRow({
        id: 'agent-1',
        actor_user_id: AGENT_USER,
        on_behalf_of_user_id: HUMAN,
        source_key: 'agent',
      }),
      // unrelated: another human's direct action — must NOT appear
      seedRow({ id: 'other-1', actor_user_id: OTHER_HUMAN, on_behalf_of_user_id: null }),
    ])

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.humanUserId).toBe(HUMAN)
    const ids = body.items.map((i: { id: string }) => i.id).sort()
    expect(ids).toEqual(['agent-1', 'direct-1'])

    const direct = body.items.find((i: { id: string }) => i.id === 'direct-1')
    const viaAgent = body.items.find((i: { id: string }) => i.id === 'agent-1')
    expect(direct.via).toBe('direct')
    expect(viaAgent.via).toBe('via_agent')
    expect(viaAgent.actorUserId).toBe(AGENT_USER)
    expect(viaAgent.onBehalfOfUserId).toBe(HUMAN)
    expect(viaAgent.sourceKey).toBe('agent')
  })

  it('is org-scoped: a row in another org for the same human is excluded (tenant isolation)', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    // Caller authenticated in org A.
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: HUMAN, tenantId: TENANT_A, orgId: ORG_A })

    await setup([
      seedRow({ id: 'orgA-direct', organization_id: ORG_A, actor_user_id: HUMAN }),
      // Same human appears on an org-B row — must be filtered out by org scope.
      seedRow({ id: 'orgB-agent', organization_id: ORG_B, actor_user_id: AGENT_USER, on_behalf_of_user_id: HUMAN }),
    ])

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.items.map((i: { id: string }) => i.id)
    expect(ids).toEqual(['orgA-direct'])
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 404 for an invalid (non-uuid) human user id', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: HUMAN, tenantId: TENANT_A, orgId: ORG_A })
    await setup([])

    const res = await GET(makeRequest(), { params: Promise.resolve({ humanUserId: 'not-a-uuid' }) })
    expect(res.status).toBe(404)
  })
})
