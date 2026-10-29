import {
  computeSystemEmailBackoffMs,
  enqueueSystemEmailDelivery,
  resolveSystemEmailMaxAttempts,
} from '../system-email-queue'

const enqueueMock = jest.fn(async () => 'job-1')
jest.mock('../queue', () => {
  const actual = jest.requireActual('../queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

const reportErrorMock = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

type CreatedRow = Record<string, unknown>

function buildContainer() {
  const created: CreatedRow[] = []
  const flush = jest.fn(async () => undefined)
  const em = {
    create: jest.fn((_entity: unknown, data: CreatedRow) => {
      const row = { id: 'delivery-1', ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(() => ({ flush })),
    flush,
  }
  const container = {
    resolve(name: string) {
      if (name === 'em') return { fork: () => em }
      throw new Error(`[internal] unexpected dependency ${name}`)
    },
  }
  return { container, created, flush }
}

const payload = {
  to: 'user@example.com',
  subject: 'Reset your password',
  from: 'from@example.com',
  fromIsInstanceDefault: true,
  replyTo: 'support@example.com',
  attachments: [{ filename: 'a.pdf', content: 'YQ==', contentType: 'application/pdf' }],
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const body = {
  html: '<p>https://app.example.com/reset/secret-token</p>',
  text: 'https://app.example.com/reset/secret-token',
  body: '<p>https://app.example.com/reset/secret-token</p>',
  bodyFormat: 'html' as const,
}

describe('system email queue helpers', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.OM_SYSTEM_EMAIL_MAX_ATTEMPTS
    delete process.env.OM_SYSTEM_EMAIL_RETRY_BASE_MS
    enqueueMock.mockReset()
    enqueueMock.mockResolvedValue('job-1')
    reportErrorMock.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('defaults to 8 attempts and clamps the configured value', () => {
    expect(resolveSystemEmailMaxAttempts()).toBe(8)
    process.env.OM_SYSTEM_EMAIL_MAX_ATTEMPTS = '0'
    expect(resolveSystemEmailMaxAttempts()).toBe(1)
    process.env.OM_SYSTEM_EMAIL_MAX_ATTEMPTS = '99'
    expect(resolveSystemEmailMaxAttempts()).toBe(20)
    process.env.OM_SYSTEM_EMAIL_MAX_ATTEMPTS = 'many'
    expect(resolveSystemEmailMaxAttempts()).toBe(8)
  })

  it('doubles the backoff from 30 s and caps it at 30 min', () => {
    const noJitter = () => 0
    expect(computeSystemEmailBackoffMs(1, noJitter)).toBe(30_000)
    expect(computeSystemEmailBackoffMs(2, noJitter)).toBe(60_000)
    expect(computeSystemEmailBackoffMs(7, noJitter)).toBe(30 * 60_000)
    expect(computeSystemEmailBackoffMs(1, () => 0.99)).toBeLessThan(33_001)
  })

  it('honours a configured base delay', () => {
    process.env.OM_SYSTEM_EMAIL_RETRY_BASE_MS = '500'
    expect(computeSystemEmailBackoffMs(3, () => 0)).toBe(2_000)
  })

  it('persists the rendered email and enqueues only the row id', async () => {
    const { container, created } = buildContainer()

    const deliveryId = await enqueueSystemEmailDelivery(container as never, payload, body)

    expect(deliveryId).toBe('delivery-1')
    expect(created[0]).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'pending',
      recipient: 'user@example.com',
      htmlBody: body.html,
      textBody: body.text,
      attachments: JSON.stringify(payload.attachments),
      fromAddress: 'from@example.com',
      fromIsInstanceDefault: true,
      replyTo: 'support@example.com',
    }))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [job] = enqueueMock.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(job).toEqual({
      deliveryId: 'delivery-1',
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
      attempt: 1,
    })
    expect(JSON.stringify(job)).not.toContain('secret-token')
    expect(JSON.stringify(job)).not.toContain('user@example.com')
  })

  it('closes the row as failed and rethrows when the enqueue fails', async () => {
    const { container, created, flush } = buildContainer()
    const error = new Error('queue down')
    enqueueMock.mockRejectedValueOnce(error)

    await expect(enqueueSystemEmailDelivery(container as never, payload, body)).rejects.toThrow('queue down')

    expect(created[0]).toEqual(expect.objectContaining({
      status: 'failed',
      lastError: 'queue down',
      recipient: null,
      htmlBody: null,
      textBody: null,
      attachments: null,
    }))
    expect(flush).toHaveBeenCalledTimes(2)
    expect(reportErrorMock).toHaveBeenCalledWith(error, expect.objectContaining({ module: 'communication_channels' }))
  })

  it('refuses a tenantless payload', async () => {
    const { container } = buildContainer()
    await expect(
      enqueueSystemEmailDelivery(container as never, { ...payload, tenantId: undefined }, body),
    ).rejects.toThrow('[internal]')
  })
})
