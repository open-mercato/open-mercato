import 'reflect-metadata'

type Scope = { tenantId: string; organizationId: string }
const emitted: Array<{ eventId: string; payload: Record<string, unknown>; scope?: Scope }> = []

jest.mock('../events', () => ({
  emitFormsEvent: jest.fn(async (eventId: string, payload: Record<string, unknown>, scope?: Scope) => {
    emitted.push({ eventId, payload, scope })
  }),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: jest.requireActual('@open-mercato/shared/lib/i18n/translate').createFallbackTranslator({
      'forms.invitation.email.greeting': 'Hi {name},',
    }),
  })),
}))

const invitationStore = new Map<string, Record<string, unknown>>()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
    const row = invitationStore.get(String(where.id))
    if (!row) return null
    return Object.entries(where).every(([key, value]) => (row[key] ?? null) === value) ? row : null
  }),
}))

import { sendEmail } from '@open-mercato/shared/lib/email/send'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createInvitationCommand, sendInvitationCommand } from '../commands/invitation'
import handleInvitationSent from '../subscribers/invitation-email'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const distributionId = '33333333-3333-4333-8333-333333333333'

const sendEmailMock = sendEmail as jest.Mock

function buildEntityManager() {
  let sequence = 0
  const em = {
    fork: () => em,
    findOne: jest.fn(async () => ({ id: distributionId, mode: 'personal' })),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      sequence += 1
      const id = `44444444-4444-4444-8444-${String(sequence).padStart(12, '0')}`
      const invitation = { ...data, id }
      invitationStore.set(id, invitation)
      return invitation
    }),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  return em
}

function buildCommandContext(em: ReturnType<typeof buildEntityManager>): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => (name === 'em' ? em : undefined),
      hasRegistration: () => false,
    },
    auth: { sub: 'user-1', tenantId, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  } as unknown as CommandRuntimeContext
}

async function deliverSentEvents(em: ReturnType<typeof buildEntityManager>): Promise<void> {
  const sent = emitted.filter((entry) => entry.eventId === 'forms.invitation.sent')
  emitted.length = 0
  for (const entry of sent) {
    await handleInvitationSent(
      entry.payload as { invitationId: string; distributionId: string; source?: 'create' | 'send' },
      { ...entry.scope, container: { resolve: <T,>(name: string) => (name === 'em' ? em : undefined) as T } },
    )
  }
}

describe('forms invitation e-mail (RL-11)', () => {
  const originalAppUrl = process.env.APP_URL

  beforeEach(() => {
    process.env.APP_URL = 'https://forms.example.test'
    emitted.length = 0
    invitationStore.clear()
    sendEmailMock.mockClear()
  })

  afterAll(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originalAppUrl
  })

  it('sends exactly one e-mail, with the personal link, when an invitation is created', async () => {
    const em = buildEntityManager()

    await createInvitationCommand.execute(
      {
        tenantId,
        organizationId,
        distributionId,
        recipients: [{ email: 'recipient@example.test', name: 'Recipient' }],
      },
      buildCommandContext(em),
    )
    const sentEvents = emitted.filter((entry) => entry.eventId === 'forms.invitation.sent')
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0].payload.source).toBe('create')

    await deliverSentEvents(em)

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const element = sendEmailMock.mock.calls[0][0].react
    expect(JSON.stringify(element.props)).toContain('https://forms.example.test/i/')
    expect(JSON.stringify(element.props)).toContain('Hi Recipient,')
  })

  it.each([1, 2])('sends a reminder without a link on send #%i (send and resend)', async (sendCount) => {
    const em = buildEntityManager()
    await createInvitationCommand.execute(
      {
        tenantId,
        organizationId,
        distributionId,
        recipients: [{ email: 'recipient@example.test' }],
      },
      buildCommandContext(em),
    )
    await deliverSentEvents(em)
    sendEmailMock.mockClear()
    const [invitationId] = Array.from(invitationStore.keys())

    for (let attempt = 0; attempt < sendCount; attempt += 1) {
      await sendInvitationCommand.execute(
        { tenantId, organizationId, invitationId },
        buildCommandContext(em),
      )
    }
    const sentEvents = emitted.filter((entry) => entry.eventId === 'forms.invitation.sent')
    expect(sentEvents.map((entry) => entry.payload.source)).toEqual(Array(sendCount).fill('send'))

    await deliverSentEvents(em)

    expect(sendEmailMock).toHaveBeenCalledTimes(sendCount)
    for (const call of sendEmailMock.mock.calls) {
      expect(JSON.stringify(call[0].react.props)).not.toContain('/i/')
      expect(JSON.stringify(call[0].react.props)).toContain('Hi recipient@example.test,')
    }
  })

  it('still sends the scoped reminder when the optional source is absent', async () => {
    const em = buildEntityManager()
    const invitationId = '55555555-5555-4555-8555-555555555555'
    invitationStore.set(invitationId, { id: invitationId, tenantId, organizationId, distributionId, recipientEmail: 'legacy@example.test' })

    await handleInvitationSent(
      { invitationId, distributionId },
      { tenantId, organizationId, container: { resolve: <T,>(name: string) => (name === 'em' ? em : undefined) as T } },
    )

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })
  it.each([
    {},
    { tenantId },
    { organizationId },
    { tenantId, organizationId: 'another-organization' },
    { tenantId: 'another-tenant', organizationId },
  ])('skips reminders outside the invitation scope', async (scope) => {
    const em = buildEntityManager()
    const invitationId = '55555555-5555-4555-8555-555555555555'
    invitationStore.set(invitationId, { id: invitationId, distributionId, tenantId, organizationId, recipientEmail: 'qa@example.test' })
    await handleInvitationSent({ invitationId, distributionId, source: 'send' }, {
      ...scope,
      container: { resolve: <T,>() => em as T },
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

})
