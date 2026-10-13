import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FormDistribution, FormInvitation } from '../data/entities'
import {
  invitationCreateCommandSchema,
  invitationRevokeCommandSchema,
  invitationSendCommandSchema,
  type FormInvitationCreateCommandInput,
  type FormInvitationRevokeCommandInput,
  type FormInvitationSendCommandInput,
} from '../data/validators'
import {
  generateRawInvitationToken,
  getInvitationTokenTtlSeconds,
  hashInvitationToken,
} from '../services/distribution-token'
import { enqueueInvitationEmail } from '../subscribers/invitation-email'
import {
  emitForms,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  invalidateFormsCacheTags,
  resolveActorUserId,
  resolveEntityManager,
} from './shared'
import { DISTRIBUTION_CACHE_TAGS } from './distribution'

export const FORM_INVITATION_RESOURCE_KIND = 'forms.invitation'

// ----------------------------------------------------------------------------
// Snapshots + undo payloads
// ----------------------------------------------------------------------------

type FormInvitationSendSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  status: FormInvitation['status']
  sentAt: string | null
  sendCount: number
}

type FormInvitationStatusSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  status: FormInvitation['status']
}

type FormInvitationSendUndoPayload = {
  before?: FormInvitationSendSnapshot | null
}

type FormInvitationRevokeUndoPayload = {
  before?: FormInvitationStatusSnapshot | null
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function resolveAppUrl(): string | null {
  const raw = process.env.APP_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

function buildPersonalLink(rawToken: string): string | null {
  const base = resolveAppUrl()
  if (!base) return null
  return `${base}/i/${rawToken}`
}

async function findDistributionInScope(
  em: EntityManager,
  distributionId: string,
  tenantId: string,
  organizationId: string,
): Promise<FormDistribution> {
  const distribution = await em.findOne(FormDistribution, {
    id: distributionId,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!distribution) {
    throw new CrudHttpError(404, { error: 'forms.errors.distribution_not_found' })
  }
  return distribution
}

async function findInvitationInScope(
  em: EntityManager,
  invitationId: string,
  tenantId: string,
  organizationId: string,
): Promise<FormInvitation> {
  const invitation = await findOneWithDecryption(
    em,
    FormInvitation,
    { id: invitationId, tenantId, organizationId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!invitation) {
    throw new CrudHttpError(404, { error: 'forms.errors.invitation_not_found' })
  }
  return invitation
}

// ----------------------------------------------------------------------------
// forms.invitation.create — bulk
// ----------------------------------------------------------------------------

type InvitationCreateResult = {
  invitations: Array<{ id: string; rawToken: string | null }>
}

const createInvitationCommand: CommandHandler<FormInvitationCreateCommandInput, InvitationCreateResult> = {
  id: 'forms.invitation.create',
  async execute(rawInput, ctx) {
    const parsed = invitationCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const actorUserId = resolveActorUserId(ctx)
    const em = resolveEntityManager(ctx).fork()
    const distribution = await findDistributionInScope(
      em,
      parsed.distributionId,
      parsed.tenantId,
      parsed.organizationId,
    )

    const isPersonal = distribution.mode === 'personal'
    const now = new Date()
    const ttlSeconds = getInvitationTokenTtlSeconds()

    const created: Array<{ invitation: FormInvitation; rawToken: string | null }> = []
    for (const recipient of parsed.recipients) {
      const rawToken = isPersonal ? generateRawInvitationToken() : null
      const expiresAt = recipient.expiresAt
        ? new Date(recipient.expiresAt)
        : isPersonal
          ? new Date(now.getTime() + ttlSeconds * 1000)
          : null
      const invitation = em.create(FormInvitation, {
        distributionId: distribution.id,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        recipientEmail: recipient.email?.trim() ?? null,
        recipientName: recipient.name?.trim() ?? null,
        recipientRef: recipient.ref?.trim() ?? null,
        role: recipient.role ?? null,
        tokenHash: rawToken ? hashInvitationToken(rawToken) : null,
        status: 'pending',
        submissionId: null,
        locale: recipient.locale ?? null,
        expiresAt,
        sentAt: null,
        openedAt: null,
        startedAt: null,
        submittedAt: null,
        sendCount: 0,
        lastError: null,
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      } as never)
      em.persist(invitation)
      created.push({ invitation, rawToken })
    }

    await em.flush()

    for (const entry of created) {
      await emitForms('forms.invitation.created', {
        invitationId: entry.invitation.id,
        distributionId: distribution.id,
      })
    }

    // Inline best-effort personal-link email for recipients that supplied an
    // email. This is the only point where the raw token is available; the
    // subscriber resend path cannot rebuild the link.
    for (const entry of created) {
      const email = entry.invitation.recipientEmail?.trim()
      if (!email || !entry.rawToken) continue
      const link = buildPersonalLink(entry.rawToken)
      const delivered = await enqueueInvitationEmail({
        em,
        invitation: entry.invitation,
        recipientEmail: email,
        link,
      })
      if (delivered) {
        entry.invitation.status = 'sent'
        entry.invitation.sentAt = new Date()
        entry.invitation.sendCount += 1
        await em.flush()
        await emitForms('forms.invitation.sent', {
          invitationId: entry.invitation.id,
          distributionId: distribution.id,
        })
      }
    }

    await invalidateFormsCacheTags(ctx, [
      DISTRIBUTION_CACHE_TAGS.distribution(distribution.id),
    ])

    return {
      invitations: created.map((entry) => ({ id: entry.invitation.id, rawToken: entry.rawToken })),
    }
  },
  buildLog: async ({ input, result }) => {
    return {
      actionLabel: 'forms.audit.invitation.create',
      resourceKind: FORM_INVITATION_RESOURCE_KIND,
      resourceId: input.distributionId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: { undo: { invitationIds: result.invitations.map((entry) => entry.id) } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ invitationIds?: string[] }>(logEntry)
    const ids = payload?.invitationIds
    if (!ids || ids.length === 0) return
    const em = resolveEntityManager(ctx).fork()
    const invitations = await em.find(FormInvitation, { id: { $in: ids } })
    for (const invitation of invitations) {
      em.remove(invitation)
    }
    await em.flush()
  },
}

// ----------------------------------------------------------------------------
// forms.invitation.send — also the resend path
// ----------------------------------------------------------------------------

const sendInvitationCommand: CommandHandler<FormInvitationSendCommandInput, { invitationId: string }> = {
  id: 'forms.invitation.send',
  async prepare(rawInput, ctx) {
    const parsed = invitationSendCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const invitation = await em.findOne(FormInvitation, {
      id: parsed.invitationId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!invitation) return {}
    return {
      before: {
        id: invitation.id,
        organizationId: invitation.organizationId,
        tenantId: invitation.tenantId,
        status: invitation.status,
        sentAt: invitation.sentAt ? invitation.sentAt.toISOString() : null,
        sendCount: invitation.sendCount,
      } satisfies FormInvitationSendSnapshot,
    }
  },
  async execute(rawInput, ctx) {
    const parsed = invitationSendCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const invitation = await findInvitationInScope(
      em,
      parsed.invitationId,
      parsed.tenantId,
      parsed.organizationId,
    )

    if (invitation.status === 'revoked') {
      throw new CrudHttpError(409, { error: 'forms.errors.invitation_revoked' })
    }
    if (invitation.status === 'submitted') {
      throw new CrudHttpError(409, { error: 'forms.errors.invitation_submitted' })
    }
    const recipientEmail = invitation.recipientEmail?.trim()
    if (!recipientEmail) {
      throw new CrudHttpError(422, { error: 'forms.errors.invitation_no_email' })
    }

    if (invitation.status === 'pending' || invitation.status === 'opened') {
      invitation.status = 'sent'
    }
    invitation.sentAt = new Date()
    invitation.sendCount += 1
    invitation.updatedAt = new Date()
    await em.flush()

    await emitForms('forms.invitation.sent', {
      invitationId: invitation.id,
      distributionId: invitation.distributionId,
    })

    await invalidateFormsCacheTags(ctx, [
      DISTRIBUTION_CACHE_TAGS.distribution(invitation.distributionId),
    ])

    return { invitationId: invitation.id }
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormInvitationSendSnapshot | undefined
    return {
      actionLabel: 'forms.audit.invitation.send',
      resourceKind: FORM_INVITATION_RESOURCE_KIND,
      resourceId: result.invitationId,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      payload: { undo: { before: before ?? null } satisfies FormInvitationSendUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormInvitationSendUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const invitation = await em.findOne(FormInvitation, { id: before.id })
    if (!invitation) return
    invitation.status = before.status
    invitation.sentAt = before.sentAt ? new Date(before.sentAt) : null
    invitation.sendCount = before.sendCount
    invitation.updatedAt = new Date()
    await em.flush()
  },
}

// ----------------------------------------------------------------------------
// forms.invitation.revoke — soft revoke (row retained, status only)
// ----------------------------------------------------------------------------

const revokeInvitationCommand: CommandHandler<FormInvitationRevokeCommandInput, { invitationId: string }> = {
  id: 'forms.invitation.revoke',
  async prepare(rawInput, ctx) {
    const parsed = invitationRevokeCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const invitation = await em.findOne(FormInvitation, {
      id: parsed.invitationId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!invitation) return {}
    return {
      before: {
        id: invitation.id,
        organizationId: invitation.organizationId,
        tenantId: invitation.tenantId,
        status: invitation.status,
      } satisfies FormInvitationStatusSnapshot,
    }
  },
  async execute(rawInput, ctx) {
    const parsed = invitationRevokeCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const invitation = await em.findOne(FormInvitation, {
      id: parsed.invitationId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!invitation) {
      throw new CrudHttpError(404, { error: 'forms.errors.invitation_not_found' })
    }

    if (invitation.status !== 'revoked') {
      invitation.status = 'revoked'
      invitation.updatedAt = new Date()
      await em.flush()
      await emitForms('forms.invitation.revoked', { invitationId: invitation.id })
      await invalidateFormsCacheTags(ctx, [
        DISTRIBUTION_CACHE_TAGS.distribution(invitation.distributionId),
      ])
    }

    return { invitationId: invitation.id }
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormInvitationStatusSnapshot | undefined
    return {
      actionLabel: 'forms.audit.invitation.revoke',
      resourceKind: FORM_INVITATION_RESOURCE_KIND,
      resourceId: result.invitationId,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      payload: { undo: { before: before ?? null } satisfies FormInvitationRevokeUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormInvitationRevokeUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const invitation = await em.findOne(FormInvitation, { id: before.id })
    if (!invitation) return
    invitation.status = before.status
    invitation.updatedAt = new Date()
    await em.flush()
  },
}

registerCommand(createInvitationCommand)
registerCommand(sendInvitationCommand)
registerCommand(revokeInvitationCommand)

export {
  createInvitationCommand,
  sendInvitationCommand,
  revokeInvitationCommand,
}
