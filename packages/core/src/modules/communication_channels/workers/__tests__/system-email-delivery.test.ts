import type { QueuedJob } from '@open-mercato/queue'
import handler, { metadata } from '../system-email-delivery'
import type { SystemEmailDeliveryJob } from '../../lib/system-email-queue'

const findOneWithDecryptionMock = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const deliverSystemEmailMock = jest.fn()
jest.mock('../../lib/system-email', () => ({
  deliverSystemEmail: (...args: unknown[]) => deliverSystemEmailMock(...args),
}))

const enqueueMock = jest.fn(async () => 'next-job-id')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

const emitMock = jest.fn(async () => undefined)
jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: (...args: unknown[]) => emitMock(...args),
}))

const reportErrorMock = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

const TENANT_ID = '22222222-2222-2222-2222-222222222222'
const ORGANIZATION_ID = '33333333-3333-3333-3333-333333333333'
const DELIVERY_ID = '11111111-1111-1111-1111-111111111111'

type DeliveryRow = Record<string, unknown> & { status: string; attempts: number }

function makeRow(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: DELIVERY_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    status: 'pending',
    attempts: 0,
    recipient: 'user@example.com',
    subject: 'Reset your password',
    htmlBody: '<p>secret link</p>',
    textBody: 'secret link',
    attachments: JSON.stringify([{ filename: 'a.pdf', content: 'YQ==' }]),
    fromAddress: 'from@example.com',
    fromIsInstanceDefault: true,
    replyTo: null,
    providerKey: null,
    lastError: null,
    sentAt: null,
    ...overrides,
  }
}

function makeJob(): QueuedJob<SystemEmailDeliveryJob> {
  return {
    id: 'job-1',
    createdAt: new Date().toISOString(),
    payload: {
      deliveryId: DELIVERY_ID,
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      attempt: 1,
    },
  }
}

function makeCtx(flush: jest.Mock = jest.fn(async () => undefined)) {
  return {
    jobId: 'job-1',
    attemptNumber: 1,
    queueName: 'communication-channels-system-email',
    resolve: ((name: string) => {
      if (name === 'em') return { fork: () => ({ flush }) }
      return null
    }) as <T>(name: string) => T,
  }
}

function expectContentPurged(row: DeliveryRow) {
  expect(row.recipient).toBeNull()
  expect(row.subject).toBeNull()
  expect(row.htmlBody).toBeNull()
  expect(row.textBody).toBeNull()
  expect(row.attachments).toBeNull()
  expect(row.replyTo).toBeNull()
}

describe('system-email-delivery worker', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, SYSTEM_EMAIL_PROVIDER: 'resend' }
    delete process.env.OM_SYSTEM_EMAIL_MAX_ATTEMPTS
    findOneWithDecryptionMock.mockReset()
    deliverSystemEmailMock.mockReset()
    enqueueMock.mockClear()
    emitMock.mockClear()
    reportErrorMock.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('targets the system email queue', () => {
    expect(metadata.queue).toBe('communication-channels-system-email')
    expect(metadata.id).toBe('communication_channels:system-email-delivery')
    expect(metadata.concurrency).toBe(5)
  })

  it('loads the row inside the job tenant scope', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    await handler(makeJob(), makeCtx())
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { id: DELIVERY_ID, tenantId: TENANT_ID },
      undefined,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )
    expect(deliverSystemEmailMock).not.toHaveBeenCalled()
  })

  it.each(['sent', 'failed'])('skips a row that is already %s', async (status) => {
    findOneWithDecryptionMock.mockResolvedValue(makeRow({ status }))
    await handler(makeJob(), makeCtx())
    expect(deliverSystemEmailMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('delivers the stored email, marks it sent and purges content', async () => {
    const row = makeRow()
    findOneWithDecryptionMock.mockResolvedValue(row)
    deliverSystemEmailMock.mockResolvedValue({ providerKey: 'resend' })
    const flush = jest.fn(async () => undefined)

    await handler(makeJob(), makeCtx(flush))

    const [, payload, body] = deliverSystemEmailMock.mock.calls[0]
    expect(payload).toEqual(expect.objectContaining({
      to: 'user@example.com',
      subject: 'Reset your password',
      from: 'from@example.com',
      fromIsInstanceDefault: true,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      attachments: [{ filename: 'a.pdf', content: 'YQ==' }],
    }))
    expect(body).toEqual({ html: '<p>secret link</p>', text: 'secret link', body: '<p>secret link</p>', bodyFormat: 'html' })
    expect(row.status).toBe('sent')
    expect(row.attempts).toBe(1)
    expect(row.providerKey).toBe('resend')
    expect(row.sentAt).toBeInstanceOf(Date)
    expectContentPurged(row)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('re-enqueues a transient failure with backoff and keeps the content', async () => {
    const row = makeRow()
    findOneWithDecryptionMock.mockResolvedValue(row)
    deliverSystemEmailMock.mockRejectedValue(new Error('503 Service Unavailable'))

    await handler(makeJob(), makeCtx())

    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(1)
    expect(row.lastError).toContain('Service Unavailable')
    expect(row.htmlBody).toBe('<p>secret link</p>')
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [job, options] = enqueueMock.mock.calls[0] as unknown as [Record<string, unknown>, { delayMs: number }]
    expect(job).toEqual({
      deliveryId: DELIVERY_ID,
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      attempt: 2,
    })
    expect(options.delayMs).toBeGreaterThanOrEqual(30_000)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('fails a permanent error without retrying, emits the event and reports it', async () => {
    const row = makeRow()
    findOneWithDecryptionMock.mockResolvedValue(row)
    const error = new Error('Recipient address rejected')
    deliverSystemEmailMock.mockRejectedValue(error)

    await handler(makeJob(), makeCtx())

    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(1)
    expectContentPurged(row)
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(reportErrorMock).toHaveBeenCalledWith(error, expect.objectContaining({ module: 'communication_channels' }))
    expect(emitMock).toHaveBeenCalledWith(
      'communication_channels.system_email.delivery_failed',
      {
        deliveryId: DELIVERY_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        providerKey: 'resend',
        attempts: 1,
        error: 'Recipient address rejected',
      },
      { persistent: true },
    )
    const [, eventPayload] = emitMock.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(JSON.stringify(eventPayload)).not.toContain('user@example.com')
  })

  it('gives up on a transient failure once the attempt budget is spent', async () => {
    process.env.OM_SYSTEM_EMAIL_MAX_ATTEMPTS = '3'
    const row = makeRow({ attempts: 2 })
    findOneWithDecryptionMock.mockResolvedValue(row)
    deliverSystemEmailMock.mockRejectedValue(new Error('ETIMEDOUT'))

    await handler(makeJob(), makeCtx())

    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(3)
    expectContentPurged(row)
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledTimes(1)
  })

  it('rethrows when the outcome cannot be recorded', async () => {
    findOneWithDecryptionMock.mockResolvedValue(makeRow())
    deliverSystemEmailMock.mockResolvedValue({ providerKey: 'resend' })
    const flush = jest.fn(async () => {
      throw new Error('connection terminated')
    })

    await expect(handler(makeJob(), makeCtx(flush))).rejects.toThrow('connection terminated')
  })
})
