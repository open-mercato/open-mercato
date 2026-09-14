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

import { approveProposalCommand, dismissProposalCommand } from '../ai-reply-proposal'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { composeMessageSchema } from '@open-mercato/core/modules/messages/data/validators'
import { CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../../message-types'

const findOne = findOneWithDecryption as unknown as jest.Mock

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
  return {
    id: PROPOSAL_ID,
    type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
    body: 'We open at 9 and close at 5.',
    sourceEntityId: INBOUND_ID,
    ...overrides,
  }
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

  it('refuses when the conversation it answers is gone', async () => {
    findOne.mockResolvedValueOnce(proposalRow()).mockResolvedValueOnce(null)
    const { ctx, commandBus } = makeCtx()

    await expect(approveProposalCommand.execute(actionInput as never, ctx)).rejects.toThrow(
      /no longer exists/i,
    )
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
})
