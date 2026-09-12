/**
 * Tag commands for the consulting suite (T3.4).
 *
 * A tag is org-wide vocabulary — screen 6 renders it as a card badge, screen 7 as
 * a chip in the task drawer, screens 8 and 10 on the time entry. The tag itself is
 * therefore project-agnostic; only its *assignments* touch project-scoped rows,
 * which is why the access filtering lives on the assignment routes rather than
 * here.
 *
 * Three decisions the callers depend on:
 *
 *  1. `slug` is unique per organization+tenant (partial unique index, live rows
 *     only). A collision comes back as a 409 carrying `fieldErrors.slug` so the
 *     form marks the field instead of showing a dead 500.
 *  2. **Deleting a tag cascades to its assignments and reports the count.** The
 *     alternatives are worse: silently orphaning 200 entry badges hides the blast
 *     radius, and refusing until the caller hand-unpicks 200 rows gives them no
 *     way forward. The tag is soft-deleted, the junction rows are removed, the
 *     response carries `removedTaskAssignments` / `removedEntryAssignments`, and
 *     undo puts both the tag and every removed assignment back.
 *  3. **Assignment is idempotent.** Both junctions carry a unique index, so
 *     re-sending a tag the target already has is a no-op success, never a unique
 *     violation. The already-present ids come back in `alreadyAssignedTagIds` so
 *     the UI can tell "added" from "was already there". Unassigning a tag that is
 *     not assigned is the same kind of no-op.
 */

import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  StaffTimeEntry,
  StaffTimeEntryTag,
  StaffTimeTag,
  StaffTimeTask,
  StaffTimeTaskTag,
} from '../data/entities'
import {
  staffTimeTagCreateSchema,
  staffTimeEntryTagAssignmentSchema,
  staffTimeTaskTagAssignmentSchema,
  type StaffTimeTagCreateInput,
  type StaffTimeEntryTagAssignmentInput,
  type StaffTimeTaskTagAssignmentInput,
} from '../data/validators'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffCommandScope,
  type StaffSnapshotScope,
} from './shared'

export const staffTimeTagCommandIds = {
  create: 'staff.timesheets.tags.create',
  update: 'staff.timesheets.tags.update',
  delete: 'staff.timesheets.tags.delete',
  assignTask: 'staff.timesheets.tags.assign_task',
  unassignTask: 'staff.timesheets.tags.unassign_task',
  assignEntry: 'staff.timesheets.tags.assign_entry',
  unassignEntry: 'staff.timesheets.tags.unassign_entry',
} as const

export const TAG_SLUG_DUPLICATE_CODE = 'time_tag_slug_duplicate'
export const TAG_UNKNOWN_IDS_CODE = 'time_tag_unknown_ids'
export const TAG_TARGET_LOCKED_CODE = 'time_entry_locked'

/**
 * An assignment snapshot is written into the audit payload so undo can put the
 * junction rows back. A tag used across thousands of rows would bloat the log, so
 * the snapshot stops here and says so; undo then restores what it captured.
 */
export const TAG_ASSIGNMENT_SNAPSHOT_LIMIT = 500

const tagCrudIndexer: CrudIndexerConfig<StaffTimeTag> = {
  entityType: 'staff:staff_time_tag',
}

const taskCrudIndexer: CrudIndexerConfig<StaffTimeTask> = {
  entityType: 'staff:staff_time_task',
}

const timeEntryCrudIndexer: CrudIndexerConfig<StaffTimeEntry> = {
  entityType: 'staff:staff_time_entry',
}

// No CRUD event ids are declared for tags in `events.ts`: a tag write is
// vocabulary maintenance the screens re-read, so these commands queue index and
// cache side effects only.

type Translate = (key: string, fallback: string) => string

/**
 * `data/validators.ts` ships the create shape only. The update schema is derived
 * from it rather than restated so the slug/label/color rules cannot drift apart.
 */
export const staffTimeTagUpdateSchema = z.object({
  id: z.string().uuid(),
  slug: staffTimeTagCreateSchema.shape.slug.optional(),
  label: staffTimeTagCreateSchema.shape.label.optional(),
  color: staffTimeTagCreateSchema.shape.color,
})

export type StaffTimeTagUpdateInput = z.infer<typeof staffTimeTagUpdateSchema>

type TagSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  slug: string
  label: string
  color: string | null
  deletedAt: string | null
}

type TagAssignmentSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  tagId: string
  targetId: string
}

type TagUndoPayload = {
  before?: TagSnapshot | null
  after?: TagSnapshot | null
  taskAssignments?: TagAssignmentSnapshot[] | null
  entryAssignments?: TagAssignmentSnapshot[] | null
  assignmentsTruncated?: boolean
}

type AssignmentUndoPayload = {
  target: 'task' | 'time_entry'
  targetId: string
  tenantId: string
  organizationId: string
  tagIdsBefore: string[]
  tagIdsAfter: string[]
  added: string[]
  removed: TagAssignmentSnapshot[]
}

function toTagSnapshot(tag: StaffTimeTag): TagSnapshot {
  return {
    id: tag.id,
    tenantId: tag.tenantId,
    organizationId: tag.organizationId,
    slug: tag.slug,
    label: tag.label,
    color: tag.color ?? null,
    deletedAt: tag.deletedAt ? tag.deletedAt.toISOString() : null,
  }
}

async function loadTagSnapshot(
  em: EntityManager,
  id: string,
  scope?: StaffSnapshotScope | null,
): Promise<TagSnapshot | null> {
  const tag = await em.findOne(StaffTimeTag, scopedStaffSnapshotWhere(id, scope))
  return tag ? toTagSnapshot(tag) : null
}

function slugDuplicateError(translate: Translate, slug: string): CrudHttpError {
  const message = translate(
    'staff.time_tracking.tags.errors.slugDuplicate',
    'A tag with this slug already exists.',
  )
  return new CrudHttpError(409, {
    code: TAG_SLUG_DUPLICATE_CODE,
    error: message,
    slug,
    fieldErrors: { slug: message },
  })
}

function tagNotFoundError(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.time_tracking.tags.errors.notFound', 'Tag not found or not accessible.'),
  })
}

function unknownTagIdsError(translate: Translate, unknownIds: string[]): CrudHttpError {
  const message = translate(
    'staff.time_tracking.tags.errors.unknownIds',
    'Some tags do not exist in this organization.',
  )
  return new CrudHttpError(422, {
    code: TAG_UNKNOWN_IDS_CODE,
    error: message,
    unknownIds,
    fieldErrors: { tagIds: message },
  })
}

function targetNotFoundError(translate: Translate, target: 'task' | 'time_entry'): CrudHttpError {
  // Deliberately the same 404 for "does not exist" and "not yours": tagging must
  // not become a way to probe which task or entry ids exist (screen 17 note 1).
  const message =
    target === 'task'
      ? translate('staff.time_tracking.tags.errors.taskNotFound', 'Task not found or not accessible.')
      : translate('staff.time_tracking.tags.errors.entryNotFound', 'Time entry not found or not accessible.')
  return new CrudHttpError(404, { error: message })
}

/**
 * Persistence for one junction table. The command bodies below are shared; only
 * these closures know which table and which target column they address, so each
 * ORM call stays fully typed against its own entity.
 */
type TagJunctionOps = {
  target: 'task' | 'time_entry'
  resourceKind: string
  loadAssignments: (
    em: EntityManager,
    targetId: string,
    scope: StaffCommandScope,
  ) => Promise<TagAssignmentSnapshot[]>
  loadAssignmentsForSnapshot: (
    em: EntityManager,
    targetId: string,
    scope: StaffSnapshotScope | null,
  ) => Promise<TagAssignmentSnapshot[]>
  loadAssignmentsByTag: (
    em: EntityManager,
    tagId: string,
    scope: StaffCommandScope,
  ) => Promise<TagAssignmentSnapshot[]>
  createAssignment: (em: EntityManager, row: Omit<TagAssignmentSnapshot, 'id'>) => void
  deleteAssignments: (em: EntityManager, ids: string[], scope: StaffCommandScope) => Promise<number>
  deleteAssignmentsByTag: (em: EntityManager, tagId: string, scope: StaffCommandScope) => Promise<number>
  restoreAssignments: (em: EntityManager, rows: TagAssignmentSnapshot[]) => Promise<void>
}

function snapshotScopeWhere(scope?: StaffSnapshotScope | null): { tenantId?: string; organizationId?: string } {
  const where: { tenantId?: string; organizationId?: string } = {}
  if (scope?.tenantId) where.tenantId = scope.tenantId
  if (scope?.organizationId) where.organizationId = scope.organizationId
  return where
}

const taskJunctionOps: TagJunctionOps = {
  target: 'task',
  resourceKind: 'staff.timesheets.task_tag',
  loadAssignments: async (em, targetId, scope) => {
    const rows = await em.find(StaffTimeTaskTag, applyScopeToWhere<StaffTimeTaskTag>({ taskId: targetId }, scope))
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      tagId: row.tagId,
      targetId: row.taskId,
    }))
  },
  loadAssignmentsForSnapshot: async (em, targetId, scope) => {
    const rows = await em.find(StaffTimeTaskTag, { taskId: targetId, ...snapshotScopeWhere(scope) })
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      tagId: row.tagId,
      targetId: row.taskId,
    }))
  },
  loadAssignmentsByTag: async (em, tagId, scope) => {
    const rows = await em.find(StaffTimeTaskTag, applyScopeToWhere<StaffTimeTaskTag>({ tagId }, scope), {
      limit: TAG_ASSIGNMENT_SNAPSHOT_LIMIT + 1,
    })
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      tagId: row.tagId,
      targetId: row.taskId,
    }))
  },
  createAssignment: (em, row) => {
    em.persist(
      em.create(StaffTimeTaskTag, {
        tenantId: row.tenantId,
        organizationId: row.organizationId,
        tagId: row.tagId,
        taskId: row.targetId,
        createdAt: new Date(),
      }),
    )
  },
  deleteAssignments: async (em, ids, scope) =>
    em.nativeDelete(StaffTimeTaskTag, applyScopeToWhere<StaffTimeTaskTag>({ id: { $in: ids } }, scope)),
  deleteAssignmentsByTag: async (em, tagId, scope) =>
    em.nativeDelete(StaffTimeTaskTag, applyScopeToWhere<StaffTimeTaskTag>({ tagId }, scope)),
  restoreAssignments: async (em, rows) => {
    for (const row of rows) {
      const existing = await em.findOne(StaffTimeTaskTag, {
        tagId: row.tagId,
        taskId: row.targetId,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      })
      if (existing) continue
      em.persist(
        em.create(StaffTimeTaskTag, {
          id: row.id,
          tenantId: row.tenantId,
          organizationId: row.organizationId,
          tagId: row.tagId,
          taskId: row.targetId,
          createdAt: new Date(),
        }),
      )
    }
  },
}

const entryJunctionOps: TagJunctionOps = {
  target: 'time_entry',
  resourceKind: 'staff.timesheets.entry_tag',
  loadAssignments: async (em, targetId, scope) => {
    const rows = await em.find(
      StaffTimeEntryTag,
      applyScopeToWhere<StaffTimeEntryTag>({ timeEntryId: targetId }, scope),
    )
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      tagId: row.tagId,
      targetId: row.timeEntryId,
    }))
  },
  loadAssignmentsForSnapshot: async (em, targetId, scope) => {
    const rows = await em.find(StaffTimeEntryTag, { timeEntryId: targetId, ...snapshotScopeWhere(scope) })
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      tagId: row.tagId,
      targetId: row.timeEntryId,
    }))
  },
  loadAssignmentsByTag: async (em, tagId, scope) => {
    const rows = await em.find(StaffTimeEntryTag, applyScopeToWhere<StaffTimeEntryTag>({ tagId }, scope), {
      limit: TAG_ASSIGNMENT_SNAPSHOT_LIMIT + 1,
    })
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      tagId: row.tagId,
      targetId: row.timeEntryId,
    }))
  },
  createAssignment: (em, row) => {
    em.persist(
      em.create(StaffTimeEntryTag, {
        tenantId: row.tenantId,
        organizationId: row.organizationId,
        tagId: row.tagId,
        timeEntryId: row.targetId,
        createdAt: new Date(),
      }),
    )
  },
  deleteAssignments: async (em, ids, scope) =>
    em.nativeDelete(StaffTimeEntryTag, applyScopeToWhere<StaffTimeEntryTag>({ id: { $in: ids } }, scope)),
  deleteAssignmentsByTag: async (em, tagId, scope) =>
    em.nativeDelete(StaffTimeEntryTag, applyScopeToWhere<StaffTimeEntryTag>({ tagId }, scope)),
  restoreAssignments: async (em, rows) => {
    for (const row of rows) {
      const existing = await em.findOne(StaffTimeEntryTag, {
        tagId: row.tagId,
        timeEntryId: row.targetId,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      })
      if (existing) continue
      em.persist(
        em.create(StaffTimeEntryTag, {
          id: row.id,
          tenantId: row.tenantId,
          organizationId: row.organizationId,
          tagId: row.tagId,
          timeEntryId: row.targetId,
          createdAt: new Date(),
        }),
      )
    }
  },
}

async function requireKnownTags(
  em: EntityManager,
  tagIds: string[],
  scope: StaffCommandScope,
  translate: Translate,
): Promise<void> {
  const unique = Array.from(new Set(tagIds))
  if (unique.length === 0) return
  const tags = await em.find(
    StaffTimeTag,
    applyScopeToWhere<StaffTimeTag>({ id: { $in: unique }, deletedAt: null }, scope),
    { fields: ['id'] },
  )
  const known = new Set(tags.map((tag) => tag.id))
  const unknownIds = unique.filter((id) => !known.has(id))
  if (unknownIds.length > 0) throw unknownTagIdsError(translate, unknownIds)
}

const createTagCommand: CommandHandler<StaffTimeTagCreateInput, { tagId: string }> = {
  id: staffTimeTagCommandIds.create,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeTagCreateSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const existing = await em.findOne(StaffTimeTag, {
      slug: parsed.data.slug,
      tenantId: parsed.data.tenantId,
      organizationId: parsed.data.organizationId,
      deletedAt: null,
    })
    return { before: { slugTaken: existing != null } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeTagCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
    const { translate } = await resolveTranslations()

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let created: StaffTimeTag | null = null

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            // The read lives in the same transaction as the insert, so a
            // concurrent create cannot slip a second row past this check; the
            // partial unique index is the backstop and is translated below.
            const duplicate = await em.findOne(
              StaffTimeTag,
              applyScopeToWhere<StaffTimeTag>({ slug: parsed.slug, deletedAt: null }, scope),
              { fields: ['id'] },
            )
            if (duplicate) throw slugDuplicateError(translate, parsed.slug)
          },
          () => {
            created = em.create(StaffTimeTag, {
              tenantId: parsed.tenantId,
              organizationId: parsed.organizationId,
              slug: parsed.slug,
              label: parsed.label,
              color: parsed.color ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            })
            em.persist(created)
          },
        ],
        { transaction: true, label: staffTimeTagCommandIds.create },
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw slugDuplicateError(translate, parsed.slug)
      throw err
    }

    const record = created as StaffTimeTag | null
    if (!record) throw tagNotFoundError(translate)

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      indexer: tagCrudIndexer,
    })

    return { tagId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTagSnapshot(em, result.tagId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTagSnapshot(em, result.tagId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tags.create', 'Create tag'),
      resourceKind: 'staff.timesheets.tag',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: { after: snapshot } satisfies TagUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TagUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const snapshotScope = staffSnapshotScopeFromSnapshot(after)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(StaffTimeTag, scopedStaffSnapshotWhere(after.id, snapshotScope))
    if (!tag) return

    await withAtomicFlush(
      em,
      [
        () => {
          tag.deletedAt = new Date()
          tag.updatedAt = new Date()
        },
      ],
      { transaction: true, label: `${staffTimeTagCommandIds.create}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: tag,
      identifiers: { id: tag.id, organizationId: tag.organizationId, tenantId: tag.tenantId },
      indexer: tagCrudIndexer,
    })
  },
}

const updateTagCommand: CommandHandler<StaffTimeTagUpdateInput, { tagId: string }> = {
  id: staffTimeTagCommandIds.update,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeTagUpdateSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadTagSnapshot(em, parsed.data.id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeTagUpdateSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    const tag = await em.findOne(StaffTimeTag, applyScopeToWhere<StaffTimeTag>({ id: parsed.id, deletedAt: null }, scope))
    if (!tag) throw tagNotFoundError(translate)
    ensureTenantScope(ctx, tag.tenantId)
    ensureOrganizationScope(ctx, tag.organizationId)

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            if (parsed.slug === undefined || parsed.slug === tag.slug) return
            const duplicate = await em.findOne(
              StaffTimeTag,
              applyScopeToWhere<StaffTimeTag>({ slug: parsed.slug, deletedAt: null, id: { $ne: tag.id } }, scope),
              { fields: ['id'] },
            )
            if (duplicate) throw slugDuplicateError(translate, parsed.slug)
          },
          () => {
            if (parsed.slug !== undefined) tag.slug = parsed.slug
            if (parsed.label !== undefined) tag.label = parsed.label
            if (parsed.color !== undefined) tag.color = parsed.color ?? null
            tag.updatedAt = new Date()
          },
        ],
        { transaction: true, label: staffTimeTagCommandIds.update },
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw slugDuplicateError(translate, parsed.slug ?? tag.slug)
      throw err
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: tag,
      identifiers: { id: tag.id, organizationId: tag.organizationId, tenantId: tag.tenantId },
      indexer: tagCrudIndexer,
    })

    return { tagId: tag.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = (snapshots.before as { snapshot?: TagSnapshot } | undefined)?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTagSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const changes = buildChanges(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      ['slug', 'label', 'color'],
    )
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tags.update', 'Update tag'),
      resourceKind: 'staff.timesheets.tag',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: { before, after } satisfies TagUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TagUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const snapshotScope = staffSnapshotScopeFromSnapshot(before)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(StaffTimeTag, scopedStaffSnapshotWhere(before.id, snapshotScope))
    if (!tag) return

    await withAtomicFlush(
      em,
      [
        () => {
          tag.slug = before.slug
          tag.label = before.label
          tag.color = before.color ?? null
          tag.updatedAt = new Date()
        },
      ],
      { transaction: true, label: `${staffTimeTagCommandIds.update}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: tag,
      identifiers: { id: tag.id, organizationId: tag.organizationId, tenantId: tag.tenantId },
      indexer: tagCrudIndexer,
    })
  },
}

type DeleteTagResult = {
  tagId: string
  removedTaskAssignments: number
  removedEntryAssignments: number
}

const deleteTagCommand: CommandHandler<{ id?: string }, DeleteTagResult> = {
  id: staffTimeTagCommandIds.delete,
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const scope = staffSnapshotScopeFromContext(ctx)
    const before = await loadTagSnapshot(em, id, scope)
    if (!before) return {}
    const readScope: StaffCommandScope = {
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      requireTenant: true,
      requireOrganization: true,
    }
    const taskAssignments = await taskJunctionOps.loadAssignmentsByTag(em, id, readScope)
    const entryAssignments = await entryJunctionOps.loadAssignmentsByTag(em, id, readScope)
    const truncated =
      taskAssignments.length > TAG_ASSIGNMENT_SNAPSHOT_LIMIT || entryAssignments.length > TAG_ASSIGNMENT_SNAPSHOT_LIMIT
    return {
      before: {
        snapshot: before,
        taskAssignments: taskAssignments.slice(0, TAG_ASSIGNMENT_SNAPSHOT_LIMIT),
        entryAssignments: entryAssignments.slice(0, TAG_ASSIGNMENT_SNAPSHOT_LIMIT),
        assignmentsTruncated: truncated,
      },
    }
  },
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const id = input?.id
    if (!id) {
      throw new CrudHttpError(400, {
        error: translate('staff.time_tracking.tags.errors.idRequired', 'Tag id is required.'),
      })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const tag = await em.findOne(StaffTimeTag, applyScopeToWhere<StaffTimeTag>({ id, deletedAt: null }, scope))
    if (!tag) throw tagNotFoundError(translate)
    ensureTenantScope(ctx, tag.tenantId)
    ensureOrganizationScope(ctx, tag.organizationId)

    let removedTaskAssignments = 0
    let removedEntryAssignments = 0

    await withAtomicFlush(
      em,
      [
        async () => {
          // The cascade is deliberate: the badge disappears everywhere it was
          // used, and the counts travel back so the caller sees the reach.
          removedTaskAssignments = await taskJunctionOps.deleteAssignmentsByTag(em, tag.id, scope)
          removedEntryAssignments = await entryJunctionOps.deleteAssignmentsByTag(em, tag.id, scope)
        },
        () => {
          tag.deletedAt = new Date()
          tag.updatedAt = new Date()
        },
      ],
      { transaction: true, label: staffTimeTagCommandIds.delete },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: tag,
      identifiers: { id: tag.id, organizationId: tag.organizationId, tenantId: tag.tenantId },
      indexer: tagCrudIndexer,
    })

    return { tagId: tag.id, removedTaskAssignments, removedEntryAssignments }
  },
  buildLog: async ({ result, snapshots }) => {
    const prepared = snapshots.before as
      | {
          snapshot?: TagSnapshot
          taskAssignments?: TagAssignmentSnapshot[]
          entryAssignments?: TagAssignmentSnapshot[]
          assignmentsTruncated?: boolean
        }
      | undefined
    const before = prepared?.snapshot
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tags.delete', 'Delete tag'),
      resourceKind: 'staff.timesheets.tag',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      changes: {
        removedTaskAssignments: { from: result.removedTaskAssignments, to: 0 },
        removedEntryAssignments: { from: result.removedEntryAssignments, to: 0 },
      },
      payload: {
        undo: {
          before,
          taskAssignments: prepared?.taskAssignments ?? null,
          entryAssignments: prepared?.entryAssignments ?? null,
          assignmentsTruncated: prepared?.assignmentsTruncated ?? false,
        } satisfies TagUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TagUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const snapshotScope = staffSnapshotScopeFromSnapshot(before)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let tag = await em.findOne(StaffTimeTag, scopedStaffSnapshotWhere(before.id, snapshotScope))

    await withAtomicFlush(
      em,
      [
        () => {
          if (!tag) {
            tag = em.create(StaffTimeTag, {
              id: before.id,
              tenantId: before.tenantId,
              organizationId: before.organizationId,
              slug: before.slug,
              label: before.label,
              color: before.color ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            })
            em.persist(tag)
            return
          }
          tag.slug = before.slug
          tag.label = before.label
          tag.color = before.color ?? null
          tag.deletedAt = null
          tag.updatedAt = new Date()
        },
        // Restoring assignments re-reads the junction rows, so it is its own phase.
        () => taskJunctionOps.restoreAssignments(em, payload?.taskAssignments ?? []),
        () => entryJunctionOps.restoreAssignments(em, payload?.entryAssignments ?? []),
      ],
      { transaction: true, label: `${staffTimeTagCommandIds.delete}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: tag,
      identifiers: { id: before.id, organizationId: before.organizationId, tenantId: before.tenantId },
      indexer: tagCrudIndexer,
    })
  },
}

type AssignmentResult = {
  targetId: string
  assignedTagIds: string[]
  alreadyAssignedTagIds: string[]
  tagIds: string[]
}

type UnassignmentResult = {
  targetId: string
  removedTagIds: string[]
  notAssignedTagIds: string[]
  tagIds: string[]
}

type AssignmentTarget = {
  id: string
  tenantId: string
  organizationId: string
}

async function requireTaskTarget(
  em: EntityManager,
  taskId: string,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<AssignmentTarget> {
  const task = await em.findOne(StaffTimeTask, applyScopeToWhere<StaffTimeTask>({ id: taskId, deletedAt: null }, scope))
  if (!task) throw targetNotFoundError(translate, 'task')
  return { id: task.id, tenantId: task.tenantId, organizationId: task.organizationId }
}

async function requireEntryTarget(
  em: EntityManager,
  timeEntryId: string,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<AssignmentTarget> {
  const entry = await em.findOne(
    StaffTimeEntry,
    applyScopeToWhere<StaffTimeEntry>({ id: timeEntryId, deletedAt: null }, scope),
  )
  if (!entry) throw targetNotFoundError(translate, 'time_entry')
  if (entry.lockedReportId) {
    // An entry frozen in a closed report is read-only, and its tags are part of
    // what the report renders.
    throw new CrudHttpError(409, {
      code: TAG_TARGET_LOCKED_CODE,
      error: translate(
        'staff.time_tracking.tags.errors.entryLocked',
        'This time entry is locked in a closed report and its tags cannot be changed.',
      ),
      lockedReportId: entry.lockedReportId,
    })
  }
  return { id: entry.id, tenantId: entry.tenantId, organizationId: entry.organizationId }
}

type AssignmentCommandInput = {
  tenantId: string
  organizationId: string
  targetId: string
  tagIds: string[]
}

function refreshTargetSideEffects(ops: TagJunctionOps) {
  return async (ctx: { container: { resolve: (name: string) => unknown } }, target: AssignmentTarget) => {
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    // The target's own index document and cached lists carry its tags, so they
    // are refreshed even though no column on the target row changed.
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: target,
      identifiers: { id: target.id, organizationId: target.organizationId, tenantId: target.tenantId },
      indexer: ops.target === 'task' ? taskCrudIndexer : timeEntryCrudIndexer,
    })
  }
}

async function runAssignment(
  ops: TagJunctionOps,
  requireTarget: (
    em: EntityManager,
    targetId: string,
    scope: StaffCommandScope,
    translate: Translate,
  ) => Promise<AssignmentTarget>,
  parsed: AssignmentCommandInput,
  ctx: Parameters<CommandHandler<AssignmentCommandInput, AssignmentResult>['execute']>[1],
): Promise<AssignmentResult> {
  ensureTenantScope(ctx, parsed.tenantId)
  ensureOrganizationScope(ctx, parsed.organizationId)
  const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
  const { translate } = await resolveTranslations()

  const requestedTagIds = Array.from(new Set(parsed.tagIds))

  let target: AssignmentTarget | null = null
  let assignedTagIds: string[] = []
  let alreadyAssignedTagIds: string[] = []
  let tagIdsAfter: string[] = []

  // Each attempt gets its own fork: a rolled-back unit of work must not carry
  // its persisted-but-uncommitted rows into the retry.
  const attempt = async (): Promise<void> => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(
      em,
      [
        async () => {
          target = await requireTarget(em, parsed.targetId, scope, translate)
          await requireKnownTags(em, requestedTagIds, scope, translate)
          const existing = await ops.loadAssignments(em, parsed.targetId, scope)
          const existingTagIds = new Set(existing.map((row) => row.tagId))
          alreadyAssignedTagIds = requestedTagIds.filter((tagId) => existingTagIds.has(tagId))
          assignedTagIds = requestedTagIds.filter((tagId) => !existingTagIds.has(tagId))
          tagIdsAfter = Array.from(new Set([...existingTagIds, ...requestedTagIds]))
        },
        () => {
          for (const tagId of assignedTagIds) {
            ops.createAssignment(em, {
              tenantId: parsed.tenantId,
              organizationId: parsed.organizationId,
              tagId,
              targetId: parsed.targetId,
            })
          }
        },
      ],
      { transaction: true, label: `${ops.target}.tags.assign` },
    )
  }

  try {
    await attempt()
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    // A concurrent assign won the race. Re-reading turns the collision into the
    // no-op success the second caller asked for; a second violation would mean
    // the row is there either way, which is the requested end state.
    try {
      await attempt()
    } catch (retryErr) {
      if (!isUniqueViolation(retryErr)) throw retryErr
      assignedTagIds = []
      alreadyAssignedTagIds = requestedTagIds
      tagIdsAfter = requestedTagIds
    }
  }

  const resolvedTarget = target as AssignmentTarget | null
  if (!resolvedTarget) throw targetNotFoundError(translate, ops.target)

  if (assignedTagIds.length > 0) {
    await refreshTargetSideEffects(ops)(ctx, resolvedTarget)
  }

  return {
    targetId: parsed.targetId,
    assignedTagIds,
    alreadyAssignedTagIds,
    tagIds: tagIdsAfter,
  }
}

async function runUnassignment(
  ops: TagJunctionOps,
  requireTarget: (
    em: EntityManager,
    targetId: string,
    scope: StaffCommandScope,
    translate: Translate,
  ) => Promise<AssignmentTarget>,
  parsed: AssignmentCommandInput,
  ctx: Parameters<CommandHandler<AssignmentCommandInput, UnassignmentResult>['execute']>[1],
): Promise<UnassignmentResult> {
  ensureTenantScope(ctx, parsed.tenantId)
  ensureOrganizationScope(ctx, parsed.organizationId)
  const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
  const { translate } = await resolveTranslations()

  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const requestedTagIds = Array.from(new Set(parsed.tagIds))

  let target: AssignmentTarget | null = null
  let removedTagIds: string[] = []
  let notAssignedTagIds: string[] = []
  let tagIdsAfter: string[] = []

  await withAtomicFlush(
    em,
    [
      async () => {
        target = await requireTarget(em, parsed.targetId, scope, translate)
        const existing = await ops.loadAssignments(em, parsed.targetId, scope)
        const byTagId = new Map(existing.map((row) => [row.tagId, row]))
        removedTagIds = requestedTagIds.filter((tagId) => byTagId.has(tagId))
        notAssignedTagIds = requestedTagIds.filter((tagId) => !byTagId.has(tagId))
        tagIdsAfter = existing.map((row) => row.tagId).filter((tagId) => !removedTagIds.includes(tagId))
        const removableIds = removedTagIds
          .map((tagId) => byTagId.get(tagId)?.id)
          .filter((value): value is string => typeof value === 'string')
        // Removing a tag that is not assigned is a no-op, not a 404: the caller
        // asked for an end state that already holds.
        if (removableIds.length > 0) await ops.deleteAssignments(em, removableIds, scope)
      },
    ],
    { transaction: true, label: `${ops.target}.tags.unassign` },
  )

  const resolvedTarget = target as AssignmentTarget | null
  if (!resolvedTarget) throw targetNotFoundError(translate, ops.target)

  if (removedTagIds.length > 0) {
    await refreshTargetSideEffects(ops)(ctx, resolvedTarget)
  }

  return {
    targetId: parsed.targetId,
    removedTagIds,
    notAssignedTagIds,
    tagIds: tagIdsAfter,
  }
}

async function restoreAssignmentState(
  ops: TagJunctionOps,
  payload: AssignmentUndoPayload,
  ctx: { container: { resolve: (name: string) => unknown } },
): Promise<void> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const scope: StaffCommandScope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    requireTenant: true,
    requireOrganization: true,
  }

  await withAtomicFlush(
    em,
    [
      async () => {
        if (payload.added.length > 0) {
          const current = await ops.loadAssignments(em, payload.targetId, scope)
          const removableIds = current
            .filter((row) => payload.added.includes(row.tagId))
            .map((row) => row.id)
          if (removableIds.length > 0) await ops.deleteAssignments(em, removableIds, scope)
        }
      },
      () => ops.restoreAssignments(em, payload.removed),
    ],
    { transaction: true, label: `${ops.target}.tags.undo` },
  )
}

function assignmentLogPayload(
  ops: TagJunctionOps,
  parsed: AssignmentCommandInput,
  result: AssignmentResult,
): AssignmentUndoPayload {
  return {
    target: ops.target,
    targetId: parsed.targetId,
    tenantId: parsed.tenantId,
    organizationId: parsed.organizationId,
    tagIdsBefore: result.tagIds.filter((tagId) => !result.assignedTagIds.includes(tagId)),
    tagIdsAfter: result.tagIds,
    added: result.assignedTagIds,
    removed: [],
  }
}

function unassignmentLogPayload(
  ops: TagJunctionOps,
  parsed: AssignmentCommandInput,
  result: UnassignmentResult,
  removedRows: TagAssignmentSnapshot[],
): AssignmentUndoPayload {
  return {
    target: ops.target,
    targetId: parsed.targetId,
    tenantId: parsed.tenantId,
    organizationId: parsed.organizationId,
    tagIdsBefore: [...result.tagIds, ...result.removedTagIds],
    tagIdsAfter: result.tagIds,
    added: [],
    removed: removedRows,
  }
}

function toTaskCommandInput(parsed: StaffTimeTaskTagAssignmentInput): AssignmentCommandInput {
  return {
    tenantId: parsed.tenantId,
    organizationId: parsed.organizationId,
    targetId: parsed.taskId,
    tagIds: parsed.tagIds,
  }
}

function toEntryCommandInput(parsed: StaffTimeEntryTagAssignmentInput): AssignmentCommandInput {
  return {
    tenantId: parsed.tenantId,
    organizationId: parsed.organizationId,
    targetId: parsed.timeEntryId,
    tagIds: parsed.tagIds,
  }
}

const assignTaskTagsCommand: CommandHandler<StaffTimeTaskTagAssignmentInput, AssignmentResult> = {
  id: staffTimeTagCommandIds.assignTask,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeTaskTagAssignmentSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const rows = await taskJunctionOps.loadAssignmentsForSnapshot(
      em,
      parsed.data.taskId,
      staffSnapshotScopeFromContext(ctx),
    )
    return { before: { tagIds: rows.map((row) => row.tagId) } }
  },
  execute: async (rawInput, ctx) => {
    const parsed = staffTimeTaskTagAssignmentSchema.parse(rawInput)
    return runAssignment(taskJunctionOps, requireTaskTarget, toTaskCommandInput(parsed), ctx)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = staffTimeTaskTagAssignmentSchema.parse(input)
    const commandInput = toTaskCommandInput(parsed)
    const before = (snapshots.before as { tagIds?: string[] } | undefined)?.tagIds ?? []
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tags.assign_task', 'Assign task tags'),
      resourceKind: taskJunctionOps.resourceKind,
      resourceId: commandInput.targetId,
      tenantId: commandInput.tenantId,
      organizationId: commandInput.organizationId,
      snapshotBefore: { tagIds: before },
      snapshotAfter: { tagIds: result.tagIds },
      changes: { tagIds: { from: before, to: result.tagIds } },
      payload: {
        undo: assignmentLogPayload(taskJunctionOps, commandInput, result),
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AssignmentUndoPayload>(logEntry)
    if (!payload) return
    await restoreAssignmentState(taskJunctionOps, payload, ctx)
  },
}

const unassignTaskTagsCommand: CommandHandler<StaffTimeTaskTagAssignmentInput, UnassignmentResult> = {
  id: staffTimeTagCommandIds.unassignTask,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeTaskTagAssignmentSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const rows = await taskJunctionOps.loadAssignmentsForSnapshot(
      em,
      parsed.data.taskId,
      staffSnapshotScopeFromContext(ctx),
    )
    return { before: { rows } }
  },
  execute: async (rawInput, ctx) => {
    const parsed = staffTimeTaskTagAssignmentSchema.parse(rawInput)
    return runUnassignment(taskJunctionOps, requireTaskTarget, toTaskCommandInput(parsed), ctx)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = staffTimeTaskTagAssignmentSchema.parse(input)
    const commandInput = toTaskCommandInput(parsed)
    const rows = (snapshots.before as { rows?: TagAssignmentSnapshot[] } | undefined)?.rows ?? []
    const removedRows = rows.filter((row) => result.removedTagIds.includes(row.tagId))
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tags.unassign_task', 'Unassign task tags'),
      resourceKind: taskJunctionOps.resourceKind,
      resourceId: commandInput.targetId,
      tenantId: commandInput.tenantId,
      organizationId: commandInput.organizationId,
      snapshotBefore: { tagIds: rows.map((row) => row.tagId) },
      snapshotAfter: { tagIds: result.tagIds },
      changes: { tagIds: { from: rows.map((row) => row.tagId), to: result.tagIds } },
      payload: {
        undo: unassignmentLogPayload(taskJunctionOps, commandInput, result, removedRows),
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AssignmentUndoPayload>(logEntry)
    if (!payload) return
    await restoreAssignmentState(taskJunctionOps, payload, ctx)
  },
}

const assignEntryTagsCommand: CommandHandler<StaffTimeEntryTagAssignmentInput, AssignmentResult> = {
  id: staffTimeTagCommandIds.assignEntry,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeEntryTagAssignmentSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const rows = await entryJunctionOps.loadAssignmentsForSnapshot(
      em,
      parsed.data.timeEntryId,
      staffSnapshotScopeFromContext(ctx),
    )
    return { before: { tagIds: rows.map((row) => row.tagId) } }
  },
  execute: async (rawInput, ctx) => {
    const parsed = staffTimeEntryTagAssignmentSchema.parse(rawInput)
    return runAssignment(entryJunctionOps, requireEntryTarget, toEntryCommandInput(parsed), ctx)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = staffTimeEntryTagAssignmentSchema.parse(input)
    const commandInput = toEntryCommandInput(parsed)
    const before = (snapshots.before as { tagIds?: string[] } | undefined)?.tagIds ?? []
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tags.assign_entry', 'Assign time entry tags'),
      resourceKind: entryJunctionOps.resourceKind,
      resourceId: commandInput.targetId,
      tenantId: commandInput.tenantId,
      organizationId: commandInput.organizationId,
      snapshotBefore: { tagIds: before },
      snapshotAfter: { tagIds: result.tagIds },
      changes: { tagIds: { from: before, to: result.tagIds } },
      payload: {
        undo: assignmentLogPayload(entryJunctionOps, commandInput, result),
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AssignmentUndoPayload>(logEntry)
    if (!payload) return
    await restoreAssignmentState(entryJunctionOps, payload, ctx)
  },
}

const unassignEntryTagsCommand: CommandHandler<StaffTimeEntryTagAssignmentInput, UnassignmentResult> = {
  id: staffTimeTagCommandIds.unassignEntry,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeEntryTagAssignmentSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const rows = await entryJunctionOps.loadAssignmentsForSnapshot(
      em,
      parsed.data.timeEntryId,
      staffSnapshotScopeFromContext(ctx),
    )
    return { before: { rows } }
  },
  execute: async (rawInput, ctx) => {
    const parsed = staffTimeEntryTagAssignmentSchema.parse(rawInput)
    return runUnassignment(entryJunctionOps, requireEntryTarget, toEntryCommandInput(parsed), ctx)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = staffTimeEntryTagAssignmentSchema.parse(input)
    const commandInput = toEntryCommandInput(parsed)
    const rows = (snapshots.before as { rows?: TagAssignmentSnapshot[] } | undefined)?.rows ?? []
    const removedRows = rows.filter((row) => result.removedTagIds.includes(row.tagId))
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tags.unassign_entry', 'Unassign time entry tags'),
      resourceKind: entryJunctionOps.resourceKind,
      resourceId: commandInput.targetId,
      tenantId: commandInput.tenantId,
      organizationId: commandInput.organizationId,
      snapshotBefore: { tagIds: rows.map((row) => row.tagId) },
      snapshotAfter: { tagIds: result.tagIds },
      changes: { tagIds: { from: rows.map((row) => row.tagId), to: result.tagIds } },
      payload: {
        undo: unassignmentLogPayload(entryJunctionOps, commandInput, result, removedRows),
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AssignmentUndoPayload>(logEntry)
    if (!payload) return
    await restoreAssignmentState(entryJunctionOps, payload, ctx)
  },
}

registerCommand(createTagCommand)
registerCommand(updateTagCommand)
registerCommand(deleteTagCommand)
registerCommand(assignTaskTagsCommand)
registerCommand(unassignTaskTagsCommand)
registerCommand(assignEntryTagsCommand)
registerCommand(unassignEntryTagsCommand)
