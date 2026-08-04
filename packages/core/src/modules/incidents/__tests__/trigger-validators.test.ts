/** @jest-environment node */

jest.mock('@open-mercato/shared/modules/events', () => ({
  getDeclaredEvents: jest.fn(),
}))

import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import { triggerCreateSchema, triggerUpdateSchema } from '../data/validators'

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TRIGGER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const POLICY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function baseTriggerInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    eventId: 'catalog.product.updated',
    isEnabled: true,
    severityKey: 'sev2',
    typeKey: 'operational',
    escalationPolicyId: POLICY_ID,
    conditions: [{ path: 'status', equals: 'failed' }],
    ...overrides,
  }
}

describe('incident trigger validators', () => {
  beforeEach(() => {
    ;(getDeclaredEvents as jest.Mock).mockReturnValue([])
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('accepts undeclared external event ids and valid conditions', () => {
    const result = triggerCreateSchema.safeParse(baseTriggerInput({
      eventId: 'custom.module.event',
      conditions: [
        { path: 'status', equals: 'failed' },
        { path: 'attempt', equals: 2 },
        { path: 'reauthRequired', equals: true },
      ],
    }))

    expect(result.success).toBe(true)
  })

  it('rejects incidents module events', () => {
    const result = triggerCreateSchema.safeParse(baseTriggerInput({
      eventId: 'incidents.incident.created',
    }))

    expect(result.success).toBe(false)
  })

  it('rejects declared events excluded from triggers', () => {
    ;(getDeclaredEvents as jest.Mock).mockReturnValue([
      {
        id: 'sales.document.calculate.before',
        label: 'Before Calculate',
        excludeFromTriggers: true,
      },
    ])

    const result = triggerCreateSchema.safeParse(baseTriggerInput({
      eventId: 'sales.document.calculate.before',
    }))

    expect(result.success).toBe(false)
  })

  it('rejects invalid condition shapes', () => {
    const emptyPath = triggerCreateSchema.safeParse(baseTriggerInput({
      conditions: [{ path: '', equals: true }],
    }))
    const objectEquals = triggerCreateSchema.safeParse(baseTriggerInput({
      conditions: [{ path: 'status', equals: { value: 'failed' } }],
    }))

    expect(emptyPath.success).toBe(false)
    expect(objectEquals.success).toBe(false)
  })

  it('validates trigger updates with optional fields', () => {
    const result = triggerUpdateSchema.safeParse({
      id: TRIGGER_ID,
      eventId: 'catalog.product.deleted',
      conditions: null,
    })

    expect(result.success).toBe(true)
  })
})
