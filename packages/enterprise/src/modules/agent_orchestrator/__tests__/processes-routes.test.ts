/** @jest-environment node */
import { GET as getProcessDetail, metadata as detailMetadata } from '../api/processes/[id]/route'
import { metadata as listMetadata } from '../api/processes/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PROCESS = '33333333-3333-4333-8333-333333333333'
const ROW_ID = '55555555-5555-4555-8555-555555555555'

const ROW = {
  id: ROW_ID,
  processId: PROCESS,
  tenantId: TENANT,
  organizationId: ORG,
  subjectLabel: 'CLM-2026-04417',
  subjectTitle: 'Motor collision — payout adjudication',
  status: 'waiting_on_you',
}

function makeRequest(id: string) {
  return new Request(`http://localhost/api/agent_orchestrator/processes/${id}`)
}

async function setup(rowByProcessId: unknown, rowById: unknown = null) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user', tenantId: TENANT, orgId: ORG })
  ;(findOneWithDecryption as jest.Mock).mockImplementation(
    async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
      if ('processId' in where) return rowByProcessId
      return rowById
    },
  )
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => (token === 'em' ? { fork: () => ({}) } : null),
  })
  return { findOneWithDecryption: findOneWithDecryption as jest.Mock }
}

describe('processes routes — ACL gates', () => {
  it('list and detail are gated by agent_orchestrator.processes.view', () => {
    expect(listMetadata.GET.requireFeatures).toEqual(['agent_orchestrator.processes.view'])
    expect(detailMetadata.GET.requireFeatures).toEqual(['agent_orchestrator.processes.view'])
    expect(listMetadata.GET.requireAuth).toBe(true)
    expect(detailMetadata.GET.requireAuth).toBe(true)
  })
})

describe('GET /api/agent_orchestrator/processes/:id', () => {
  beforeEach(() => jest.clearAllMocks())

  it('resolves by workflow processId (the id runs/proposals carry)', async () => {
    const { findOneWithDecryption } = await setup(ROW)
    const res = await getProcessDetail(makeRequest(PROCESS), {
      params: Promise.resolve({ id: PROCESS }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.process).toMatchObject({ processId: PROCESS, subjectLabel: 'CLM-2026-04417' })
    expect(findOneWithDecryption.mock.calls[0][2]).toMatchObject({
      processId: PROCESS,
      tenantId: TENANT,
      deletedAt: null,
    })
  })

  it('falls back to the projection row id', async () => {
    await setup(null, ROW)
    const res = await getProcessDetail(makeRequest(ROW_ID), {
      params: Promise.resolve({ id: ROW_ID }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.process).toMatchObject({ id: ROW_ID })
  })

  it('returns 404 (never the row) when the scoped lookup finds nothing — cross-org safe', async () => {
    await setup(null, null)
    const res = await getProcessDetail(makeRequest(PROCESS), {
      params: Promise.resolve({ id: PROCESS }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'Process not found' })
  })

  it('rejects non-uuid ids with 404 before touching the database', async () => {
    const { findOneWithDecryption } = await setup(ROW)
    const res = await getProcessDetail(makeRequest('not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    })
    expect(res.status).toBe(404)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })
})
