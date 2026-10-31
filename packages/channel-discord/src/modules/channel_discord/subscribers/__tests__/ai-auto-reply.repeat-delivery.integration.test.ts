/** @jest-environment node */
/**
 * Repeat delivery of `communication_channels.message.received` against a real
 * PostgreSQL, the real `messages.messages.compose` handler and a stub model.
 *
 * The events worker re-runs every persistent subscriber when any one of them
 * fails, so the auto-reply subscriber sees the same inbound message twice. The
 * second delivery must find what the first one persisted: no second model call,
 * no second public reply, no second proposal. The bot-user lookup is real too,
 * so a lookup that works on the first delivery and fails on the second (falling
 * back to the sentinel sender) is exercised end to end.
 *
 * Gated on OM_PG_INTEGRATION=1 (Docker required):
 *
 *   yarn workspace @open-mercato/channel-discord test:pg-integration
 */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
} from '@open-mercato/core/modules/communication_channels/data/entities'
import {
  COMMUNICATION_CHANNELS_SYSTEM_USER_ID,
  systemUserEmail,
} from '@open-mercato/core/modules/communication_channels/lib/system-user'
import {
  Message,
  MessageAccessToken,
  MessageConfirmation,
  MessageObject,
  MessageRecipient,
} from '@open-mercato/core/modules/messages/data/entities'
import '@open-mercato/core/modules/messages/commands/messages'
import handler from '../ai-auto-reply'
import { CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID } from '../../ai-agents'
import { CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE } from '../../lib/ai-proposal-contract'
import { createDiscordProposalOriginKey } from '../../lib/ai-proposal-origin'
import { CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../../message-types'

jest.mock('@open-mercato/ai-assistant', () => ({ runAiAgentObject: jest.fn() }), { virtual: true })

const aiMod = jest.requireMock('@open-mercato/ai-assistant') as { runAiAgentObject: jest.Mock }

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'discord_auto_reply_retry_test'
const DATABASE_USER = 'discord_auto_reply_retry'
const DATABASE_PASSWORD = 'discord_auto_reply_retry'

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Scope = { tenantId: string; organizationId: string }

type EmittedEvent = { id: string; payload: { messageId?: string } }

const EASY_BODY = 'What are your opening hours?'
const COMPLEX_BODY = 'I want a refund on my order'

function modelAnswer(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'generate',
    object: {
      reply: 'We are open 9-5.',
      summary: 'Asks about opening hours.',
      confidence: 0.9,
      requiresHuman: false,
      ...overrides,
    },
  }
}

describeWithPostgres('channel_discord ai-auto-reply — repeat delivery on real persistence', () => {
  let postgres: StartedTestContainer | undefined
  let orm: TestOrm
  const emitted: EmittedEvent[] = []

  const commandBus = {
    execute: async (id: string, args: { input: unknown; ctx: unknown }) => {
      const command = commandRegistry.get(id)
      if (!command) throw new Error(`[internal] command ${id} is not registered`)
      return { result: await command.execute(args.input, args.ctx as never) }
    },
  }

  function subscriberCtx() {
    return {
      resolve: (name: string) => {
        if (name === 'em') return orm.em
        if (name === 'commandBus') return commandBus
        if (name === 'mcpToolRegistry') return {}
        throw new Error(`[internal] ${name} is not registered`)
      },
    }
  }

  async function seedInbound(scope: Scope, body: string, reviewerUserId: string | null = randomUUID()) {
    const em = orm.em.fork()
    const channel = em.create(CommunicationChannel, {
      providerKey: 'discord',
      channelType: 'discord',
      displayName: 'Support',
      userId: reviewerUserId,
      channelState: { aiAutoReplyEnabled: true, aiAgentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as never)
    const inboundId = randomUUID()
    const inbound = em.create(Message, {
      id: inboundId,
      type: 'channel.discord',
      visibility: 'public',
      subject: 'Discord',
      body,
      bodyFormat: 'text',
      senderUserId: COMMUNICATION_CHANNELS_SYSTEM_USER_ID,
      threadId: inboundId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as never)
    await em.persist([channel, inbound]).flush()
    return {
      payload: {
        providerKey: 'discord',
        direction: 'inbound',
        messageId: inbound.id,
        channelId: channel.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      inboundId: inbound.id,
    }
  }

  async function repliesTo(scope: Scope, inboundId: string) {
    return orm.em.fork().find(Message, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      idempotencyKey: `channel_discord:ai-auto-reply:${inboundId}`,
    })
  }

  async function proposalsFor(scope: Scope, inboundId: string) {
    return orm.em.fork().find(Message, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
      sourceEntityId: inboundId,
    })
  }

  function sentEventsFor(messageIds: string[]) {
    return emitted.filter(
      (event) => event.id === 'messages.message.sent' && messageIds.includes(event.payload.messageId ?? ''),
    )
  }

  async function insertBotUser(tenantId: string): Promise<string> {
    const id = randomUUID()
    const [emailHash] = lookupHashCandidates(systemUserEmail(tenantId))
    await orm.em.getConnection().execute(
      'insert into users (id, email_hash, tenant_id) values (?, ?, ?)',
      [id, emailHash, tenantId],
    )
    return id
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [
        Message,
        MessageRecipient,
        MessageObject,
        MessageAccessToken,
        MessageConfirmation,
        CommunicationChannel,
        ExternalConversation,
        ChannelThreadMapping,
      ],
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
    await orm.em.getConnection().execute(
      'create table users (id uuid primary key, email_hash text, tenant_id uuid, deleted_at timestamptz)',
    )
    setGlobalEventBus({
      emit: async (id: string, payload: unknown) => {
        emitted.push({ id, payload: payload as EmittedEvent['payload'] })
      },
    })
  }, 120_000)

  beforeEach(() => {
    emitted.length = 0
    aiMod.runAiAgentObject.mockReset()
  })

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  it('posts the public reply once and skips the model on the second delivery', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const { payload, inboundId } = await seedInbound(scope, EASY_BODY)
    aiMod.runAiAgentObject.mockResolvedValue(modelAnswer())

    await handler(payload, subscriberCtx())
    await handler(payload, subscriberCtx())

    expect(aiMod.runAiAgentObject).toHaveBeenCalledTimes(1)
    const replies = await repliesTo(scope, inboundId)
    expect(replies).toHaveLength(1)
    expect(replies[0].visibility).toBe('public')
    expect(sentEventsFor(replies.map((reply) => reply.id))).toHaveLength(1)
    expect(await proposalsFor(scope, inboundId)).toHaveLength(0)
  })

  it('files one proposal and skips the model on the second delivery', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const { payload, inboundId } = await seedInbound(scope, COMPLEX_BODY)
    aiMod.runAiAgentObject.mockResolvedValue(modelAnswer({ requiresHuman: true }))

    await handler(payload, subscriberCtx())
    await handler(payload, subscriberCtx())

    expect(aiMod.runAiAgentObject).toHaveBeenCalledTimes(1)
    const proposals = await proposalsFor(scope, inboundId)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].visibility).toBe('internal')
    expect(await repliesTo(scope, inboundId)).toHaveLength(0)
  })

  it('files one proposal when the bot-user lookup works first and fails on the retry', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const botUserId = await insertBotUser(scope.tenantId)
    const { payload, inboundId } = await seedInbound(scope, COMPLEX_BODY)
    aiMod.runAiAgentObject.mockResolvedValue(modelAnswer({ requiresHuman: true }))

    await handler(payload, subscriberCtx())
    const [first] = await proposalsFor(scope, inboundId)
    expect(first.senderUserId).toBe(botUserId)

    await orm.em.getConnection().execute('alter table users rename to users_unavailable')
    try {
      await handler(payload, subscriberCtx())
    } finally {
      await orm.em.getConnection().execute('alter table users_unavailable rename to users')
    }

    expect(aiMod.runAiAgentObject).toHaveBeenCalledTimes(1)
    expect(await proposalsFor(scope, inboundId)).toHaveLength(1)
  })

  it('files one proposal when the bot-user lookup fails first and works on the retry', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const { payload, inboundId } = await seedInbound(scope, COMPLEX_BODY)
    aiMod.runAiAgentObject.mockResolvedValue(modelAnswer({ requiresHuman: true }))

    await handler(payload, subscriberCtx())
    const [first] = await proposalsFor(scope, inboundId)
    expect(first.senderUserId).toBe(COMMUNICATION_CHANNELS_SYSTEM_USER_ID)

    await insertBotUser(scope.tenantId)
    await handler(payload, subscriberCtx())

    expect(aiMod.runAiAgentObject).toHaveBeenCalledTimes(1)
    expect(await proposalsFor(scope, inboundId)).toHaveLength(1)
  })

  it('does not let another organization’s rows suppress the reply', async () => {
    const tenantId = randomUUID()
    const scope = { tenantId, organizationId: randomUUID() }
    const otherScope = { tenantId, organizationId: randomUUID() }
    const { payload, inboundId } = await seedInbound(scope, EASY_BODY)
    const other = await seedInbound(otherScope, EASY_BODY)
    aiMod.runAiAgentObject.mockResolvedValue(modelAnswer())

    const em = orm.em.fork()
    const foreignProposal = {
      type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
      visibility: 'internal' as const,
      sourceEntityType: CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE,
      sourceEntityId: inboundId,
      bodyFormat: 'markdown' as const,
      body: 'Proposed elsewhere',
      senderUserId: COMMUNICATION_CHANNELS_SYSTEM_USER_ID,
      tenantId,
      organizationId: otherScope.organizationId,
    }
    em.create(Message, {
      ...foreignProposal,
      subject: 'Proposal',
      idempotencyKey: createDiscordProposalOriginKey(foreignProposal),
    } as never)
    await em.flush()

    await handler(other.payload, subscriberCtx())
    await handler(payload, subscriberCtx())
    await handler(payload, subscriberCtx())

    expect(aiMod.runAiAgentObject).toHaveBeenCalledTimes(2)
    const replies = await repliesTo(scope, inboundId)
    const otherReplies = await repliesTo(otherScope, other.inboundId)
    expect(replies).toHaveLength(1)
    expect(otherReplies).toHaveLength(1)
    expect(sentEventsFor([...replies, ...otherReplies].map((reply) => reply.id))).toHaveLength(2)
  })
})
