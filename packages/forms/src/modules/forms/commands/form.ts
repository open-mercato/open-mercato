import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Form } from '../data/entities'
import {
  formArchiveCommandSchema,
  formCreateCommandSchema,
  formRenameCommandSchema,
  formRestoreCommandSchema,
  type FormArchiveCommandInput,
  type FormCreateCommandInput,
  type FormRenameCommandInput,
  type FormRestoreCommandInput,
} from '../data/validators'
import {
  FORMS_CACHE_TAGS,
  FORM_RESOURCE_KIND,
  emitForms,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  findFormInScope,
  invalidateFormsCacheTags,
  resolveActorUserId,
  resolveEntityManager,
  serializeFormSnapshot,
  type FormSnapshot,
} from './shared'

// ----------------------------------------------------------------------------
// Undo payloads
// ----------------------------------------------------------------------------

type FormUndoPayload = {
  before?: FormSnapshot | null
  after?: FormSnapshot | null
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as Record<string, unknown>
  const code = candidate.code
  const detail = typeof candidate.detail === 'string' ? candidate.detail : ''
  const constraintName = typeof candidate.constraint === 'string' ? candidate.constraint : ''
  return (
    code === '23505' &&
    (constraintName === constraint || detail.includes(constraint))
  )
}

// ----------------------------------------------------------------------------
// forms.form.create
// ----------------------------------------------------------------------------

const createFormCommand: CommandHandler<FormCreateCommandInput, { formId: string }> = {
  id: 'forms.form.create',
  async execute(rawInput, ctx) {
    const parsed = formCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const actorUserId = resolveActorUserId(ctx)
    if (!actorUserId) {
      throw new CrudHttpError(401, { error: 'forms.errors.unauthorized' })
    }

    const em = resolveEntityManager(ctx).fork()
    const supportedLocales = Array.from(new Set(parsed.supportedLocales))
    if (!supportedLocales.includes(parsed.defaultLocale)) {
      supportedLocales.unshift(parsed.defaultLocale)
    }

    const now = new Date()
    const form = em.create(Form, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      key: parsed.key,
      name: parsed.name.trim(),
      description: parsed.description?.trim() ?? null,
      status: 'draft',
      currentPublishedVersionId: null,
      defaultLocale: parsed.defaultLocale,
      supportedLocales,
      createdBy: actorUserId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as never)
    em.persist(form)

    try {
      await em.flush()
    } catch (error) {
      if (isUniqueViolation(error, 'forms_form_org_key_unique')) {
        throw new CrudHttpError(422, { error: 'forms.errors.form_key_taken' })
      }
      throw error
    }

    await emitForms('forms.form.created', {
      formId: form.id,
      organizationId: form.organizationId,
    })

    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(form.organizationId),
      FORMS_CACHE_TAGS.form(form.id),
    ])

    return { formId: form.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const form = await em.findOne(Form, { id: result.formId })
    return form ? serializeFormSnapshot(form) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as FormSnapshot | undefined
    return {
      actionLabel: 'forms.audit.form.create',
      resourceKind: FORM_RESOURCE_KIND,
      resourceId: result.formId,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ?? null,
      payload: { undo: { after: after ?? null } satisfies FormUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = resolveEntityManager(ctx).fork()
    const form = await em.findOne(Form, { id: after.id })
    if (!form) return
    em.remove(form)
    await em.flush()
    await emitForms('forms.form.archived', { formId: after.id })
    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(after.organizationId),
      FORMS_CACHE_TAGS.form(after.id),
    ])
  },
}

// ----------------------------------------------------------------------------
// forms.form.rename
// ----------------------------------------------------------------------------

const renameFormCommand: CommandHandler<FormRenameCommandInput, { formId: string }> = {
  id: 'forms.form.rename',
  async prepare(rawInput, ctx) {
    const parsed = formRenameCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const form = await em.findOne(Form, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!form) return {}
    return { before: serializeFormSnapshot(form) }
  },
  async execute(rawInput, ctx) {
    const parsed = formRenameCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const form = await findFormInScope(em, parsed.id, parsed.tenantId, parsed.organizationId)

    let touched = false
    if (parsed.name !== undefined) {
      const next = parsed.name.trim()
      if (next !== form.name) {
        form.name = next
        touched = true
      }
    }
    if (parsed.description !== undefined) {
      const next = parsed.description?.trim() ?? null
      if (next !== form.description) {
        form.description = next
        touched = true
      }
    }

    if (touched) {
      form.updatedAt = new Date()
      await em.flush()
      await invalidateFormsCacheTags(ctx, [
        FORMS_CACHE_TAGS.formList(form.organizationId),
        FORMS_CACHE_TAGS.form(form.id),
      ])
    }

    return { formId: form.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const form = await em.findOne(Form, { id: result.formId })
    return form ? serializeFormSnapshot(form) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormSnapshot | undefined
    const after = snapshots.after as FormSnapshot | undefined
    return {
      actionLabel: 'forms.audit.form.rename',
      resourceKind: FORM_RESOURCE_KIND,
      resourceId: result.formId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies FormUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const form = await em.findOne(Form, { id: before.id })
    if (!form) return
    form.name = before.name
    form.description = before.description ?? null
    form.updatedAt = new Date()
    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(form.organizationId),
      FORMS_CACHE_TAGS.form(form.id),
    ])
  },
}

// ----------------------------------------------------------------------------
// forms.form.archive
// ----------------------------------------------------------------------------

const archiveFormCommand: CommandHandler<FormArchiveCommandInput, { formId: string }> = {
  id: 'forms.form.archive',
  async prepare(rawInput, ctx) {
    const parsed = formArchiveCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const form = await em.findOne(Form, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!form) return {}
    return { before: serializeFormSnapshot(form) }
  },
  async execute(rawInput, ctx) {
    const parsed = formArchiveCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const form = await findFormInScope(em, parsed.id, parsed.tenantId, parsed.organizationId)

    if (form.status !== 'archived') {
      const now = new Date()
      form.status = 'archived'
      form.archivedAt = now
      form.updatedAt = now
      await em.flush()
      await emitForms('forms.form.archived', { formId: form.id })
      await invalidateFormsCacheTags(ctx, [
        FORMS_CACHE_TAGS.formList(form.organizationId),
        FORMS_CACHE_TAGS.form(form.id),
      ])
    }

    return { formId: form.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const form = await em.findOne(Form, { id: result.formId })
    return form ? serializeFormSnapshot(form) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormSnapshot | undefined
    const after = snapshots.after as FormSnapshot | undefined
    return {
      actionLabel: 'forms.audit.form.archive',
      resourceKind: FORM_RESOURCE_KIND,
      resourceId: result.formId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies FormUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const form = await em.findOne(Form, { id: before.id })
    if (!form) return
    form.status = before.status
    form.archivedAt = before.archivedAt ? new Date(before.archivedAt) : null
    form.updatedAt = new Date()
    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(form.organizationId),
      FORMS_CACHE_TAGS.form(form.id),
    ])
  },
}

// ----------------------------------------------------------------------------
// forms.form.restore
// ----------------------------------------------------------------------------

const restoreFormCommand: CommandHandler<FormRestoreCommandInput, { formId: string }> = {
  id: 'forms.form.restore',
  async prepare(rawInput, ctx) {
    const parsed = formRestoreCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const form = await em.findOne(Form, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!form) return {}
    return { before: serializeFormSnapshot(form) }
  },
  async execute(rawInput, ctx) {
    const parsed = formRestoreCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const form = await findFormInScope(em, parsed.id, parsed.tenantId, parsed.organizationId)

    if (form.status === 'archived') {
      const now = new Date()
      form.status = form.currentPublishedVersionId ? 'active' : 'draft'
      form.archivedAt = null
      form.updatedAt = now
      await em.flush()
      await invalidateFormsCacheTags(ctx, [
        FORMS_CACHE_TAGS.formList(form.organizationId),
        FORMS_CACHE_TAGS.form(form.id),
      ])
    }

    return { formId: form.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const form = await em.findOne(Form, { id: result.formId })
    return form ? serializeFormSnapshot(form) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormSnapshot | undefined
    const after = snapshots.after as FormSnapshot | undefined
    return {
      actionLabel: 'forms.audit.form.restore',
      resourceKind: FORM_RESOURCE_KIND,
      resourceId: result.formId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies FormUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const form = await em.findOne(Form, { id: before.id })
    if (!form) return
    form.status = before.status
    form.archivedAt = before.archivedAt ? new Date(before.archivedAt) : null
    form.updatedAt = new Date()
    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(form.organizationId),
      FORMS_CACHE_TAGS.form(form.id),
    ])
  },
}

registerCommand(createFormCommand)
registerCommand(renameFormCommand)
registerCommand(archiveFormCommand)
registerCommand(restoreFormCommand)

export {
  createFormCommand,
  renameFormCommand,
  archiveFormCommand,
  restoreFormCommand,
}
