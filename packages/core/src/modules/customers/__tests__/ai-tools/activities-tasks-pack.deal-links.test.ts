/**
 * #6119 — `customers.manage_deal_comment` and `customers.manage_deal_activity`
 * must resolve the deal's timeline owner through the deal link tables, using
 * the relation names the entities actually define (`person`, `company`).
 */
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock(
  '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner',
  () => {
    const actual = jest.requireActual(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner',
    )
    return {
      ...actual,
      createAiApiOperationRunner: (...args: unknown[]) => createRunnerMock(...args),
    }
  },
)

import activitiesTasksAiTools from '../../ai-tools/activities-tasks-pack'
import { CustomerDealCompanyLink, CustomerDealPersonLink } from '../../data/entities'
import { makeCtx } from './shared'

const DEAL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PERSON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COMPANY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const DEAL = {
  id: DEAL_ID,
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  title: 'Big deal',
  updatedAt: new Date('2026-09-01T10:00:00Z'),
}

function findTool(name: string) {
  const tool = activitiesTasksAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

function makeDealCtx(links: { person?: unknown; company?: unknown }) {
  const ctx = makeCtx()
  const em = ctx.em as unknown as Record<string, jest.Mock>
  em.findOne = jest.fn(async (entity: unknown) => {
    if (entity === CustomerDealPersonLink) return links.person ?? null
    if (entity === CustomerDealCompanyLink) return links.company ?? null
    return null
  })
  return ctx
}

function runnerBody(): Record<string, unknown> {
  expect(runMock).toHaveBeenCalledTimes(1)
  return (runMock.mock.calls[0][0] as { body: Record<string, unknown> }).body
}

beforeEach(() => {
  findOneWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockReset()
  runMock.mockReset()
  createRunnerMock.mockClear()
  findOneWithDecryptionMock.mockResolvedValue(DEAL)
  runMock.mockResolvedValue({ success: true, statusCode: 201, data: { id: 'created-1' } })
})

describe('customers.manage_deal_comment — timeline owner from the deal links (#6119)', () => {
  const tool = findTool('customers.manage_deal_comment')

  it('populates the `person` relation and posts the comment on the linked person', async () => {
    // Before #6119 the populate hint was `personEntity`, which the entity does
    // not define, so MikroORM rejected the lookup for every deal.
    const ctx = makeDealCtx({ person: { id: 'link-1', person: { id: PERSON_ID } } })

    const result = (await tool.handler(
      { operation: 'create', dealId: DEAL_ID, body: 'Called back, they want a quote.' },
      ctx as any,
    )) as Record<string, unknown>

    const em = ctx.em as unknown as { findOne: jest.Mock }
    expect(em.findOne).toHaveBeenCalledWith(
      CustomerDealPersonLink,
      { deal: DEAL_ID, tenantId: 'tenant-1' },
      { populate: ['person'] },
    )
    expect(runnerBody()).toMatchObject({ dealId: DEAL_ID, entityId: PERSON_ID })
    expect(result.commentId).toBe('created-1')
  })

  it('falls back to the `company` relation when no person is linked', async () => {
    const ctx = makeDealCtx({ company: { id: 'link-2', company: { id: COMPANY_ID } } })

    await tool.handler({ operation: 'create', dealId: DEAL_ID, body: 'note' }, ctx as any)

    const em = ctx.em as unknown as { findOne: jest.Mock }
    expect(em.findOne).toHaveBeenCalledWith(
      CustomerDealCompanyLink,
      { deal: DEAL_ID, tenantId: 'tenant-1' },
      { populate: ['company'] },
    )
    expect(runnerBody().entityId).toBe(COMPANY_ID)
  })

  it('accepts an unpopulated foreign key on the link row', async () => {
    const ctx = makeDealCtx({ person: { id: 'link-1', person: PERSON_ID } })

    await tool.handler({ operation: 'create', dealId: DEAL_ID, body: 'note' }, ctx as any)

    expect(runnerBody().entityId).toBe(PERSON_ID)
  })

  it('tells the operator to link a contact when the deal has none', async () => {
    const ctx = makeDealCtx({})

    await expect(
      tool.handler({ operation: 'create', dealId: DEAL_ID, body: 'note' }, ctx as any),
    ).rejects.toThrow(/has no linked person or company/)
    expect(runMock).not.toHaveBeenCalled()
  })
})

describe('customers.manage_deal_activity — timeline owner from the deal links (#6119)', () => {
  const tool = findTool('customers.manage_deal_activity')

  it('resolves the linked person instead of reading a non-existent deal.entity', async () => {
    // Before #6119 the handler read `deal.entity`, a field `CustomerDeal` does
    // not have, and threw "has no associated person/company" for every deal.
    const ctx = makeDealCtx({ person: { id: 'link-1', person: { id: PERSON_ID } } })

    const result = (await tool.handler(
      { operation: 'create', dealId: DEAL_ID, activityType: 'call', subject: 'Follow-up call' },
      ctx as any,
    )) as Record<string, unknown>

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/customers/activities' }),
    )
    expect(runnerBody()).toMatchObject({
      dealId: DEAL_ID,
      entityId: PERSON_ID,
      activityType: 'call',
      subject: 'Follow-up call',
    })
    expect(result.activityId).toBe('created-1')
  })

  it('falls back to the linked company', async () => {
    const ctx = makeDealCtx({ company: { id: 'link-2', company: { id: COMPANY_ID } } })

    await tool.handler(
      { operation: 'create', dealId: DEAL_ID, activityType: 'meeting' },
      ctx as any,
    )

    expect(runnerBody().entityId).toBe(COMPANY_ID)
  })

  it('tells the operator to link a contact when the deal has none', async () => {
    const ctx = makeDealCtx({})

    await expect(
      tool.handler({ operation: 'create', dealId: DEAL_ID, activityType: 'call' }, ctx as any),
    ).rejects.toThrow(/has no linked person or company/)
    expect(runMock).not.toHaveBeenCalled()
  })
})
