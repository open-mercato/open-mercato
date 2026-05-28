import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import {
  AiChatConversation,
  AiChatConversationParticipant,
  AiChatMessage,
} from '../entities'
import type {
  AiChatMessageAppendInput,
  AiChatPageContextInput,
} from '../validators'

/**
 * Persistent store for AI chat conversations, participants, and messages.
 *
 * Owner-first MVP per spec
 * `2026-05-05-ai-chat-server-side-conversation-storage`. Every read/write
 * goes through `findOneWithDecryption` / `findWithDecryption` so the repo
 * stays consistent with the rest of the module and is GDPR-encryption-ready
 * without a second refactor when `content` / `ui_parts` columns are
 * eventually flagged.
 *
 * Tenant + organization scope is required on every method. View-only callers
 * are owner-scoped. Callers with `ai_assistant.conversations.manage` may
 * list/read/update/delete any conversation in the same tenant/org, but never
 * outside that boundary. The participant row is written transactionally
 * alongside conversation create/import.
 *
 */

export interface AiChatConversationContext {
  tenantId: string
  organizationId?: string | null
  userId: string
  canManageConversations?: boolean
}

export interface AiChatConversationCreateOrGetInput {
  conversationId?: string | null
  agentId: string
  title?: string | null
  pageContext?: AiChatPageContextInput | null
  /** Marks the conversation as imported from local storage (sets `importedFromLocalAt`). */
  importedFromLocal?: boolean
  /** Optional explicit `now` for deterministic tests. */
  now?: Date
}

export interface AiChatConversationListOptions {
  agentId?: string | null
  status?: 'open' | 'closed' | null
  limit?: number
  cursor?: string | null
}

export interface AiChatConversationUpdateInput {
  title?: string | null
  status?: 'open' | 'closed'
  pageContext?: AiChatPageContextInput | null
  /** Optional explicit `now` for deterministic tests. */
  now?: Date
}

export interface AiChatTranscriptOptions {
  limit?: number
  /** ISO timestamp string; rows strictly older than this are returned. */
  before?: string | null
}

export interface AiChatTranscriptResult {
  conversation: AiChatConversation
  messages: AiChatMessage[]
  nextCursor: string | null
}

export interface AiChatMessageAppendOptions {
  /** Override the message timestamp (used to thread server-injected stream-completion turns). */
  createdAt?: Date
  /** Override `createdByUserId` (defaults to the calling context user). */
  createdByUserId?: string | null
}

export interface AiChatConversationImportResult {
  conversation: AiChatConversation
  importedMessageCount: number
  skippedMessageCount: number
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100
const DEFAULT_TRANSCRIPT_LIMIT = 100
const MAX_TRANSCRIPT_LIMIT = 200

export class AiChatConversationAccessError extends Error {
  override readonly name = 'AiChatConversationAccessError'
  constructor(message: string = 'Conversation is not accessible to the caller.') {
    super(message)
  }
}

export class AiChatConversationDuplicateParticipantError extends Error {
  override readonly name = 'AiChatConversationDuplicateParticipantError'
  constructor(message: string = 'User is already an active participant in this conversation.') {
    super(message)
  }
}

export class AiChatParticipantNotFoundError extends Error {
  override readonly name = 'AiChatParticipantNotFoundError'
  constructor(message: string = 'Participant not found or already revoked.') {
    super(message)
  }
}

export class AiChatConversationOrgNotFoundError extends Error {
  override readonly name = 'AiChatConversationOrgNotFoundError'
  constructor(message: string = 'Organization does not exist or is inactive for this tenant.') {
    super(message)
  }
}

export class AiChatConversationRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Idempotent create. If a non-deleted conversation already exists for the
   * caller in this tenant/org with the same `conversationId`, returns the
   * existing row. The owner-participant row is created in the same
   * transaction; a partial failure leaves no orphan conversation.
   */
  async createOrGet(
    input: AiChatConversationCreateOrGetInput,
    ctx: AiChatConversationContext,
  ): Promise<AiChatConversation> {
    assertContext(ctx, 'createOrGet')
    if (!input?.agentId) {
      throw new Error('AiChatConversationRepository.createOrGet requires agentId')
    }
    const now = input.now ?? new Date()
    const conversationId = (input.conversationId ?? '').trim() || generateConversationId()

    return this.em.transactional(async (tx) => {
      const existing = await findOneAccessibleConversation(
        tx as unknown as EntityManager,
        conversationId,
        ctx,
      )
      if (existing) {
        if (existing.ownerUserId !== ctx.userId) {
          throw new AiChatConversationAccessError()
        }
        return existing
      }
      await assertOrganizationExists(tx as unknown as EntityManager, ctx)
      const conversation = tx.create(AiChatConversation, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        conversationId,
        agentId: input.agentId,
        ownerUserId: ctx.userId,
        title: normalizeTitle(input.title),
        status: 'open',
        visibility: 'private',
        pageContext: input.pageContext ?? null,
        lastMessageAt: null,
        importedFromLocalAt: input.importedFromLocal ? now : null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as unknown as AiChatConversation)
      const participant = tx.create(AiChatConversationParticipant, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        conversationId,
        userId: ctx.userId,
        role: 'owner',
        lastReadAt: null,
        createdAt: now,
        updatedAt: now,
      } as unknown as AiChatConversationParticipant)
      await tx.persist(conversation).persist(participant).flush()
      return conversation
    })
  }

  /** Fetch within tenant/org. View-only callers see only their own conversations. */
  async getById(
    conversationId: string,
    ctx: AiChatConversationContext,
  ): Promise<AiChatConversation | null> {
    assertContext(ctx, 'getById')
    if (!conversationId) return null
    const row = await findOneAccessibleConversation(this.em, conversationId, ctx)
    if (!row) return null
    const isParticipant =
      !canManageConversations(ctx) && row.ownerUserId !== ctx.userId
        ? await this.loadParticipantFlag(
            this.em,
            ctx.tenantId!,
            ctx.organizationId,
            row.conversationId,
            ctx.userId!,
          )
        : false
    if (!canAccessConversation(row, ctx, isParticipant)) return null
    return row
  }

  /** Owner-scoped list unless the caller has tenant/org manage access. Participants also see shared conversations. */
  async list(
    ctx: AiChatConversationContext,
    options: AiChatConversationListOptions = {},
  ): Promise<{ items: AiChatConversation[]; nextCursor: string | null }> {
    assertContext(ctx, 'list')
    const limit = clampLimit(options.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
      deletedAt: null,
    }
    if (!canManageConversations(ctx)) {
      const participantFilter: FilterQuery<AiChatConversationParticipant> = {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deletedAt: null,
        ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
      }
      const participantRows = await findWithDecryption<AiChatConversationParticipant>(
        this.em,
        AiChatConversationParticipant,
        participantFilter,
        { fields: ['conversationId'] as any },
        { tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null },
      )
      const participantConvIds = participantRows.map((p) => p.conversationId)
      if (participantConvIds.length > 0) {
        where.$or = [
          { ownerUserId: ctx.userId },
          { conversationId: { $in: participantConvIds } },
        ]
      } else {
        where.ownerUserId = ctx.userId
      }
    }
    if (options.agentId) where.agentId = options.agentId
    if (options.status) where.status = options.status
    if (options.cursor) {
      const cursorDate = parseIso(options.cursor)
      if (cursorDate) {
        where.lastMessageAt = { $lt: cursorDate }
      }
    }
    const rows = await findWithDecryption<AiChatConversation>(
      this.em,
      AiChatConversation,
      where as any,
      {
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }] as any,
        limit: limit + 1,
      },
      {
        tenantId: ctx.tenantId ?? null,
        organizationId: ctx.organizationId ?? null,
      },
    )
    let nextCursor: string | null = null
    if (rows.length > limit) {
      const lastIncluded = rows[limit - 1]
      const cursorValue = lastIncluded.lastMessageAt ?? lastIncluded.createdAt
      nextCursor = cursorValue ? cursorValue.toISOString() : null
    }
    return { items: rows.slice(0, limit), nextCursor }
  }

  /** Update within tenant/org. View-only callers can update only their own conversations. */
  async update(
    conversationId: string,
    patch: AiChatConversationUpdateInput,
    ctx: AiChatConversationContext,
  ): Promise<AiChatConversation> {
    assertContext(ctx, 'update')
    if (!conversationId) {
      throw new Error('AiChatConversationRepository.update requires conversationId')
    }
    return this.em.transactional(async (tx) => {
      const existing = await findOneAccessibleConversation(
        tx as unknown as EntityManager,
        conversationId,
        ctx,
      )
      if (!existing) {
        throw new AiChatConversationAccessError(
          `Conversation "${conversationId}" was not found for the caller.`,
        )
      }
      if (!canAccessConversation(existing, ctx)) {
        throw new AiChatConversationAccessError()
      }
      const now = patch.now ?? new Date()
      if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
        existing.title = normalizeTitle(patch.title)
      }
      if (patch.status) existing.status = patch.status
      if (Object.prototype.hasOwnProperty.call(patch, 'pageContext')) {
        existing.pageContext = patch.pageContext ?? null
      }
      existing.updatedAt = now
      await tx.persist(existing).flush()
      return existing
    })
  }

  /** Soft-delete the conversation and all its messages in one transaction. */
  async softDelete(
    conversationId: string,
    ctx: AiChatConversationContext,
    now: Date = new Date(),
  ): Promise<void> {
    assertContext(ctx, 'softDelete')
    if (!conversationId) {
      throw new Error('AiChatConversationRepository.softDelete requires conversationId')
    }
    await this.em.transactional(async (tx) => {
      const existing = await findOneAccessibleConversation(
        tx as unknown as EntityManager,
        conversationId,
        ctx,
      )
      if (!existing) {
        throw new AiChatConversationAccessError(
          `Conversation "${conversationId}" was not found for the caller.`,
        )
      }
      if (!canAccessConversation(existing, ctx)) {
        throw new AiChatConversationAccessError()
      }
      existing.deletedAt = now
      existing.status = 'closed'
      existing.updatedAt = now
      await tx.persist(existing).flush()

      const messages = await findWithDecryption<AiChatMessage>(
        tx as unknown as EntityManager,
        AiChatMessage,
        {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId ?? null,
          conversationId,
          deletedAt: null,
        } as any,
        {},
        {
          tenantId: ctx.tenantId ?? null,
          organizationId: ctx.organizationId ?? null,
        },
      )
      for (const msg of messages) {
        msg.deletedAt = now
        msg.updatedAt = now
        tx.persist(msg)
      }
      if (messages.length > 0) await tx.flush()
    })
  }

  /**
   * Owner-only transcript hydration. Internally fetched DESC so the `before`
   * cursor naturally advances toward older messages, then reversed so the
   * response contract (`messages` array ordered ascending by `createdAt`)
   * stays stable for callers. `nextCursor` points to the OLDEST message in
   * the returned page — the next call with `before=<cursor>` fetches the
   * next-older window.
   */
  async getTranscript(
    conversationId: string,
    ctx: AiChatConversationContext,
    options: AiChatTranscriptOptions = {},
  ): Promise<AiChatTranscriptResult | null> {
    assertContext(ctx, 'getTranscript')
    if (!conversationId) return null
    const conversation = await this.getById(conversationId, ctx)
    if (!conversation) return null
    const limit = clampLimit(options.limit, DEFAULT_TRANSCRIPT_LIMIT, MAX_TRANSCRIPT_LIMIT)
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
      conversationId,
      deletedAt: null,
    }
    if (options.before) {
      const beforeDate = parseIso(options.before)
      if (beforeDate) {
        where.createdAt = { $lt: beforeDate }
      }
    }
    const rows = await findWithDecryption<AiChatMessage>(
      this.em,
      AiChatMessage,
      where as any,
      {
        orderBy: { createdAt: 'desc' } as any,
        limit: limit + 1,
      },
      {
        tenantId: ctx.tenantId ?? null,
        organizationId: ctx.organizationId ?? null,
      },
    )
    let nextCursor: string | null = null
    let pageDesc: AiChatMessage[]
    if (rows.length > limit) {
      pageDesc = rows.slice(0, limit)
      const oldestIncluded = pageDesc[pageDesc.length - 1]
      nextCursor = oldestIncluded?.createdAt ? oldestIncluded.createdAt.toISOString() : null
    } else {
      pageDesc = rows
    }
    const messages = [...pageDesc].reverse()
    return { conversation, messages, nextCursor }
  }

  /**
   * Append a single message to an owner-accessible conversation. Honors
   * `clientMessageId` idempotency: if a non-deleted message with the same
   * client id already exists, returns it untouched.
   */
  async appendMessage(
    conversationId: string,
    input: AiChatMessageAppendInput,
    ctx: AiChatConversationContext,
    options: AiChatMessageAppendOptions = {},
  ): Promise<AiChatMessage> {
    assertContext(ctx, 'appendMessage')
    if (!conversationId) {
      throw new Error('AiChatConversationRepository.appendMessage requires conversationId')
    }
    return this.em.transactional(async (tx) => {
      const conversation = await findOneAccessibleConversation(
        tx as unknown as EntityManager,
        conversationId,
        ctx,
      )
      if (!conversation) {
        throw new AiChatConversationAccessError(
          `Conversation "${conversationId}" was not found for the caller.`,
        )
      }
      if (conversation.ownerUserId !== ctx.userId) {
        throw new AiChatConversationAccessError()
      }
      const now = options.createdAt ?? new Date()
      if (input.clientMessageId) {
        const existing = await findOneWithDecryption<AiChatMessage>(
          tx as unknown as EntityManager,
          AiChatMessage,
          {
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId ?? null,
            conversationId,
            clientMessageId: input.clientMessageId,
            deletedAt: null,
          } as any,
          {},
          {
            tenantId: ctx.tenantId ?? null,
            organizationId: ctx.organizationId ?? null,
          },
        )
        if (existing) return existing
      }
      const message = tx.create(AiChatMessage, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        conversationId,
        clientMessageId: input.clientMessageId ?? null,
        role: input.role,
        content: input.content,
        uiParts: normalizeArray(input.uiParts),
        attachmentIds: normalizeArray(input.attachmentIds),
        filesMetadata: normalizeArray(input.files),
        model: input.model ?? null,
        metadata: input.metadata ?? null,
        createdByUserId:
          options.createdByUserId === undefined
            ? input.role === 'user'
              ? ctx.userId
              : null
            : options.createdByUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as unknown as AiChatMessage)
      conversation.lastMessageAt = now
      conversation.updatedAt = now
      await tx.persist(message).persist(conversation).flush()
      return message
    })
  }

  /**
   * Lazy migration entrypoint: create-or-get the conversation and append the
   * provided messages with `clientMessageId` dedupe. Designed to be safe to
   * call repeatedly — repeated imports of the same payload return the same
   * counts of imported/skipped rows.
   */
  async importLocalConversation(
    input: {
      conversation: AiChatConversationCreateOrGetInput & {
        status?: 'open' | 'closed'
      }
      messages: AiChatMessageAppendInput[]
    },
    ctx: AiChatConversationContext,
    now: Date = new Date(),
  ): Promise<AiChatConversationImportResult> {
    assertContext(ctx, 'importLocalConversation')
    const conversation = await this.createOrGet(
      { ...input.conversation, importedFromLocal: true, now },
      ctx,
    )
    if (input.conversation.status && conversation.status !== input.conversation.status) {
      await this.update(
        conversation.conversationId,
        { status: input.conversation.status, now },
        ctx,
      )
    }
    let imported = 0
    let skipped = 0
    for (const message of input.messages) {
      if (!message.clientMessageId) {
        // Without an idempotency key the import has no safe way to dedupe.
        skipped += 1
        continue
      }
      const before = await findOneWithDecryption<AiChatMessage>(
        this.em,
        AiChatMessage,
        {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId ?? null,
          conversationId: conversation.conversationId,
          clientMessageId: message.clientMessageId,
          deletedAt: null,
        } as any,
        {},
        {
          tenantId: ctx.tenantId ?? null,
          organizationId: ctx.organizationId ?? null,
        },
      )
      if (before) {
        skipped += 1
        continue
      }
      await this.appendMessage(
        conversation.conversationId,
        message,
        ctx,
        { createdAt: now },
      )
      imported += 1
    }
    return {
      conversation,
      importedMessageCount: imported,
      skippedMessageCount: skipped,
    }
  }

  async listParticipants(
    conversationId: string,
    ctx: AiChatConversationContext,
  ): Promise<AiChatConversationParticipant[]> {
    assertContext(ctx, 'listParticipants')
    const conv = await findOneAccessibleConversation(this.em, conversationId, ctx)
    if (!conv) {
      throw new AiChatConversationAccessError(
        `Conversation "${conversationId}" was not found for the caller.`,
      )
    }
    if (conv.ownerUserId !== ctx.userId && !canManageConversations(ctx)) {
      throw new AiChatConversationAccessError(
        'Only the conversation owner or a manager can list participants.',
      )
    }
    const filter: FilterQuery<AiChatConversationParticipant> = {
      tenantId: ctx.tenantId,
      conversationId,
      deletedAt: null,
      ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
    }
    return findWithDecryption<AiChatConversationParticipant>(
      this.em,
      AiChatConversationParticipant,
      filter,
      { orderBy: { createdAt: 'asc' } as any },
      { tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null },
    )
  }

  async addParticipant(
    conversationId: string,
    userId: string,
    role: 'viewer',
    ctx: AiChatConversationContext,
  ): Promise<AiChatConversationParticipant> {
    assertContext(ctx, 'addParticipant')
    return this.em.transactional(async (tx) => {
      const conv = await findOneAccessibleConversation(
        tx as unknown as EntityManager,
        conversationId,
        ctx,
      )
      if (!conv) {
        throw new AiChatConversationAccessError(
          `Conversation "${conversationId}" was not found for the caller.`,
        )
      }
      if (conv.ownerUserId !== ctx.userId) {
        throw new AiChatConversationAccessError(
          'Only the conversation owner can add participants.',
        )
      }
      const existingFilter: FilterQuery<AiChatConversationParticipant> = {
        tenantId: ctx.tenantId,
        conversationId,
        userId,
        ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
      }
      const existing = await findOneWithDecryption<AiChatConversationParticipant>(
        tx as unknown as EntityManager,
        AiChatConversationParticipant,
        existingFilter,
      )
      if (existing) {
        if (existing.deletedAt === null) {
          throw new AiChatConversationDuplicateParticipantError()
        }
        existing.deletedAt = null
        existing.role = role
        await tx.persist(existing).flush()
        if (conv.visibility === 'private') {
          conv.visibility = 'shared'
          await tx.persist(conv).flush()
        }
        return existing
      }
      const participant = tx.create(AiChatConversationParticipant, {
        tenantId: ctx.tenantId!,
        organizationId: ctx.organizationId ?? null,
        conversationId,
        userId,
        role,
      } as unknown as AiChatConversationParticipant)
      if (conv.visibility === 'private') {
        conv.visibility = 'shared'
      }
      await tx.persist(participant).persist(conv).flush()
      return participant
    })
  }

  async revokeParticipant(
    conversationId: string,
    targetUserId: string,
    ctx: AiChatConversationContext,
  ): Promise<void> {
    assertContext(ctx, 'revokeParticipant')
    await this.em.transactional(async (tx) => {
      const conv = await findOneAccessibleConversation(
        tx as unknown as EntityManager,
        conversationId,
        ctx,
      )
      if (!conv) {
        throw new AiChatConversationAccessError(
          `Conversation "${conversationId}" was not found for the caller.`,
        )
      }
      if (conv.ownerUserId !== ctx.userId) {
        throw new AiChatConversationAccessError(
          'Only the conversation owner can revoke participants.',
        )
      }
      if (targetUserId === conv.ownerUserId) {
        throw new AiChatConversationAccessError('Cannot revoke the conversation owner.')
      }
      const participantFilter: FilterQuery<AiChatConversationParticipant> = {
        tenantId: ctx.tenantId,
        conversationId,
        userId: targetUserId,
        deletedAt: null,
        ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
      }
      const participant = await findOneWithDecryption<AiChatConversationParticipant>(
        tx as unknown as EntityManager,
        AiChatConversationParticipant,
        participantFilter,
      )
      if (!participant) throw new AiChatParticipantNotFoundError()
      participant.deletedAt = new Date()
      const remainingCount = await tx.count(AiChatConversationParticipant, {
        tenantId: ctx.tenantId,
        conversationId,
        deletedAt: null,
        role: { $ne: 'owner' },
      } as FilterQuery<AiChatConversationParticipant>)
      if (remainingCount <= 1) {
        conv.visibility = 'private'
        await tx.persist(conv)
      }
      await tx.persist(participant).flush()
    })
  }

  async getParticipantCount(
    tenantId: string,
    organizationId: string | null | undefined,
    conversationId: string,
  ): Promise<number> {
    return this.em.count(AiChatConversationParticipant, {
      tenantId,
      conversationId,
      deletedAt: null,
      role: { $ne: 'owner' },
      ...(organizationId ? { organizationId } : {}),
    } as FilterQuery<AiChatConversationParticipant>)
  }

  private async loadParticipantFlag(
    em: EntityManager,
    tenantId: string,
    organizationId: string | null | undefined,
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const row = await findOneWithDecryption<AiChatConversationParticipant>(
      em,
      AiChatConversationParticipant,
      {
        tenantId,
        conversationId,
        userId,
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
      } as FilterQuery<AiChatConversationParticipant>,
    )
    return row !== null
  }
}

function assertContext(ctx: AiChatConversationContext | undefined, method: string): void {
  if (!ctx?.tenantId) {
    throw new Error(`AiChatConversationRepository.${method} requires tenantId`)
  }
  if (!ctx?.userId) {
    throw new Error(`AiChatConversationRepository.${method} requires userId`)
  }
}

function canManageConversations(ctx: AiChatConversationContext): boolean {
  return ctx.canManageConversations === true
}

function canAccessConversation(
  row: AiChatConversation,
  ctx: AiChatConversationContext,
  isParticipant = false,
): boolean {
  return canManageConversations(ctx) || row.ownerUserId === ctx.userId || isParticipant
}

async function assertOrganizationExists(
  em: EntityManager,
  ctx: AiChatConversationContext,
): Promise<void> {
  if (!ctx.organizationId) return
  const org = await findOneWithDecryption<Organization>(
    em,
    Organization,
    {
      id: ctx.organizationId,
      tenant: ctx.tenantId,
      deletedAt: null,
      isActive: true,
    } as any,
    {},
    {
      tenantId: ctx.tenantId ?? null,
      organizationId: ctx.organizationId ?? null,
    },
  )
  if (!org) {
    throw new AiChatConversationOrgNotFoundError(
      `Organization "${ctx.organizationId}" does not exist or is inactive in tenant "${ctx.tenantId}".`,
    )
  }
}

async function findOneAccessibleConversation(
  em: EntityManager,
  conversationId: string,
  ctx: AiChatConversationContext,
): Promise<AiChatConversation | null> {
  const row = await findOneWithDecryption<AiChatConversation>(
    em,
    AiChatConversation,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
      conversationId,
      deletedAt: null,
    } as any,
    {},
    {
      tenantId: ctx.tenantId ?? null,
      organizationId: ctx.organizationId ?? null,
    },
  )
  return row ?? null
}

function normalizeTitle(title: string | null | undefined): string | null {
  if (title === undefined) return null
  if (title === null) return null
  const trimmed = title.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeArray<T>(value: T[] | null | undefined): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  return value
}

function clampLimit(value: number | undefined | null, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(Math.floor(value), max))
}

function parseIso(value: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function generateConversationId(): string {
  // Prefer the runtime crypto generator when present; fall back to a non-cryptographic
  // string for environments without `crypto.randomUUID()` (older Node / test mocks).
  const cryptoMod: { randomUUID?: () => string } | undefined =
    typeof globalThis === 'object' ? (globalThis as any).crypto : undefined
  if (cryptoMod?.randomUUID) return cryptoMod.randomUUID()
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export default AiChatConversationRepository
