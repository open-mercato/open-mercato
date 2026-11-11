import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CustomerEmailConversationShare, CustomerEntity } from '../data/entities'
import {
  emailConversationShareSetCommandSchema,
  type EmailConversationShareSetCommandInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { emitCustomersEvent } from '../events'
import { canShareConversation } from '../lib/conversationShares'

const RESOURCE_KIND = 'customers.email_conversation_share'

const POSTGRES_UNIQUE_VIOLATION = '23505'

type ShareSnapshot = {
  id: string
  personEntityId: string
  ownerUserId: string
  sharedByUserId: string
  tenantId: string
  organizationId: string
  createdAt: string
}

type ShareUndoPayload = {
  before?: ShareSnapshot | null
  after?: ShareSnapshot | null
}

function resolveActorUserId(
  ctx: { auth: { sub?: string | null; userId?: string | null; isApiKey?: boolean } | null },
): string | null {
  const auth = ctx.auth
  if (!auth) return null
  // An API-key principal is not a person and therefore owns no mailbox — it can
  // never be the owner of a conversation share.
  if (auth.isApiKey) return null
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  return null
}

function toSnapshot(row: CustomerEmailConversationShare, personEntityId: string): ShareSnapshot {
  return {
    id: row.id,
    personEntityId,
    ownerUserId: row.ownerUserId,
    sharedByUserId: row.sharedByUserId,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    createdAt: row.createdAt.toISOString(),
  }
}

async function loadOwnShare(
  em: EntityManager,
  parsed: EmailConversationShareSetCommandInput,
  ownerUserId: string,
): Promise<CustomerEmailConversationShare | null> {
  return (await em.findOne(CustomerEmailConversationShare, {
    tenantId: parsed.tenantId,
    organizationId: parsed.organizationId,
    personEntity: parsed.personEntityId,
    ownerUserId,
    deletedAt: null,
  } as FilterQuery<CustomerEmailConversationShare>)) as CustomerEmailConversationShare | null
}

/**
 * Share or un-share the ACTOR'S OWN email conversation with one Person.
 *
 * Owner-only by construction: `ownerUserId` is always the authenticated actor, so
 * no caller — admin or otherwise — can share a mailbox they do not own. That is
 * why holding `customers.email.share_conversation` via the `customers.*` wildcard
 * admins already have is not an escalation.
 *
 * The write only ever touches `customer_email_conversation_shares`. It never
 * rewrites `customer_interactions.visibility`, which is what keeps un-sharing
 * lossless and the query index consistent.
 */
const setEmailConversationShareCommand: CommandHandler<
  EmailConversationShareSetCommandInput,
  { shareId: string | null; changed: boolean }
> = {
  id: 'customers.email_conversation_shares.set',

  async prepare(rawInput, ctx) {
    const parsed = emailConversationShareSetCommandSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const ownerUserId = resolveActorUserId(ctx)
    if (!ownerUserId) return {}
    const existing = await loadOwnShare(em, parsed, ownerUserId)
    if (!existing) return {}
    return { before: toSnapshot(existing, parsed.personEntityId) }
  },

  async execute(rawInput, ctx) {
    const parsed = emailConversationShareSetCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const ownerUserId = resolveActorUserId(ctx)
    if (!ownerUserId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }

    // The Person must exist in this tenant/org. Loading it here (rather than
    // trusting the id) is what stops a forged id attaching a share to another
    // tenant's record.
    const person = await findOneWithDecryption(
      em,
      CustomerEntity,
      {
        id: parsed.personEntityId,
        kind: 'person',
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        deletedAt: null,
      } as never,
      undefined,
      scope,
    )
    if (!person) {
      throw notFound('Person not found')
    }

    const existing = await loadOwnShare(em, parsed, ownerUserId)

    // Optimistic locking (default ON per root AGENTS.md). Only meaningful when a
    // row already exists; a first share has no prior version to conflict with.
    if (existing) {
      assertOptimisticLock({
        resourceKind: RESOURCE_KIND,
        resourceId: existing.id,
        expected: parsed.expectedUpdatedAt ?? null,
        current: existing.updatedAt ?? null,
      })
    }

    if (parsed.shared) {
      if (existing) {
        return { shareId: existing.id, changed: false }
      }
      // Nothing to hand over means the share would grant access to no rows.
      // Reject rather than persist a grant that does nothing.
      const hasConversation = await canShareConversation(
        em,
        scope,
        ownerUserId,
        parsed.personEntityId,
      )
      if (!hasConversation) {
        throw new CrudHttpError(400, {
          error: '[internal] no private email conversation to share for this person',
        })
      }

      const created = em.create(CustomerEmailConversationShare, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        personEntity: person as CustomerEntity,
        ownerUserId,
        sharedByUserId: ownerUserId,
      } as never) as CustomerEmailConversationShare

      try {
        await withAtomicFlush(em, [() => { em.persist(created) }], {
          transaction: true,
          label: 'customers.email_conversation_shares.set',
        })
      } catch (err) {
        // `loadOwnShare` -> `em.create` is a read-then-write with no lock, and
        // `customer_email_conv_shares_uq` is UNIQUE (tenant, person, owner) WHERE
        // deleted_at IS NULL. Two concurrent PUT {shared:true} both read "no row"
        // and both insert; the loser hits the constraint. The end state the caller
        // asked for is already true, and the route's openApi documents this
        // operation as idempotent — so converge instead of surfacing a 500.
        if ((err as { code?: string } | null)?.code !== POSTGRES_UNIQUE_VIOLATION) throw err
        const winner = await loadOwnShare(em.fork(), parsed, ownerUserId)
        return { shareId: winner?.id ?? null, changed: false }
      }

      await emitShareEvent(parsed, ownerUserId, true)
      return { shareId: created.id, changed: true }
    }

    if (!existing) {
      return { shareId: null, changed: false }
    }

    const removedId = existing.id
    await withAtomicFlush(
      em,
      [
        () => {
          existing.deletedAt = new Date()
        },
      ],
      { transaction: true, label: 'customers.email_conversation_shares.set' },
    )

    await emitShareEvent(parsed, ownerUserId, false)
    return { shareId: removedId, changed: true }
  },

  buildLog: async ({ result, snapshots }) => {
    if (!result.changed) return { skipLog: true }
    const { translate } = await resolveTranslations()
    const before = (snapshots as ShareUndoPayload).before
    return {
      resourceKind: RESOURCE_KIND,
      resourceId: result.shareId ?? undefined,
      summary: before
        ? translate(
            'customers.email.conversationShare.log.revoked',
            'Stopped sharing an email conversation with the team',
          )
        : translate(
            'customers.email.conversationShare.log.granted',
            'Shared an email conversation with the team',
          ),
    }
  },
}

/**
 * Audit trail for the share act itself. Emitted best-effort: the grant is already
 * committed, so a failed emission must not surface as a failed request.
 */
async function emitShareEvent(
  parsed: EmailConversationShareSetCommandInput,
  ownerUserId: string,
  shared: boolean,
): Promise<void> {
  try {
    await emitCustomersEvent('customers.email.conversation_visibility_changed', {
      personEntityId: parsed.personEntityId,
      ownerUserId,
      actorUserId: ownerUserId,
      shared,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
  } catch {
    /* swallow — audit emission must not block a committed write */
  }
}

registerCommand(setEmailConversationShareCommand)

export { setEmailConversationShareCommand }
