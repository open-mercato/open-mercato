import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects, flushCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeEntry, StaffTeamMember } from '../../../../data/entities'
import { staffTimeEntryBulkSaveSchema } from '../../../../data/validators'
import { staffTimeEntryCrudEvents } from '../../../../lib/crud'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') })
    }

    const body = await req.json().catch(() => ({}))
    const parsed = staffTimeEntryBulkSaveSchema.safeParse(body)
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json({ ok: false, errors }, { status: 422 })
    }

    const { entries } = parsed.data

    const em = (container.resolve('em') as EntityManager).fork()
    const scopeCtx = { tenantId, organizationId }

    const staffMember = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { userId: auth.sub, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )
    if (!staffMember) {
      throw new CrudHttpError(403, { error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.') })
    }
    const staffMemberId = staffMember.id

    const existingIds = entries
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    type PendingChange = {
      action: 'created' | 'updated' | 'deleted'
      entity: StaffTimeEntry
    }

    const { counts, pendingChanges } = await em.transactional(async (trx) => {
      let created = 0
      let updated = 0
      let deleted = 0
      const changes: PendingChange[] = []

      const existingEntries = existingIds.length > 0
        ? await findWithDecryption(
            trx,
            StaffTimeEntry,
            { id: { $in: existingIds }, tenantId, organizationId, staffMemberId, deletedAt: null },
            {},
            scopeCtx,
          )
        : []

      const existingMap = new Map(existingEntries.map((entry) => [entry.id, entry]))

      for (const entry of entries) {
        if (entry.id && existingMap.has(entry.id)) {
          const existing = existingMap.get(entry.id)!
          if (entry.durationMinutes === 0) {
            existing.deletedAt = new Date()
            deleted++
            changes.push({ action: 'deleted', entity: existing })
          } else {
            existing.date = entry.date
            existing.timeProjectId = entry.timeProjectId
            existing.durationMinutes = entry.durationMinutes
            existing.notes = entry.notes ?? existing.notes
            existing.updatedAt = new Date()
            updated++
            changes.push({ action: 'updated', entity: existing })
          }
        } else {
          const now = new Date()
          const newEntry = trx.create(StaffTimeEntry, {
            tenantId,
            organizationId,
            staffMemberId,
            date: entry.date,
            timeProjectId: entry.timeProjectId,
            durationMinutes: entry.durationMinutes,
            notes: entry.notes ?? null,
            source: 'manual',
            createdAt: now,
            updatedAt: now,
          })
          created++
          changes.push({ action: 'created', entity: newEntry })
        }
      }

      await trx.flush()
      return { counts: { created, updated, deleted }, pendingChanges: changes }
    })

    const dataEngine = container.resolve<DataEngine>('dataEngine')
    for (const change of pendingChanges) {
      await emitCrudSideEffects({
        dataEngine,
        action: change.action,
        entity: change.entity,
        identifiers: {
          id: change.entity.id,
          organizationId: change.entity.organizationId,
          tenantId: change.entity.tenantId,
        },
        events: staffTimeEntryCrudEvents,
      })
    }
    await flushCrudSideEffects(dataEngine)

    return NextResponse.json({ ok: true, ...counts }, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('staff.timesheets.time-entries.bulk failed', err)
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.bulkSave', 'Failed to bulk save time entries.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Bulk save time entries',
  methods: {
    POST: {
      summary: 'Bulk save time entries',
      description: 'Creates, updates, or soft-deletes multiple time entries in a single request. Entries with durationMinutes=0 and an existing id are soft-deleted.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeEntryBulkSaveSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Bulk save completed',
          schema: z.object({
            ok: z.literal(true),
            created: z.number(),
            updated: z.number(),
            deleted: z.number(),
          }),
        },
        {
          status: 422,
          description: 'Validation error',
          schema: z.object({
            ok: z.literal(false),
            errors: z.array(z.object({ path: z.string(), message: z.string() })),
          }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
