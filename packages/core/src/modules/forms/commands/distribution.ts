import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { FormDistribution } from '../data/entities'
import {
  distributionCloseCommandSchema,
  distributionCreateCommandSchema,
  distributionUpdateCommandSchema,
  type FormDistributionCloseCommandInput,
  type FormDistributionCreateCommandInput,
  type FormDistributionUpdateCommandInput,
} from '../data/validators'
import { generatePublicSlug } from '../services/distribution-token'
import {
  FORMS_CACHE_TAGS,
  emitForms,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  findFormInScope,
  invalidateFormsCacheTags,
  resolveActorUserId,
  resolveEntityManager,
} from './shared'

export const FORM_DISTRIBUTION_RESOURCE_KIND = 'forms.distribution'

// ----------------------------------------------------------------------------
// Snapshot + undo payloads
// ----------------------------------------------------------------------------

export type FormDistributionSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  formId: string
  pinnedVersionId: string | null
  mode: 'open' | 'personal'
  publicSlug: string | null
  status: 'active' | 'paused' | 'closed'
  title: string | null
  defaultLocale: string
  requireCustomerAuth: boolean
  allowMultipleSubmissions: boolean
  maxResponses: number | null
  responseCount: number
  opensAt: string | null
  closesAt: string | null
  redirectUrl: string | null
  settings: Record<string, unknown> | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

type FormDistributionUndoPayload = {
  before?: FormDistributionSnapshot | null
  after?: FormDistributionSnapshot | null
}

export function serializeDistributionSnapshot(distribution: FormDistribution): FormDistributionSnapshot {
  return {
    id: distribution.id,
    organizationId: distribution.organizationId,
    tenantId: distribution.tenantId,
    formId: distribution.formId,
    pinnedVersionId: distribution.pinnedVersionId ?? null,
    mode: distribution.mode,
    publicSlug: distribution.publicSlug ?? null,
    status: distribution.status,
    title: distribution.title ?? null,
    defaultLocale: distribution.defaultLocale,
    requireCustomerAuth: distribution.requireCustomerAuth,
    allowMultipleSubmissions: distribution.allowMultipleSubmissions,
    maxResponses: distribution.maxResponses ?? null,
    responseCount: distribution.responseCount,
    opensAt: distribution.opensAt ? distribution.opensAt.toISOString() : null,
    closesAt: distribution.closesAt ? distribution.closesAt.toISOString() : null,
    redirectUrl: distribution.redirectUrl ?? null,
    settings: distribution.settings ?? null,
    createdBy: distribution.createdBy,
    createdAt: distribution.createdAt.toISOString(),
    updatedAt: distribution.updatedAt.toISOString(),
  }
}

// ----------------------------------------------------------------------------
// Cache tags + helpers
// ----------------------------------------------------------------------------

const DISTRIBUTION_CACHE_TAGS = {
  distribution: (distributionId: string) => `forms.distribution:${distributionId}`,
  distributionList: (formId: string) => `forms.distribution.list:${formId}`,
} as const

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as Record<string, unknown>
  const code = candidate.code
  const detail = typeof candidate.detail === 'string' ? candidate.detail : ''
  const constraintName = typeof candidate.constraint === 'string' ? candidate.constraint : ''
  return code === '23505' && (constraintName === constraint || detail.includes(constraint))
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

function parseIsoDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null
  return new Date(value)
}

// ----------------------------------------------------------------------------
// forms.distribution.create
// ----------------------------------------------------------------------------

const createDistributionCommand: CommandHandler<FormDistributionCreateCommandInput, { distributionId: string }> = {
  id: 'forms.distribution.create',
  async execute(rawInput, ctx) {
    const parsed = distributionCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const actorUserId = resolveActorUserId(ctx)
    if (!actorUserId) {
      throw new CrudHttpError(401, { error: 'forms.errors.unauthorized' })
    }

    const em = resolveEntityManager(ctx).fork()
    await findFormInScope(em, parsed.formId, parsed.tenantId, parsed.organizationId)

    const now = new Date()
    const buildDistribution = (publicSlug: string | null): FormDistribution =>
      em.create(FormDistribution, {
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        formId: parsed.formId,
        pinnedVersionId: parsed.pinnedVersionId ?? null,
        mode: parsed.mode,
        publicSlug,
        status: 'active',
        title: parsed.title?.trim() ?? null,
        defaultLocale: parsed.defaultLocale,
        requireCustomerAuth: parsed.requireCustomerAuth ?? false,
        allowMultipleSubmissions: parsed.allowMultipleSubmissions ?? false,
        maxResponses: parsed.maxResponses ?? null,
        responseCount: 0,
        opensAt: parseIsoDate(parsed.opensAt),
        closesAt: parseIsoDate(parsed.closesAt),
        redirectUrl: parsed.redirectUrl ?? null,
        settings: parsed.settings ?? null,
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      } as never)

    let distribution = buildDistribution(parsed.mode === 'open' ? generatePublicSlug() : null)
    em.persist(distribution)

    try {
      await em.flush()
    } catch (error) {
      if (parsed.mode === 'open' && isUniqueViolation(error, 'forms_distribution_org_public_slug_unique')) {
        const retryEm = resolveEntityManager(ctx).fork()
        distribution = retryEm.create(FormDistribution, {
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
          formId: parsed.formId,
          pinnedVersionId: parsed.pinnedVersionId ?? null,
          mode: parsed.mode,
          publicSlug: generatePublicSlug(),
          status: 'active',
          title: parsed.title?.trim() ?? null,
          defaultLocale: parsed.defaultLocale,
          requireCustomerAuth: parsed.requireCustomerAuth ?? false,
          allowMultipleSubmissions: parsed.allowMultipleSubmissions ?? false,
          maxResponses: parsed.maxResponses ?? null,
          responseCount: 0,
          opensAt: parseIsoDate(parsed.opensAt),
          closesAt: parseIsoDate(parsed.closesAt),
          redirectUrl: parsed.redirectUrl ?? null,
          settings: parsed.settings ?? null,
          createdBy: actorUserId,
          createdAt: now,
          updatedAt: now,
        } as never)
        retryEm.persist(distribution)
        await retryEm.flush()
      } else {
        throw error
      }
    }

    await emitForms('forms.distribution.created', {
      distributionId: distribution.id,
      organizationId: distribution.organizationId,
      formId: distribution.formId,
    })

    await invalidateFormsCacheTags(ctx, [
      DISTRIBUTION_CACHE_TAGS.distributionList(distribution.formId),
      FORMS_CACHE_TAGS.form(distribution.formId),
    ])

    return { distributionId: distribution.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const distribution = await em.findOne(FormDistribution, { id: result.distributionId })
    return distribution ? serializeDistributionSnapshot(distribution) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as FormDistributionSnapshot | undefined
    return {
      actionLabel: 'forms.audit.distribution.create',
      resourceKind: FORM_DISTRIBUTION_RESOURCE_KIND,
      resourceId: result.distributionId,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ?? null,
      payload: { undo: { after: after ?? null } satisfies FormDistributionUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormDistributionUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = resolveEntityManager(ctx).fork()
    const distribution = await em.findOne(FormDistribution, { id: after.id })
    if (!distribution) return
    em.remove(distribution)
    await em.flush()
    await emitForms('forms.distribution.closed', { distributionId: after.id })
    await invalidateFormsCacheTags(ctx, [
      DISTRIBUTION_CACHE_TAGS.distributionList(after.formId),
      DISTRIBUTION_CACHE_TAGS.distribution(after.id),
    ])
  },
}

// ----------------------------------------------------------------------------
// forms.distribution.update
// ----------------------------------------------------------------------------

const updateDistributionCommand: CommandHandler<FormDistributionUpdateCommandInput, { distributionId: string }> = {
  id: 'forms.distribution.update',
  async prepare(rawInput, ctx) {
    const parsed = distributionUpdateCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const distribution = await em.findOne(FormDistribution, {
      id: parsed.distributionId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!distribution) return {}
    return { before: serializeDistributionSnapshot(distribution) }
  },
  async execute(rawInput, ctx) {
    const parsed = distributionUpdateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const distribution = await findDistributionInScope(
      em,
      parsed.distributionId,
      parsed.tenantId,
      parsed.organizationId,
    )

    const previousStatus = distribution.status
    let touched = false

    if (parsed.status !== undefined && parsed.status !== distribution.status) {
      distribution.status = parsed.status
      touched = true
    }
    if (parsed.title !== undefined) {
      const next = parsed.title?.trim() ?? null
      if (next !== distribution.title) {
        distribution.title = next
        touched = true
      }
    }
    if (parsed.maxResponses !== undefined) {
      const next = parsed.maxResponses ?? null
      if (next !== distribution.maxResponses) {
        distribution.maxResponses = next
        touched = true
      }
    }
    if (parsed.opensAt !== undefined) {
      distribution.opensAt = parseIsoDate(parsed.opensAt)
      touched = true
    }
    if (parsed.closesAt !== undefined) {
      distribution.closesAt = parseIsoDate(parsed.closesAt)
      touched = true
    }
    if (parsed.redirectUrl !== undefined) {
      const next = parsed.redirectUrl ?? null
      if (next !== distribution.redirectUrl) {
        distribution.redirectUrl = next
        touched = true
      }
    }
    if (parsed.allowMultipleSubmissions !== undefined && parsed.allowMultipleSubmissions !== distribution.allowMultipleSubmissions) {
      distribution.allowMultipleSubmissions = parsed.allowMultipleSubmissions
      touched = true
    }
    if (parsed.requireCustomerAuth !== undefined && parsed.requireCustomerAuth !== distribution.requireCustomerAuth) {
      distribution.requireCustomerAuth = parsed.requireCustomerAuth
      touched = true
    }
    if (parsed.settings !== undefined) {
      distribution.settings = parsed.settings ?? null
      touched = true
    }

    if (touched) {
      distribution.updatedAt = new Date()
      await em.flush()
      await invalidateFormsCacheTags(ctx, [
        DISTRIBUTION_CACHE_TAGS.distribution(distribution.id),
        DISTRIBUTION_CACHE_TAGS.distributionList(distribution.formId),
      ])
    }

    if (distribution.status === 'closed' && previousStatus !== 'closed') {
      await emitForms('forms.distribution.closed', { distributionId: distribution.id })
    }

    return { distributionId: distribution.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const distribution = await em.findOne(FormDistribution, { id: result.distributionId })
    return distribution ? serializeDistributionSnapshot(distribution) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormDistributionSnapshot | undefined
    const after = snapshots.after as FormDistributionSnapshot | undefined
    return {
      actionLabel: 'forms.audit.distribution.update',
      resourceKind: FORM_DISTRIBUTION_RESOURCE_KIND,
      resourceId: result.distributionId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before: before ?? null, after: after ?? null } satisfies FormDistributionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormDistributionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const distribution = await em.findOne(FormDistribution, { id: before.id })
    if (!distribution) return
    distribution.status = before.status
    distribution.title = before.title
    distribution.maxResponses = before.maxResponses
    distribution.opensAt = before.opensAt ? new Date(before.opensAt) : null
    distribution.closesAt = before.closesAt ? new Date(before.closesAt) : null
    distribution.redirectUrl = before.redirectUrl
    distribution.allowMultipleSubmissions = before.allowMultipleSubmissions
    distribution.requireCustomerAuth = before.requireCustomerAuth
    distribution.settings = before.settings
    distribution.updatedAt = new Date()
    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      DISTRIBUTION_CACHE_TAGS.distribution(distribution.id),
      DISTRIBUTION_CACHE_TAGS.distributionList(distribution.formId),
    ])
  },
}

// ----------------------------------------------------------------------------
// forms.distribution.close
// ----------------------------------------------------------------------------

const closeDistributionCommand: CommandHandler<FormDistributionCloseCommandInput, { distributionId: string }> = {
  id: 'forms.distribution.close',
  async prepare(rawInput, ctx) {
    const parsed = distributionCloseCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const distribution = await em.findOne(FormDistribution, {
      id: parsed.distributionId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!distribution) return {}
    return { before: serializeDistributionSnapshot(distribution) }
  },
  async execute(rawInput, ctx) {
    const parsed = distributionCloseCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const distribution = await findDistributionInScope(
      em,
      parsed.distributionId,
      parsed.tenantId,
      parsed.organizationId,
    )

    if (distribution.status !== 'closed') {
      distribution.status = 'closed'
      distribution.updatedAt = new Date()
      await em.flush()
      await emitForms('forms.distribution.closed', { distributionId: distribution.id })
      await invalidateFormsCacheTags(ctx, [
        DISTRIBUTION_CACHE_TAGS.distribution(distribution.id),
        DISTRIBUTION_CACHE_TAGS.distributionList(distribution.formId),
      ])
    }

    return { distributionId: distribution.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const distribution = await em.findOne(FormDistribution, { id: result.distributionId })
    return distribution ? serializeDistributionSnapshot(distribution) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormDistributionSnapshot | undefined
    const after = snapshots.after as FormDistributionSnapshot | undefined
    return {
      actionLabel: 'forms.audit.distribution.close',
      resourceKind: FORM_DISTRIBUTION_RESOURCE_KIND,
      resourceId: result.distributionId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before: before ?? null, after: after ?? null } satisfies FormDistributionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormDistributionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const distribution = await em.findOne(FormDistribution, { id: before.id })
    if (!distribution) return
    distribution.status = before.status
    distribution.updatedAt = new Date()
    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      DISTRIBUTION_CACHE_TAGS.distribution(distribution.id),
      DISTRIBUTION_CACHE_TAGS.distributionList(distribution.formId),
    ])
  },
}

registerCommand(createDistributionCommand)
registerCommand(updateDistributionCommand)
registerCommand(closeDistributionCommand)

export {
  DISTRIBUTION_CACHE_TAGS,
  createDistributionCommand,
  updateDistributionCommand,
  closeDistributionCommand,
}
