const mockCreate = jest.fn()
const mockCreateForRole = jest.fn()
const mockCreateForFeature = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({
    create: mockCreate,
    createForRole: mockCreateForRole,
    createForFeature: mockCreateForFeature,
  }),
}))

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/workflows/data/entities', () => ({
  WorkflowInstance: class WorkflowInstance {},
}))

import handleCompleted, { metadata as completedMetadata } from '../brief-completed-notification'
import handleFailed, { metadata as failedMetadata } from '../brief-failed-notification'
import {
  BRIEF_COMPLETED_EVENT_ID,
  BRIEF_COMPLETED_PAYLOAD_KEYS,
  BRIEF_FAILED_EVENT_ID,
  BRIEF_FAILED_PAYLOAD_KEYS,
  BRIEF_FAILURE_CAUSES,
  eventsConfig,
} from '../../events'
import { notificationTypes } from '../../notifications'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const COMPANY_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444'
const INITIATOR_ID = '55555555-5555-4555-8555-555555555555'

function makeCtx(overrides: { tenantId?: string | null; organizationId?: string | null } = {}) {
  const em = { fork: () => em }
  return {
    resolve: <T>(name: string): T => (name === 'em' ? (em as unknown as T) : (null as unknown as T)),
    tenantId: 'tenantId' in overrides ? overrides.tenantId : TENANT_ID,
    organizationId: 'organizationId' in overrides ? overrides.organizationId : ORG_ID,
  }
}

function completedPayload(extra: Record<string, unknown> = {}) {
  return {
    companyId: COMPANY_ID,
    companyName: 'Northwind Traders',
    workflowInstanceId: INSTANCE_ID,
    taskCount: 3,
    ...extra,
    _workflow: {
      workflowInstanceId: INSTANCE_ID,
      workflowId: 'sales_call_planner.deal_briefing',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    },
  }
}

function failedPayload(extra: Record<string, unknown> = {}) {
  return {
    companyId: COMPANY_ID,
    companyName: 'Northwind Traders',
    workflowInstanceId: INSTANCE_ID,
    cause: 'callNotReached',
    ...extra,
    _workflow: {
      workflowInstanceId: INSTANCE_ID,
      workflowId: 'sales_call_planner.deal_briefing',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    },
  }
}

beforeEach(() => {
  mockCreate.mockReset()
  mockCreateForRole.mockReset()
  mockCreateForFeature.mockReset()
  mockFindOneWithDecryption.mockReset()
  mockFindOneWithDecryption.mockResolvedValue({
    id: INSTANCE_ID,
    tenantId: TENANT_ID,
    isDryRun: false,
    metadata: { initiatedBy: INITIATOR_ID },
  })
})

describe('sales_call_planner event declarations', () => {
  it('declares both briefing events on the module', () => {
    const declaredIds = eventsConfig.events.map((event) => event.id)
    expect(declaredIds).toEqual([BRIEF_COMPLETED_EVENT_ID, BRIEF_FAILED_EVENT_ID])
    expect(eventsConfig.moduleId).toBe('sales_call_planner')
  })

  it('keeps both events off the DOM event bridge', () => {
    for (const event of eventsConfig.events) {
      expect(event.clientBroadcast).toBeUndefined()
      expect(event.portalBroadcast).toBeUndefined()
    }
  })

  it('declares only ids, counts and classifications in the payload contract', () => {
    const declaredKeys = eventsConfig.events.flatMap((event) =>
      (event.payloadSchema?.fields ?? []).map((field) => field.path)
    )
    const allowed = new Set([
      ...BRIEF_COMPLETED_PAYLOAD_KEYS,
      ...BRIEF_FAILED_PAYLOAD_KEYS,
      '_workflow',
    ])
    for (const key of declaredKeys) expect(allowed.has(key)).toBe(true)

    const forbidden = ['transcript', 'phone', 'phoneNumber', 'error', 'summary', 'audio', 'token']
    for (const key of forbidden) expect(allowed.has(key)).toBe(false)
  })
})

describe('subscriber metadata', () => {
  it('subscribes each handler to its declared event with a stable id', () => {
    expect(completedMetadata.event).toBe(BRIEF_COMPLETED_EVENT_ID)
    expect(completedMetadata.persistent).toBe(true)
    expect(completedMetadata.id).toBe('sales-call-planner:brief-completed-notification')

    expect(failedMetadata.event).toBe(BRIEF_FAILED_EVENT_ID)
    expect(failedMetadata.persistent).toBe(true)
    expect(failedMetadata.id).toBe('sales-call-planner:brief-failed-notification')
  })

  it('names a registered notification type for each event', () => {
    const types = notificationTypes.map((type) => type.type)
    expect(types).toContain(BRIEF_COMPLETED_EVENT_ID)
    expect(types).toContain(BRIEF_FAILED_EVENT_ID)
  })
})

describe('brief-completed-notification', () => {
  it('creates a notification with i18n keys, the company link and traceable source fields', async () => {
    await handleCompleted(completedPayload(), makeCtx())

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const [input, scope] = mockCreate.mock.calls[0] as [Record<string, unknown>, unknown]

    expect(input.type).toBe(BRIEF_COMPLETED_EVENT_ID)
    expect(input.titleKey).toBe('sales_call_planner.notifications.briefCompleted.title')
    expect(input.bodyKey).toBe('sales_call_planner.notifications.briefCompleted.body')
    expect(input.bodyVariables).toEqual({ company: 'Northwind Traders', count: '3' })
    expect(input.linkHref).toBe(`/backend/customers/companies-v2/${COMPANY_ID}`)
    expect(input.sourceModule).toBe('sales_call_planner')
    expect(input.sourceEntityType).toBe('customers.company')
    expect(input.sourceEntityId).toBe(COMPANY_ID)
    expect(input.severity).toBe('success')
    expect(input.groupKey).toBe(`sales_call_planner:brief:${INSTANCE_ID}`)
    expect(input.recipientUserId).toBe(INITIATOR_ID)
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('offers the company link as the primary action using the seeded label key', async () => {
    await handleCompleted(completedPayload(), makeCtx())

    const [input] = mockCreate.mock.calls[0] as [Record<string, unknown>]
    expect(input.primaryActionId).toBe('open-company')
    expect(input.actions).toEqual([
      expect.objectContaining({
        id: 'open-company',
        labelKey: 'sales_call_planner.notifications.linkLabel',
        href: `/backend/customers/companies-v2/${COMPANY_ID}`,
      }),
    ])
  })

  it('normalizes a nonsense task count instead of rendering it', async () => {
    await handleCompleted(completedPayload({ taskCount: '-4' }), makeCtx())

    const [input] = mockCreate.mock.calls[0] as [Record<string, unknown>]
    expect((input.bodyVariables as Record<string, string>).count).toBe('0')
  })

  it('reuses one group key per run so a replayed emit refreshes one row', async () => {
    await handleCompleted(completedPayload(), makeCtx())
    await handleCompleted(completedPayload(), makeCtx())

    const first = (mockCreate.mock.calls[0] as [Record<string, unknown>])[0]
    const second = (mockCreate.mock.calls[1] as [Record<string, unknown>])[0]
    expect(first.groupKey).toBe(second.groupKey)
  })
})

describe('brief-failed-notification', () => {
  it('creates an error notification carrying the classified cause', async () => {
    await handleFailed(failedPayload(), makeCtx())

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const [input] = mockCreate.mock.calls[0] as [Record<string, unknown>]
    expect(input.type).toBe(BRIEF_FAILED_EVENT_ID)
    expect(input.titleKey).toBe('sales_call_planner.notifications.briefFailed.title')
    expect(input.bodyKey).toBe('sales_call_planner.notifications.briefFailed.body')
    expect(input.severity).toBe('error')
    expect(input.bodyVariables).toEqual({ company: 'Northwind Traders', cause: 'callNotReached' })
    expect(input.linkHref).toBe(`/backend/customers/companies-v2/${COMPANY_ID}`)
  })

  it('coerces an unrecognized cause to `unknown`', async () => {
    await handleFailed(failedPayload({ cause: 'the line went dead after "we lost the Contoso deal"' }), makeCtx())

    const [input] = mockCreate.mock.calls[0] as [Record<string, unknown>]
    expect((input.bodyVariables as Record<string, string>).cause).toBe('unknown')
    expect(BRIEF_FAILURE_CAUSES).toContain((input.bodyVariables as Record<string, string>).cause)
  })
})

describe('payload discipline', () => {
  const transcript = 'CHIEF: call Contoso back on 555-0134 about the renewal'
  const phone = '+48555010134'

  it.each([
    ['completed', handleCompleted, completedPayload({ transcript, phoneNumber: phone, summary: transcript })],
    ['failed', handleFailed, failedPayload({ transcript, phoneNumber: phone, error: transcript })],
  ])(
    'never lets a transcript, a phone number or a free-text error reach the notification (%s)',
    async (_name, handler, payload) => {
      await handler(payload as never, makeCtx())

      expect(mockCreate).toHaveBeenCalledTimes(1)
      const [input] = mockCreate.mock.calls[0] as [Record<string, unknown>]
      const serialized = JSON.stringify(input)

      expect(serialized).not.toContain(transcript)
      expect(serialized).not.toContain(phone)
      expect(serialized).not.toContain('Contoso')
      expect(input).not.toHaveProperty('transcript')
      expect(input).not.toHaveProperty('phoneNumber')
      expect(input).not.toHaveProperty('error')
      expect(Object.keys(input.bodyVariables as Record<string, string>).sort()).not.toContain(
        'transcript'
      )
    }
  )

  it('truncates an oversized company name instead of storing it whole', async () => {
    const longName = 'A'.repeat(400)
    await handleCompleted(completedPayload({ companyName: longName }), makeCtx())

    const [input] = mockCreate.mock.calls[0] as [Record<string, unknown>]
    expect((input.bodyVariables as Record<string, string>).company).toHaveLength(120)
  })
})

describe('recipient resolution', () => {
  it('addresses the human who started the run and never a role or a feature', async () => {
    await handleCompleted(completedPayload(), makeCtx())

    const [input] = mockCreate.mock.calls[0] as [Record<string, unknown>]
    expect(input.recipientUserId).toBe(INITIATOR_ID)
    expect(mockCreateForRole).not.toHaveBeenCalled()
    expect(mockCreateForFeature).not.toHaveBeenCalled()
  })

  it('looks the instance up under the trusted tenant scope', async () => {
    await handleCompleted(completedPayload(), makeCtx())

    const [, , where] = mockFindOneWithDecryption.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(where).toEqual({ id: INSTANCE_ID, tenantId: TENANT_ID })
  })

  it('notifies nobody when the run was started by a trigger rather than a person', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: INSTANCE_ID,
      isDryRun: false,
      metadata: { initiatedBy: 'trigger:nightly-sweep' },
    })

    await handleCompleted(completedPayload(), makeCtx())

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('notifies nobody when the instance cannot be resolved in this tenant', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    await handleCompleted(completedPayload(), makeCtx())

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates nothing for a dry run', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: INSTANCE_ID,
      isDryRun: true,
      metadata: { initiatedBy: INITIATOR_ID },
    })

    await handleCompleted(completedPayload(), makeCtx())

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('falls back to the engine-added scope when the emitter attached none', async () => {
    await handleCompleted(completedPayload(), makeCtx({ tenantId: null, organizationId: null }))

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const [, scope] = mockCreate.mock.calls[0] as [unknown, unknown]
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('creates nothing when the company id is not a real id', async () => {
    await handleCompleted(completedPayload({ companyId: '../../etc/passwd' }), makeCtx())

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })
})

describe('best-effort delivery', () => {
  it('swallows a notificationService failure so the workflow run is unaffected', async () => {
    mockCreate.mockRejectedValue(new Error('notifications are down'))

    await expect(handleCompleted(completedPayload(), makeCtx())).resolves.toBeUndefined()
  })

  it('swallows an instance lookup failure', async () => {
    mockFindOneWithDecryption.mockRejectedValue(new Error('connection reset'))

    await expect(handleFailed(failedPayload(), makeCtx())).resolves.toBeUndefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('swallows a payload that is not an object at all', async () => {
    await expect(handleCompleted('not a payload' as never, makeCtx())).resolves.toBeUndefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
