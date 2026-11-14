const loggerError = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: unknown[]) => loggerError(...args),
  }
  return { createLogger: () => ({ ...logger, child: () => logger }) }
})

import handle, { metadata } from '../proposalNotifier'

const payload = {
  proposalId: 'proposal-1',
  emailId: 'email-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  actionCount: 3,
  discrepancyCount: 0,
  confidence: '0.9',
  summary: 'Order request',
}

function buildResolver(registrations: Record<string, unknown>) {
  const resolve = jest.fn(<T = unknown>(name: string): T => {
    if (!(name in registrations)) {
      throw new Error(`Could not resolve '${name}'`)
    }
    return registrations[name] as T
  })
  return { resolve }
}

describe('inbox_ops proposal notifier subscriber', () => {
  beforeEach(() => jest.clearAllMocks())

  it('keeps its persistent subscription contract', () => {
    expect(metadata).toEqual({
      event: 'inbox_ops.proposal.created',
      persistent: true,
      id: 'inbox_ops:proposal-notifier',
    })
  })

  it('is a no-op when the notifications module is disabled', async () => {
    const em = { findOne: jest.fn(), create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
    const eventBus = { emit: jest.fn() }
    const ctx = buildResolver({ em, eventBus })

    await expect(handle(payload, ctx)).resolves.toBeUndefined()

    expect(ctx.resolve).toHaveBeenCalledWith('notificationService')
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('creates a feature notification for proposal viewers when notifications is enabled', async () => {
    const createForFeature = jest.fn(async () => [])
    const ctx = buildResolver({ notificationService: { createForFeature } })

    await handle(payload, ctx)

    expect(createForFeature).toHaveBeenCalledTimes(1)
    expect(createForFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredFeature: 'inbox_ops.proposals.view',
        type: 'inbox_ops.proposal.created',
        sourceEntityType: 'inbox_ops:proposal',
        sourceEntityId: 'proposal-1',
        linkHref: '/backend/inbox-ops/proposals/proposal-1',
        bodyVariables: { actionCount: '3' },
      }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('passes a null organization scope through when the proposal has none', async () => {
    const createForFeature = jest.fn(async () => [])
    const ctx = buildResolver({ notificationService: { createForFeature } })

    await handle({ ...payload, organizationId: null }, ctx)

    expect(createForFeature).toHaveBeenCalledWith(
      expect.objectContaining({ sourceEntityId: 'proposal-1' }),
      { tenantId: 'tenant-1', organizationId: null },
    )
  })

  it('rethrows genuine notification failures so the persistent job retries', async () => {
    const failure = new Error('database unavailable')
    const createForFeature = jest.fn(async () => {
      throw failure
    })
    const ctx = buildResolver({ notificationService: { createForFeature } })

    await expect(handle(payload, ctx)).rejects.toBe(failure)
    expect(createForFeature).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledWith('Failed to create notification', { err: failure })
  })
})
