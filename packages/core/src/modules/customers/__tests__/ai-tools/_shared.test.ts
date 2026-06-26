/**
 * Regression coverage for the customers AI-tools shared helpers (#3627).
 *
 * Two guarantees:
 *  1. The `_shared.ts` helpers (`toIso`, `toCustomerListSummary`,
 *     `buildRelatedRecords`) behave as the per-pack copies did before the DRY
 *     extraction.
 *  2. The DRY invariant: `companies-pack` and `people-pack` route their
 *     related-records output through the single shared builder, so the shared
 *     collections (addresses / activities / notes / tasks / interactions /
 *     tags / deals) cannot drift apart again.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
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

import companiesAiTools from '../../ai-tools/companies-pack'
import peopleAiTools from '../../ai-tools/people-pack'
import { buildRelatedRecords, toCustomerListSummary, toIso } from '../../ai-tools/_shared'
import type { CustomersAiToolDefinition } from '../../ai-tools/types'
import { makeCtx } from './shared'

function findTool(tools: CustomersAiToolDefinition[], name: string) {
  const tool = tools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('customers ai-tools _shared helpers', () => {
  describe('toIso', () => {
    it('returns null for empty values', () => {
      expect(toIso(null)).toBeNull()
      expect(toIso(undefined)).toBeNull()
      expect(toIso('')).toBeNull()
    })

    it('returns null for unparseable values', () => {
      expect(toIso('not-a-date')).toBeNull()
    })

    it('normalizes Date instances and date strings to ISO', () => {
      expect(toIso(new Date('2024-01-01T00:00:00.000Z'))).toBe('2024-01-01T00:00:00.000Z')
      expect(toIso('2024-01-01T00:00:00.000Z')).toBe('2024-01-01T00:00:00.000Z')
    })
  })

  describe('toCustomerListSummary', () => {
    it('reads snake_case fields and normalizes createdAt to ISO', () => {
      const summary = toCustomerListSummary({
        id: 'c1',
        display_name: 'Acme',
        primary_email: 'hello@acme.example',
        owner_user_id: 'u1',
        organization_id: 'org-1',
        tenant_id: 'tenant-1',
        created_at: '2024-01-01T00:00:00.000Z',
      })
      expect(summary).toEqual({
        id: 'c1',
        displayName: 'Acme',
        primaryEmail: 'hello@acme.example',
        primaryPhone: null,
        status: null,
        lifecycleStage: null,
        source: null,
        ownerUserId: 'u1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      })
    })

    it('falls back to camelCase fields when snake_case is absent', () => {
      const summary = toCustomerListSummary({ displayName: 'Beta', primaryPhone: '123' })
      expect(summary.displayName).toBe('Beta')
      expect(summary.primaryPhone).toBe('123')
      expect(summary.createdAt).toBeNull()
    })
  })

  describe('buildRelatedRecords', () => {
    const data = {
      addresses: [{ id: 'addr-1', name: 'HQ', addressLine1: '1 Main St', isPrimary: true }],
      activities: [{ id: 'act-1', activityType: 'email', occurredAt: '2024-01-03T00:00:00.000Z' }],
      comments: [{ id: 'note-1', body: 'note', createdAt: '2024-01-03T00:00:00.000Z' }],
      todos: [{ id: 't-1', todoSource: 'example' }],
      interactions: [{ id: 'i-1', interactionType: 'task', status: 'planned' }],
      tags: [{ id: 'tag-1', label: 'VIP' }],
      deals: [{ id: 'd-1', title: 'Big', status: 'open', valueAmount: '1000', valueCurrency: 'USD' }],
      people: [{ id: 'p-1', displayName: 'Alice' }],
    }

    it('omits the people collection by default and preserves key order', () => {
      const related = buildRelatedRecords(data)
      expect(Object.keys(related)).toEqual([
        'addresses',
        'activities',
        'notes',
        'tasks',
        'interactions',
        'tags',
        'deals',
      ])
      expect((related as Record<string, unknown>).people).toBeUndefined()
    })

    it('appends the people collection when includePeople is set', () => {
      const related = buildRelatedRecords(data, { includePeople: true })
      expect(Object.keys(related)).toEqual([
        'addresses',
        'activities',
        'notes',
        'tasks',
        'interactions',
        'tags',
        'deals',
        'people',
      ])
      expect(related.people).toEqual([
        {
          id: 'p-1',
          displayName: 'Alice',
          primaryEmail: null,
          primaryPhone: null,
          jobTitle: null,
          department: null,
        },
      ])
    })

    it('coerces missing collections to empty arrays', () => {
      const related = buildRelatedRecords({})
      expect(related.addresses).toEqual([])
      expect(related.activities).toEqual([])
      expect(related.notes).toEqual([])
      expect(related.tasks).toEqual([])
      expect(related.interactions).toEqual([])
      expect(related.tags).toEqual([])
      expect(related.deals).toEqual([])
    })
  })
})

describe('customers ai-tools DRY invariant (#3627)', () => {
  beforeEach(() => {
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  const sharedRelatedPayload = {
    addresses: [
      {
        id: 'addr-1',
        name: 'HQ',
        purpose: 'billing',
        addressLine1: '1 Main St',
        addressLine2: 'Suite 2',
        city: 'Metropolis',
        region: 'NY',
        postalCode: '00001',
        country: 'US',
        isPrimary: true,
      },
    ],
    activities: [
      {
        id: 'act-1',
        activityType: 'call',
        subject: 'Intro',
        body: 'hi',
        occurredAt: '2024-01-03T00:00:00.000Z',
        createdAt: '2024-01-03T00:00:00.000Z',
      },
    ],
    comments: [
      { id: 'note-1', body: 'Hello', authorUserId: 'user-1', createdAt: '2024-01-03T00:00:00.000Z' },
    ],
    todos: [
      { id: 'task-1', todoId: 'task-1', todoSource: 'example', createdAt: '2024-01-03T00:00:00.000Z' },
    ],
    interactions: [
      {
        id: 'int-1',
        interactionType: 'task',
        title: 'Follow up',
        status: 'planned',
        scheduledAt: '2024-01-04T00:00:00.000Z',
        occurredAt: null,
      },
    ],
    tags: [{ id: 'tag-1', label: 'VIP', slug: 'vip', color: '#ff0000' }],
    deals: [
      {
        id: 'deal-1',
        title: 'Big deal',
        status: 'open',
        pipelineStageId: 'stage-1',
        valueAmount: '1000',
        valueCurrency: 'USD',
      },
    ],
  }

  const companyId = 'a1bd846b-5f8f-43bb-8c79-c6933afa09fe'
  const personId = 'ba9d7593-367c-4a93-9918-c998ff3e5a1d'
  const sharedKeys = ['addresses', 'activities', 'notes', 'tasks', 'interactions', 'tags', 'deals']

  it('produces byte-identical shared related collections from both packs', async () => {
    const getCompany = findTool(companiesAiTools, 'customers.get_company')
    const getPerson = findTool(peopleAiTools, 'customers.get_person')

    runMock.mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      data: {
        company: { id: companyId, displayName: 'Acme', tenantId: 'tenant-1' },
        profile: null,
        customFields: {},
        ...sharedRelatedPayload,
      },
    })
    const companyResult = (await getCompany.handler(
      { companyId, includeRelated: true },
      makeCtx() as any,
    )) as Record<string, unknown>

    runMock.mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      data: {
        person: { id: personId, displayName: 'Alice', tenantId: 'tenant-1' },
        profile: null,
        customFields: {},
        ...sharedRelatedPayload,
      },
    })
    const personResult = (await getPerson.handler(
      { personId, includeRelated: true },
      makeCtx() as any,
    )) as Record<string, unknown>

    const companyRelated = companyResult.related as Record<string, unknown>
    const personRelated = personResult.related as Record<string, unknown>

    for (const key of sharedKeys) {
      expect(personRelated[key]).toEqual(companyRelated[key])
    }

    expect((companyRelated.people as unknown[]).length).toBe(0)
    expect(personRelated.people).toBeUndefined()
  })
})
