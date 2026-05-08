import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Form, FormVersion } from '../data/entities'
import {
  formVersionArchiveCommandSchema,
  formVersionForkDraftCommandSchema,
  formVersionPublishCommandSchema,
  formVersionUpdateDraftCommandSchema,
  type FormVersionArchiveCommandInput,
  type FormVersionForkDraftCommandInput,
  type FormVersionPublishCommandInput,
  type FormVersionUpdateDraftCommandInput,
} from '../data/validators'
import {
  FORMS_CACHE_TAGS,
  FORM_VERSION_RESOURCE_KIND,
  emitForms,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  findFormInScope,
  findFormVersionInScope,
  invalidateFormsCacheTags,
  resolveActorUserId,
  resolveEntityManager,
  serializeFormVersionSnapshot,
  type FormVersionSnapshot,
} from './shared'
import type { FormVersionCompiler } from '../services/form-version-compiler'
import type { FieldTypeRegistry } from '../schema/field-type-registry'
import { FormCompilationError } from '../services/form-version-compiler'

// ----------------------------------------------------------------------------
// Undo payloads
// ----------------------------------------------------------------------------

type FormVersionUndoPayload = {
  before?: FormVersionSnapshot | null
  after?: FormVersionSnapshot | null
  /**
   * Captured at publish time so undo can restore the prior pointer cleanly.
   */
  previousCurrentPublishedVersionId?: string | null
  /** Captured at publish time so undo of publish can route through the right inverse. */
  publishInverseKind?: 'demote_to_draft' | 'archive'
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function resolveCompiler(ctx: { container: { resolve: <T>(name: string) => T } }): FormVersionCompiler {
  return ctx.container.resolve<FormVersionCompiler>('formVersionCompiler')
}

function resolveRegistry(ctx: { container: { resolve: <T>(name: string) => T } }): FieldTypeRegistry {
  return ctx.container.resolve<FieldTypeRegistry>('fieldTypeRegistry')
}

const EMPTY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
  required: [],
  'x-om-roles': [],
  'x-om-sections': [],
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

/**
 * Best-effort check for whether any submission references the given version.
 * Phase 1b runs before submission entities exist (1c), so the table may be
 * absent entirely. In that case there are clearly no submissions and we
 * return false. Once 1c lands, the same SQL works against the new table.
 */
async function hasSubmissionsForVersion(
  em: EntityManager,
  versionId: string,
): Promise<boolean> {
  try {
    const db = (em as unknown as { getKysely: <T = unknown>() => unknown }).getKysely<unknown>() as unknown as {
      selectFrom: (name: string) => any
    }
    const tableExists = (await db
      .selectFrom('information_schema.tables')
      .select(['table_name'])
      .where('table_schema', '=', 'public')
      .where('table_name', '=', 'forms_form_submission')
      .execute()) as Array<{ table_name: string }>
    if (!tableExists.length) return false
    const rows = (await db
      .selectFrom('forms_form_submission')
      .select(['id'])
      .where('form_version_id', '=', versionId)
      .limit(1)
      .execute()) as Array<{ id: string }>
    return rows.length > 0
  } catch {
    // If the introspection query fails for any reason, fall back to the
    // safe assumption: treat as no submissions yet — the immutable
    // form_version row itself is still a viable inverse via archive.
    return false
  }
}

async function compileOrThrowValidation(
  compiler: FormVersionCompiler,
  version: FormVersion,
): Promise<void> {
  try {
    compiler.compile({
      id: version.id,
      updatedAt: version.updatedAt,
      schema: version.schema,
      uiSchema: version.uiSchema,
    })
  } catch (error) {
    if (error instanceof FormCompilationError) {
      throw new CrudHttpError(422, {
        error: 'forms.errors.schema_invalid',
        code: error.code,
        path: error.path,
        message: error.message,
      })
    }
    throw error
  }
}

// ----------------------------------------------------------------------------
// forms.form_version.fork_draft
// ----------------------------------------------------------------------------

const forkDraftCommand: CommandHandler<FormVersionForkDraftCommandInput, { versionId: string }> = {
  id: 'forms.form_version.fork_draft',
  async execute(rawInput, ctx) {
    const parsed = formVersionForkDraftCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const form = await findFormInScope(em, parsed.formId, parsed.tenantId, parsed.organizationId)

    const existingDraft = await em.findOne(FormVersion, {
      formId: form.id,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      status: 'draft',
    })
    if (existingDraft) {
      throw new CrudHttpError(422, { error: 'forms.errors.draft_already_exists' })
    }

    const lastVersion = await em.findOne(
      FormVersion,
      { formId: form.id },
      { orderBy: { versionNumber: 'desc' } },
    )

    let baseSchema: Record<string, unknown> = deepClone(EMPTY_SCHEMA)
    let baseUiSchema: Record<string, unknown> = {}
    let baseRoles: string[] = []

    if (parsed.fromVersionId) {
      const fromVersion = await findFormVersionInScope(
        em,
        parsed.fromVersionId,
        parsed.tenantId,
        parsed.organizationId,
      )
      if (fromVersion.formId !== form.id) {
        throw new CrudHttpError(400, { error: 'forms.errors.fork_source_invalid' })
      }
      baseSchema = deepClone(fromVersion.schema)
      baseUiSchema = deepClone(fromVersion.uiSchema)
      baseRoles = [...fromVersion.roles]
    } else if (lastVersion) {
      baseSchema = deepClone(lastVersion.schema)
      baseUiSchema = deepClone(lastVersion.uiSchema)
      baseRoles = [...lastVersion.roles]
    }

    const compiler = resolveCompiler(ctx)
    const registry = resolveRegistry(ctx)
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1

    let schemaHash = ''
    let registryVersion = registry.getRegistryVersion()
    try {
      const probe = compiler.compile({
        id: `__fork__:${form.id}:${versionNumber}`,
        updatedAt: new Date(),
        schema: baseSchema,
        uiSchema: baseUiSchema,
      })
      schemaHash = probe.schemaHash
      registryVersion = probe.registryVersion
    } catch {
      // Empty schemas may fail compile (no roles); fall back to deterministic hash.
      schemaHash = `forking:${form.id}:${versionNumber}`
    }

    const now = new Date()
    const draft = em.create(FormVersion, {
      formId: form.id,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      versionNumber,
      status: 'draft',
      schema: baseSchema,
      uiSchema: baseUiSchema,
      roles: baseRoles,
      schemaHash,
      registryVersion,
      publishedAt: null,
      publishedBy: null,
      changelog: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as never)
    em.persist(draft)
    await em.flush()

    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(form.organizationId),
      FORMS_CACHE_TAGS.form(form.id),
      FORMS_CACHE_TAGS.formVersion(draft.id),
    ])

    return { versionId: draft.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const version = await em.findOne(FormVersion, { id: result.versionId })
    return version ? serializeFormVersionSnapshot(version) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as FormVersionSnapshot | undefined
    return {
      actionLabel: 'forms.audit.form_version.fork_draft',
      resourceKind: FORM_VERSION_RESOURCE_KIND,
      resourceId: result.versionId,
      parentResourceKind: 'forms.form',
      parentResourceId: after?.formId ?? null,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ?? null,
      payload: { undo: { after: after ?? null } satisfies FormVersionUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormVersionUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = resolveEntityManager(ctx).fork()
    const version = await em.findOne(FormVersion, { id: after.id })
    if (!version) return
    if (version.status !== 'draft') return
    em.remove(version)
    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(after.organizationId),
      FORMS_CACHE_TAGS.form(after.formId),
      FORMS_CACHE_TAGS.formVersion(after.id),
    ])
  },
}

// ----------------------------------------------------------------------------
// forms.form_version.update_draft
// ----------------------------------------------------------------------------

const updateDraftCommand: CommandHandler<FormVersionUpdateDraftCommandInput, { versionId: string }> = {
  id: 'forms.form_version.update_draft',
  async prepare(rawInput, ctx) {
    const parsed = formVersionUpdateDraftCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const version = await em.findOne(FormVersion, {
      id: parsed.versionId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!version) return {}
    return { before: serializeFormVersionSnapshot(version) }
  },
  async execute(rawInput, ctx) {
    const parsed = formVersionUpdateDraftCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const version = await findFormVersionInScope(em, parsed.versionId, parsed.tenantId, parsed.organizationId)
    if (version.formId !== parsed.formId) {
      throw new CrudHttpError(400, { error: 'forms.errors.version_form_mismatch' })
    }
    if (version.status !== 'draft') {
      throw new CrudHttpError(409, { error: 'forms.errors.version_is_frozen' })
    }

    let touched = false
    if (parsed.schema !== undefined) {
      version.schema = deepClone(parsed.schema)
      touched = true
    }
    if (parsed.uiSchema !== undefined) {
      version.uiSchema = deepClone(parsed.uiSchema)
      touched = true
    }
    if (parsed.roles !== undefined) {
      const next = Array.from(new Set(parsed.roles))
      if (!arraysEqual(next, version.roles)) {
        version.roles = next
        touched = true
      }
    }
    if (parsed.changelog !== undefined) {
      const next = parsed.changelog?.trim() ?? null
      if (next !== version.changelog) {
        version.changelog = next
        touched = true
      }
    }

    if (touched) {
      const compiler = resolveCompiler(ctx)
      const registry = resolveRegistry(ctx)
      try {
        const compiled = compiler.compile({
          id: `__draft__:${version.id}:${Date.now()}`,
          updatedAt: new Date(),
          schema: version.schema,
          uiSchema: version.uiSchema,
        })
        version.schemaHash = compiled.schemaHash
        version.registryVersion = compiled.registryVersion
      } catch (error) {
        if (error instanceof FormCompilationError) {
          throw new CrudHttpError(422, {
            error: 'forms.errors.schema_invalid',
            code: error.code,
            path: error.path,
            message: error.message,
          })
        }
        version.registryVersion = registry.getRegistryVersion()
      }
      version.updatedAt = new Date()
      await em.flush()
      await invalidateFormsCacheTags(ctx, [
        FORMS_CACHE_TAGS.formList(version.organizationId),
        FORMS_CACHE_TAGS.form(version.formId),
        FORMS_CACHE_TAGS.formVersion(version.id),
      ])
    }

    return { versionId: version.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const version = await em.findOne(FormVersion, { id: result.versionId })
    return version ? serializeFormVersionSnapshot(version) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormVersionSnapshot | undefined
    const after = snapshots.after as FormVersionSnapshot | undefined
    return {
      actionLabel: 'forms.audit.form_version.update_draft',
      resourceKind: FORM_VERSION_RESOURCE_KIND,
      resourceId: result.versionId,
      parentResourceKind: 'forms.form',
      parentResourceId: after?.formId ?? before?.formId ?? null,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies FormVersionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormVersionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const version = await em.findOne(FormVersion, { id: before.id })
    if (!version) return
    if (version.status !== 'draft') return
    version.schema = deepClone(before.schema)
    version.uiSchema = deepClone(before.uiSchema)
    version.roles = [...before.roles]
    version.schemaHash = before.schemaHash
    version.registryVersion = before.registryVersion
    version.changelog = before.changelog
    version.updatedAt = new Date()
    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(version.organizationId),
      FORMS_CACHE_TAGS.form(version.formId),
      FORMS_CACHE_TAGS.formVersion(version.id),
    ])
  },
}

// ----------------------------------------------------------------------------
// forms.form_version.publish
// ----------------------------------------------------------------------------

const publishVersionCommand: CommandHandler<FormVersionPublishCommandInput, {
  versionId: string
  versionNumber: number
}> = {
  id: 'forms.form_version.publish',
  async prepare(rawInput, ctx) {
    const parsed = formVersionPublishCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const version = await em.findOne(FormVersion, {
      id: parsed.versionId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    return version ? { before: serializeFormVersionSnapshot(version) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = formVersionPublishCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const actorUserId = resolveActorUserId(ctx)
    if (!actorUserId) {
      throw new CrudHttpError(401, { error: 'forms.errors.unauthorized' })
    }

    const em = resolveEntityManager(ctx).fork()
    const compiler = resolveCompiler(ctx)
    const registry = resolveRegistry(ctx)

    return await em.transactional(async (txEm) => {
      // SELECT ... FOR UPDATE to prevent lost-update under concurrent publish.
      const db = (txEm as unknown as { getKysely: <T = unknown>() => unknown }).getKysely<unknown>() as unknown as {
        selectFrom: (name: string) => any
      }
      const lockedRows = (await db
        .selectFrom('forms_form_version')
        .select(['id', 'status', 'schema_hash', 'form_id'])
        .where('id', '=', parsed.versionId)
        .where('tenant_id', '=', parsed.tenantId)
        .where('organization_id', '=', parsed.organizationId)
        .forUpdate()
        .execute()) as Array<{ id: string; status: string; schema_hash: string; form_id: string }>
      const locked = lockedRows[0]
      if (!locked) {
        throw new CrudHttpError(404, { error: 'forms.errors.version_not_found' })
      }
      if (locked.form_id !== parsed.formId) {
        throw new CrudHttpError(400, { error: 'forms.errors.version_form_mismatch' })
      }
      if (locked.status !== 'draft') {
        throw new CrudHttpError(409, { error: 'forms.errors.version_is_frozen' })
      }

      const version = await txEm.findOne(FormVersion, { id: parsed.versionId })
      if (!version) {
        throw new CrudHttpError(404, { error: 'forms.errors.version_not_found' })
      }
      const form = await txEm.findOne(Form, {
        id: version.formId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        deletedAt: null,
      })
      if (!form) {
        throw new CrudHttpError(404, { error: 'forms.errors.form_not_found' })
      }

      // Compile (validates the schema before publish).
      let compiled
      try {
        compiled = compiler.compile({
          id: version.id,
          updatedAt: version.updatedAt,
          schema: version.schema,
          uiSchema: version.uiSchema,
        })
      } catch (error) {
        if (error instanceof FormCompilationError) {
          throw new CrudHttpError(422, {
            error: 'forms.errors.schema_invalid',
            code: error.code,
            path: error.path,
            message: error.message,
          })
        }
        throw error
      }

      // No-op publish detection vs the previously-published version.
      if (form.currentPublishedVersionId) {
        const previous = await txEm.findOne(FormVersion, {
          id: form.currentPublishedVersionId,
        })
        if (previous && previous.schemaHash === compiled.schemaHash) {
          throw new CrudHttpError(422, { error: 'forms.errors.no_op_publish' })
        }
      }

      const now = new Date()
      const previousCurrent = form.currentPublishedVersionId ?? null

      version.status = 'published'
      version.schemaHash = compiled.schemaHash
      version.registryVersion = registry.getRegistryVersion()
      version.publishedAt = now
      version.publishedBy = actorUserId
      if (parsed.changelog !== undefined && parsed.changelog !== null) {
        version.changelog = parsed.changelog.trim() || null
      }
      version.updatedAt = now

      form.currentPublishedVersionId = version.id
      if (form.status === 'draft') form.status = 'active'
      form.updatedAt = now

      await txEm.flush()

      // Stash undo metadata on the runtime context — buildLog reads it.
      ;(ctx as unknown as { __formsPublishMeta?: unknown }).__formsPublishMeta = {
        previousCurrentPublishedVersionId: previousCurrent,
      }

      await emitForms('forms.form_version.published', {
        formId: form.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        publishedBy: actorUserId,
      })

      await invalidateFormsCacheTags(ctx, [
        FORMS_CACHE_TAGS.formList(form.organizationId),
        FORMS_CACHE_TAGS.form(form.id),
        FORMS_CACHE_TAGS.formVersion(version.id),
        ...(previousCurrent ? [FORMS_CACHE_TAGS.formVersion(previousCurrent)] : []),
      ])

      return { versionId: version.id, versionNumber: version.versionNumber }
    })
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const version = await em.findOne(FormVersion, { id: result.versionId })
    return version ? serializeFormVersionSnapshot(version) : null
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const before = snapshots.before as FormVersionSnapshot | undefined
    const after = snapshots.after as FormVersionSnapshot | undefined
    const meta = (ctx as unknown as {
      __formsPublishMeta?: { previousCurrentPublishedVersionId?: string | null }
    }).__formsPublishMeta
    return {
      actionLabel: 'forms.audit.form_version.publish',
      resourceKind: FORM_VERSION_RESOURCE_KIND,
      resourceId: result.versionId,
      parentResourceKind: 'forms.form',
      parentResourceId: after?.formId ?? before?.formId ?? null,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
          previousCurrentPublishedVersionId:
            meta?.previousCurrentPublishedVersionId ?? null,
        } satisfies FormVersionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormVersionUndoPayload>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!after) return
    const em = resolveEntityManager(ctx).fork()
    const version = await em.findOne(FormVersion, { id: after.id })
    if (!version) return
    if (version.status !== 'published') return

    const form = await em.findOne(Form, { id: version.formId })
    if (!form) return

    const hasSubmissions = await hasSubmissionsForVersion(em, version.id)

    if (hasSubmissions) {
      // Inverse: archive the version (cannot demote, would break submission FK pin).
      version.status = 'archived'
      version.archivedAt = new Date()
      version.updatedAt = new Date()
    } else {
      // Inverse: demote to draft, restore previous current_published_version_id.
      version.status = 'draft'
      version.publishedAt = null
      version.publishedBy = null
      if (before) {
        version.changelog = before.changelog
        version.schema = deepClone(before.schema)
        version.uiSchema = deepClone(before.uiSchema)
        version.roles = [...before.roles]
        version.schemaHash = before.schemaHash
        version.registryVersion = before.registryVersion
      }
      version.updatedAt = new Date()

      const previousId = payload?.previousCurrentPublishedVersionId ?? null
      form.currentPublishedVersionId = previousId
      if (!previousId) form.status = form.status === 'archived' ? form.status : 'draft'
      form.updatedAt = new Date()
    }

    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(form.organizationId),
      FORMS_CACHE_TAGS.form(form.id),
      FORMS_CACHE_TAGS.formVersion(version.id),
    ])
  },
}

// ----------------------------------------------------------------------------
// forms.form_version.archive
// ----------------------------------------------------------------------------

const archiveVersionCommand: CommandHandler<FormVersionArchiveCommandInput, { versionId: string }> = {
  id: 'forms.form_version.archive',
  async prepare(rawInput, ctx) {
    const parsed = formVersionArchiveCommandSchema.parse(rawInput)
    const em = resolveEntityManager(ctx)
    const version = await em.findOne(FormVersion, {
      id: parsed.versionId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!version) return {}
    return { before: serializeFormVersionSnapshot(version) }
  },
  async execute(rawInput, ctx) {
    const parsed = formVersionArchiveCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = resolveEntityManager(ctx).fork()
    const version = await findFormVersionInScope(em, parsed.versionId, parsed.tenantId, parsed.organizationId)
    if (version.formId !== parsed.formId) {
      throw new CrudHttpError(400, { error: 'forms.errors.version_form_mismatch' })
    }

    if (version.status !== 'archived') {
      const now = new Date()
      version.status = 'archived'
      version.archivedAt = now
      version.updatedAt = now

      // If we archived the currently-published version, clear the form pointer.
      const form = await em.findOne(Form, { id: version.formId })
      if (form && form.currentPublishedVersionId === version.id) {
        form.currentPublishedVersionId = null
        if (form.status === 'active') form.status = 'draft'
        form.updatedAt = now
      }

      await em.flush()
      await invalidateFormsCacheTags(ctx, [
        FORMS_CACHE_TAGS.formList(version.organizationId),
        FORMS_CACHE_TAGS.form(version.formId),
        FORMS_CACHE_TAGS.formVersion(version.id),
      ])
    }

    return { versionId: version.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEntityManager(ctx)
    const version = await em.findOne(FormVersion, { id: result.versionId })
    return version ? serializeFormVersionSnapshot(version) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as FormVersionSnapshot | undefined
    const after = snapshots.after as FormVersionSnapshot | undefined
    return {
      actionLabel: 'forms.audit.form_version.archive',
      resourceKind: FORM_VERSION_RESOURCE_KIND,
      resourceId: result.versionId,
      parentResourceKind: 'forms.form',
      parentResourceId: after?.formId ?? before?.formId ?? null,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies FormVersionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FormVersionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEntityManager(ctx).fork()
    const version = await em.findOne(FormVersion, { id: before.id })
    if (!version) return
    version.status = before.status
    version.archivedAt = before.archivedAt ? new Date(before.archivedAt) : null
    version.updatedAt = new Date()
    await em.flush()
    await invalidateFormsCacheTags(ctx, [
      FORMS_CACHE_TAGS.formList(version.organizationId),
      FORMS_CACHE_TAGS.form(version.formId),
      FORMS_CACHE_TAGS.formVersion(version.id),
    ])
  },
}

// ----------------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------------

registerCommand(forkDraftCommand)
registerCommand(updateDraftCommand)
registerCommand(publishVersionCommand)
registerCommand(archiveVersionCommand)

// Used by API tests that need direct access to compileOrThrowValidation logic
// in the future. Keeping the export surface narrow on purpose.
export {
  forkDraftCommand,
  updateDraftCommand,
  publishVersionCommand,
  archiveVersionCommand,
  hasSubmissionsForVersion,
  compileOrThrowValidation,
}
