/**
 * The write half of the configuration path (issue #4778): the only place the
 * `aiAutoReplyEnabled` / `aiAgentId` keys are ever set.
 *
 * What matters here is not that the values land — it is that they land WITHOUT
 * collateral damage. `channelState` is shared with the gateway worker, which
 * writes resume state from a socket callback, so a settings save that replaced
 * the blob would silently cost a live session its cursor.
 */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (_em: unknown, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
  }),
}))

import updateAiAutoReplyCommand from '../update-ai-auto-reply'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const findOne = findOneWithDecryption as unknown as jest.Mock

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const CHANNEL = '33333333-3333-4333-8333-333333333333'
const UPDATED_AT = new Date('2026-08-01T10:00:00.000Z')

function makeCtx(request?: Request) {
  const em = { fork: () => ({}) }
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : {}) },
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    request,
  } as never
}

function channelRow(channelState: Record<string, unknown>) {
  return { id: CHANNEL, updatedAt: UPDATED_AT, channelState }
}

const gatewayState = {
  sessionId: 'sess-1',
  sequence: 42,
  resumeGatewayUrl: 'wss://gateway.discord.gg',
  botUserId: 'bot-1',
}

function baseInput(settings: Record<string, unknown>) {
  return {
    channelId: CHANNEL,
    settings,
    scope: { tenantId: TENANT, organizationId: ORG },
  }
}

describe('channel_discord.channel.update_ai_auto_reply', () => {
  beforeEach(() => {
    findOne.mockReset()
  })

  it('arms the channel while carrying the gateway resume state forward', async () => {
    const channel = channelRow({ ...gatewayState })
    findOne.mockResolvedValueOnce(channel)

    const result = await updateAiAutoReplyCommand.execute(
      baseInput({ aiAutoReplyEnabled: true, aiAgentId: 'channel_discord.auto_reply' }) as never,
      makeCtx(),
    )

    expect(result).toMatchObject({
      status: 'updated',
      aiAutoReplyEnabled: true,
      aiAgentId: 'channel_discord.auto_reply',
    })
    expect(channel.channelState).toEqual({
      ...gatewayState,
      aiAutoReplyEnabled: true,
      aiAgentId: 'channel_discord.auto_reply',
    })
  })

  it('clears the agent when auto-reply is switched off, so stored state stays honest', async () => {
    const channel = channelRow({ ...gatewayState, aiAutoReplyEnabled: true, aiAgentId: 'channel_discord.auto_reply' })
    findOne.mockResolvedValueOnce(channel)

    const result = await updateAiAutoReplyCommand.execute(
      baseInput({ aiAutoReplyEnabled: false }) as never,
      makeCtx(),
    )

    expect(result).toMatchObject({ status: 'updated', aiAutoReplyEnabled: false, aiAgentId: null })
    expect((channel.channelState as { aiAgentId?: string }).aiAgentId).toBeUndefined()
    expect(channel.channelState).toMatchObject(gatewayState)
  })

  it('refuses to arm a channel without naming an agent', async () => {
    await expect(
      updateAiAutoReplyCommand.execute(baseInput({ aiAutoReplyEnabled: true }) as never, makeCtx()),
    ).rejects.toThrow()
    expect(findOne).not.toHaveBeenCalled()
  })

  it('scopes the lookup to the tenant and the discord provider', async () => {
    findOne.mockResolvedValueOnce(channelRow({}))

    await updateAiAutoReplyCommand.execute(
      baseInput({ aiAutoReplyEnabled: true, aiAgentId: 'channel_discord.auto_reply' }) as never,
      makeCtx(),
    )

    const [, , where] = findOne.mock.calls[0]
    expect(where).toMatchObject({
      id: CHANNEL,
      tenantId: TENANT,
      providerKey: 'discord',
      deletedAt: null,
    })
  })

  it('keeps a tenant-scoped bot channel reachable while narrowing to the caller’s organizations', async () => {
    findOne.mockResolvedValueOnce(channelRow({}))

    await updateAiAutoReplyCommand.execute(
      {
        ...baseInput({ aiAutoReplyEnabled: false }),
        scope: { tenantId: TENANT, organizationId: ORG, organizationIds: [ORG] },
      } as never,
      makeCtx(),
    )

    const [, , where] = findOne.mock.calls[0]
    // A Discord bot channel normally has `organization_id IS NULL`; an equality
    // filter on the caller's organization would hide it outright.
    expect(where.$or).toEqual([{ organizationId: { $in: [ORG] } }, { organizationId: null }])
  })

  it('masks a channel it cannot see rather than reporting why', async () => {
    findOne.mockResolvedValueOnce(null)

    const result = await updateAiAutoReplyCommand.execute(
      baseInput({ aiAutoReplyEnabled: false }) as never,
      makeCtx(),
    )

    expect(result).toEqual({ status: 'not_found' })
  })

  it('rejects a save from a tab that loaded the channel before someone else changed it', async () => {
    const channel = channelRow({ ...gatewayState })
    findOne.mockResolvedValueOnce(channel)
    const staleRequest = new Request('https://example.test/', {
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: new Date('2026-07-01T09:00:00.000Z').toISOString() },
    })

    const failure = await updateAiAutoReplyCommand
      .execute(baseInput({ aiAutoReplyEnabled: false }) as never, makeCtx(staleRequest))
      .catch((err: unknown) => err)

    expect(isCrudHttpError(failure)).toBe(true)
    if (isCrudHttpError(failure)) expect(failure.status).toBe(409)
    // The stale save must not have touched the row on its way out.
    expect(channel.channelState).toEqual(gatewayState)
  })

  it('accepts a save whose expected version matches the current one', async () => {
    const channel = channelRow({ ...gatewayState })
    findOne.mockResolvedValueOnce(channel)
    const freshRequest = new Request('https://example.test/', {
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() },
    })

    const result = await updateAiAutoReplyCommand.execute(
      baseInput({ aiAutoReplyEnabled: false }) as never,
      makeCtx(freshRequest),
    )

    expect(result).toMatchObject({ status: 'updated' })
  })
})
