import {
  createMessageAccessToken,
  sendMessageEmailToExternal,
  sendMessageEmailToRecipient,
} from '../email-sender'

const sendEmailMock = jest.fn(async () => {})
const loadDictionaryMock = jest.fn(async () => ({}))
const createFallbackTranslatorMock = jest.fn(() => (
  (_key: string, fallback?: string) => fallback ?? 'fallback'
))
const messageEmailMock = jest.fn((props: Record<string, unknown>) => ({ props }))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: (...args: unknown[]) => loadDictionaryMock(...args),
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createFallbackTranslator: (...args: unknown[]) => createFallbackTranslatorMock(...args),
}))

jest.mock('../../emails/MessageEmail', () => ({
  __esModule: true,
  default: (...args: unknown[]) => messageEmailMock(...args),
}))

function createEm() {
  const flush = jest.fn(async () => {})
  return {
    create: jest.fn((_entity, payload) => payload),
    persist: jest.fn(() => ({ flush })),
    flush,
  }
}

const baseMessage = {
  id: 'message-1',
  subject: 'Subject',
  body: 'Body',
  senderUserId: 'sender-1', tenantId: 'tenant-1', organizationId: 'org-1',
  sentAt: new Date('2026-02-15T10:00:00.000Z'),
} as never

describe('messages email sender', () => {
  const appUrl = process.env.APP_URL

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.APP_URL = 'https://mercato.test/'
  })

  afterAll(() => {
    process.env.APP_URL = appUrl
  })

  it('creates and persists access token as an HMAC hash while returning the raw token', async () => {
    const em = createEm()

    const token = await createMessageAccessToken(
      em as never,
      'message-1',
      'user-1',
    )

    expect(token).toHaveLength(64)
    expect(em.create).toHaveBeenCalledTimes(1)
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    const [, payload] = em.create.mock.calls[0] as [unknown, { token: string }]
    const { hashAuthToken } = require('../../../auth/lib/tokenHash')
    expect(payload.token).toBe(hashAuthToken(token))
    expect(payload.token).not.toBe(token)
  })

  it('sends recipient email with generated view url', async () => {
    const em = createEm()

    await sendMessageEmailToRecipient({
      em: em as never,
      message: baseMessage,
      attachmentAccess: {
        auth: { sub: 'sender-1', tenantId: 'tenant-1', orgId: 'org-1' },
        service: { readScoped: jest.fn(async () => ({ buffer: Buffer.from('invoice'), fileName: 'invoice.pdf', mimeType: 'application/pdf' })) } as never,
      },
      recipientUserId: 'user-2',
      recipientEmail: 'user2@example.com',
      sender: { name: 'Alice', email: 'alice@example.com' },
      objects: [
        {
          entityModule: 'sales',
          entityType: 'order',
          entityId: 'order-1',
        },
      ] as never,
      attachments: [
        {
          attachmentId: 'invoice',
          fileName: 'invoice.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
          partitionCode: 'private',
          storagePath: 'org_shared/tenant_shared/invoice.pdf',
          storageDriver: 'local',
        },
      ],
    })

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user2@example.com',
        subject: 'Subject',
      }),
    )
    expect(messageEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        senderName: 'Alice',
        viewUrl: expect.stringMatching(/^https:\/\/mercato\.test\/messages\/view\//),
        attachmentNames: ['invoice.pdf'],
        objectLabels: ['sales.order (order-1)'],
      }),
    )
  })

  it('rechecks attachment access before sending bytes and refuses a denied owner', async () => {
    const readScoped = jest.fn(async () => { throw Object.assign(new Error('denied'), { status: 403 }) })
    await expect(sendMessageEmailToExternal({
      message: baseMessage, email: 'outside@example.com', sender: { name: null, email: null }, objects: [],
      attachments: [{ attachmentId: 'protected', fileName: 'secret.txt', fileSize: 4, mimeType: 'text/plain', partitionCode: 'private', storagePath: 'secret', storageDriver: 'local' }],
      attachmentAccess: { auth: { sub: 'sender-1', tenantId: 'tenant-1', orgId: 'org-1' }, service: { readScoped } as never },
    })).rejects.toMatchObject({ status: 403 })
    expect(readScoped).toHaveBeenCalledWith(expect.objectContaining({ expectedOwner: { entityId: 'messages:message', recordId: 'message-1' } }))
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('sends external email without view url', async () => {
    await sendMessageEmailToExternal({
      message: baseMessage,
      email: 'external@example.com',
      sender: { name: null, email: 'sender@example.com' },
      objects: [],
      attachments: [],
    })

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'external@example.com',
        subject: 'Subject',
      }),
    )
    expect(messageEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        senderName: 'sender@example.com',
        viewUrl: null,
      }),
    )
  })
})
