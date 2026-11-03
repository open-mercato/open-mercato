/**
 * The approval surface's two commands (issue #4778).
 *
 * The propose-only guarantee has two halves. The subscriber owns "never send
 * without a human" (covered in `subscribers/__tests__/ai-auto-reply.test.ts`);
 * these commands own "when a human does approve, send exactly what they saw, in
 * the right conversation, attributed to them" — and refuse to send anything else.
 */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageReadAccess: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(),
}))

import { approveProposalCommand, dismissProposalCommand } from '../ai-reply-proposal'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { composeMessageSchema } from '@open-mercato/core/modules/messages/data/validators'
import { resolveMessageReadAccess } from '@open-mercato/core/modules/messages/lib/routeHelpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator, createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import enTranslations from '../../i18n/en.json'
import plTranslations from '../../i18n/pl.json'
import { CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../../message-types'
import { createDiscordProposalOriginKey } from '../../lib/ai-proposal-origin'
import { CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE } from '../../lib/ai-proposal-contract'

const findOne = findOneWithDecryption as unknown as jest.Mock
const readAccess = resolveMessageReadAccess as unknown as jest.Mock

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OPERATOR = '44444444-4444-4444-8444-444444444444'
const PROPOSAL_ID = '55555555-5555-4555-8555-555555555555'
const INBOUND_ID = '66666666-6666-4666-8666-666666666666'
/** The hub validates `parentMessageId` as a UUID, so the thread this replies into has to be one. */
const THREAD_ID = '77777777-7777-4777-8777-777777777777'

function makeCtx() {
  const em = { fork: () => ({}) }
  const commandBus = { execute: jest.fn(async () => ({ result: { id: 'sent-1', threadId: 'thread-1' } })) }
  return {
    ctx: {
      container: { resolve: (name: string) => (name === 'em' ? em : commandBus) },
      auth: { sub: OPERATOR, tenantId: TENANT, orgId: ORG },
      organizationScope: null,
      selectedOrganizationId: ORG,
      organizationIds: [ORG],
    } as never,
    commandBus,
  }
}

function proposalRow(overrides: Record<string, unknown> = {}) {
  const proposal = {
    id: PROPOSAL_ID,
    type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
    tenantId: TENANT,
    organizationId: ORG,
    senderUserId: '00000000-0000-0000-0000-000000000000',
    visibility: 'internal' as const,
    bodyFormat: 'markdown' as const,
    body: 'We open at 9 and close at 5.',
    sourceEntityType: CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE,
    sourceEntityId: INBOUND_ID,
    ...overrides,
  }
  return { ...proposal, idempotencyKey: createDiscordProposalOriginKey(proposal) }
}

function inboundRow() {
  return {
    id: INBOUND_ID,
    type: 'channel.discord',
    subject: 'Opening hours',
    threadId: 'thread-1',
  }
}

const actionInput = { messageId: PROPOSAL_ID, actionId: 'approve_send' }

describe('channel_discord.ai_reply_proposal.approve', () => {
  beforeEach(() => {
    findOne.mockReset()
    jest.mocked(resolveTranslations).mockResolvedValue({
      locale: 'en', dict: enTranslations, t: createTranslator(enTranslations), translate: createFallbackTranslator(enTranslations),
    })
    readAccess.mockReset()
    readAccess.mockResolvedValue({ recipient: null, isSender: false, hasChannelThreadAccess: true, canRead: true })
  })

  it('sends the proposed text into the original thread, attributed to the approver', async () => {
    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(inboundRow())
    const { ctx, commandBus } = makeCtx()

    const result = await approveProposalCommand.execute(actionInput as never, ctx)

    expect(result).toMatchObject({ ok: true, sentMessageId: 'sent-1' })
    const [commandId, args] = commandBus.execute.mock.calls[0]
    expect(commandId).toBe('messages.messages.compose')
    expect(args.input).toMatchObject({
      body: 'We open at 9 and close at 5.',
      visibility: 'public',
      isDraft: false,
      parentMessageId: 'thread-1',
      // The human who pressed approve owns the send, not the bot.
      userId: OPERATOR,
      tenantId: TENANT,
      organizationId: ORG,
    })
  })

  /**
   * #5601 broke this path too, not only the automatic tier: the approve command
   * composes the same public reply through the same hub command, so an omitted
   * channel type made the hub demand an `externalEmail` from a Discord sender
   * and a human pressing approve got a validation error instead of a send.
   *
   * Checked against the hub's REAL `composeMessageSchema`, so the assertion
   * fails for the reason production failed rather than for a literal.
   */
  it('composes a payload the hub’s own validator accepts, with no address anywhere', async () => {
    findOne
      .mockResolvedValueOnce(proposalRow())
      .mockResolvedValueOnce({ ...inboundRow(), threadId: THREAD_ID })
    const { ctx, commandBus } = makeCtx()

    await approveProposalCommand.execute(actionInput as never, ctx)

    const [, args] = commandBus.execute.mock.calls[0]
    expect(args.input.sourceChannelType).toBe('discord')
    expect(args.input.externalEmail).toBeUndefined()

    const parsed = composeMessageSchema.safeParse(args.input)
    expect(
      parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.')),
    ).toEqual([])
  })

  it('refuses to send a message that is not one of its own proposals', async () => {
    findOne.mockResolvedValueOnce(proposalRow({ type: 'channel.discord' }))
    const { ctx, commandBus } = makeCtx()

    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toThrow(
      /not a Discord AI reply proposal/i,
    )
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('refuses a client-filed proposal even when the approver can read its target', async () => {
    findOne.mockResolvedValueOnce({ ...proposalRow(), senderUserId: OPERATOR, idempotencyKey: null })
    const { ctx, commandBus } = makeCtx()

    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toThrow(/system origin/i)

    expect(findOne).toHaveBeenCalledTimes(1)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it.each([
    { body: 'Forged public reply' },
    { sourceEntityId: PROPOSAL_ID },
    { senderUserId: OPERATOR },
    { actionData: { actions: [{ id: 'approve_send', label: 'Approve', isTerminal: false }] } },
  ])('refuses a tampered system proposal: %j', async (overrides) => {
    findOne.mockResolvedValueOnce({ ...proposalRow(), ...overrides })
    const { ctx, commandBus } = makeCtx()

    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toThrow(/system origin/i)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('looks up the proposal and source in the acting organization', async () => {
    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(inboundRow())
    const { ctx } = makeCtx()

    await approveProposalCommand.execute(actionInput as never, ctx)

    expect(findOne.mock.calls.map((call) => call[2])).toEqual([
      { id: PROPOSAL_ID, tenantId: TENANT, organizationId: ORG, deletedAt: null },
      { id: INBOUND_ID, tenantId: TENANT, organizationId: ORG, deletedAt: null },
    ])
  })

  it('refuses when the conversation it answers is gone', async () => {
    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(null)
    const { ctx, commandBus } = makeCtx()

    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toThrow(
      /no longer exists/i,
    )
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('looks the answered message up in the approver organization only', async () => {
    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(inboundRow())
    const { ctx } = makeCtx()

    await approveProposalCommand.execute(actionInput as never, ctx)

    expect(findOne.mock.calls[1][2]).toEqual({
      id: INBOUND_ID,
      tenantId: TENANT,
      organizationId: ORG,
      deletedAt: null,
    })
  })

  it('checks the approver can read the answered message before sending into its thread', async () => {
    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(inboundRow())
    const { ctx, commandBus } = makeCtx()

    await approveProposalCommand.execute(actionInput as never, ctx)

    expect(readAccess).toHaveBeenCalledWith(
      ctx,
      { tenantId: TENANT, organizationId: ORG, userId: OPERATOR },
      expect.objectContaining({ id: INBOUND_ID }),
    )
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
  })

  it('refuses to send when the approver can no longer read the answered message', async () => {
    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(inboundRow())
    readAccess.mockResolvedValueOnce({ recipient: null, isSender: false, hasChannelThreadAccess: false, canRead: false })
    const { ctx, commandBus } = makeCtx()

    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toThrow(
      /can no longer read the conversation this proposal answers/i,
    )
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['en', enTranslations],
    ['pl', plTranslations],
  ] as const)('returns localized 403 and 404 refusals in %s without composing', async (locale, dict) => {
    jest.mocked(resolveTranslations).mockResolvedValue({ locale, dict, t: createTranslator(dict), translate: createFallbackTranslator(dict) })
    const { ctx, commandBus } = makeCtx()
    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(inboundRow())
    readAccess.mockResolvedValueOnce({ canRead: false })

    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toMatchObject({
      status: 403,
      body: { error: dict['channel_discord.aiProposal.errors.sourceMessageUnreadable'] },
    })

    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(null)
    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toMatchObject({
      status: 404,
      body: { error: dict['channel_discord.aiProposal.errors.sourceMessageNotFound'] },
    })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('refuses an empty proposal rather than posting a blank Discord message', async () => {
    findOne.mockResolvedValueOnce(proposalRow({ body: '   ' })).mockResolvedValueOnce(inboundRow())
    const { ctx, commandBus } = makeCtx()

    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toThrow(/empty body/i)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('requires an authenticated actor — nothing approves itself', async () => {
    const { ctx } = makeCtx()
    const anonymous = { ...(ctx as unknown as Record<string, unknown>), auth: null } as never

    await expect(approveProposalCommand.execute(actionInput as never, anonymous)).rejects.toThrow(
      /authenticated actor/i,
    )
  })

  it('declares itself non-undoable — a posted Discord message cannot be recalled', () => {
    expect(approveProposalCommand.isUndoable).toBe(false)
  })
})

describe('channel_discord.ai_reply_proposal.dismiss', () => {
  beforeEach(() => {
    findOne.mockReset()
  })

  it('acknowledges without sending anything', async () => {
    findOne.mockResolvedValueOnce(proposalRow())
    const { ctx, commandBus } = makeCtx()

    const result = await dismissProposalCommand.execute(
      { messageId: PROPOSAL_ID, actionId: 'dismiss' } as never,
      ctx,
    )

    expect(result).toEqual({ ok: true, dismissed: true })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('refuses to acknowledge a message that is not one of its own proposals', async () => {
    findOne.mockResolvedValueOnce(proposalRow({ type: 'channel.discord' }))
    const { ctx } = makeCtx()

    await expect(
      dismissProposalCommand.execute({ messageId: PROPOSAL_ID, actionId: 'dismiss' } as never, ctx),
    ).rejects.toThrow(/not a Discord AI reply proposal/i)
  })

  it('refuses to acknowledge a client-filed proposal', async () => {
    findOne.mockResolvedValueOnce({ ...proposalRow(), idempotencyKey: null })
    const { ctx } = makeCtx()

    await expect(
      dismissProposalCommand.execute({ messageId: PROPOSAL_ID, actionId: 'dismiss' } as never, ctx),
    ).rejects.toThrow(/system origin/i)
  })
})
