import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { InstructorProfile } from '../../../data/entities'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['instructors.manage'] },
}

export async function DELETE(request: Request, ctx: Record<string, unknown>) {
  const { translate: t } = await resolveTranslations()
  const url = new URL(request.url)
  const recordId = url.searchParams.get('id')

  const container = (ctx as { container?: { resolve: (key: string) => unknown } }).container
  if (!container) throw new CrudHttpError(500, { error: 'Container unavailable' })

  const em = container.resolve('em') as {
    findOne: (entity: unknown, where: unknown) => Promise<Record<string, unknown> | null>
    assign: (entity: unknown, data: unknown) => void
    flush: () => Promise<void>
  }

  if (!recordId) {
    throw new CrudHttpError(400, { error: t('instructors.errors.idRequired', 'Instructor profile id is required.') })
  }

  const scoped = withScopedPayload({}, ctx as Parameters<typeof withScopedPayload>[1], t)

  const profile = await em.findOne(InstructorProfile, {
    id: recordId,
    tenantId: scoped.tenantId,
    deletedAt: null,
  })
  if (!profile) {
    throw new CrudHttpError(404, { error: t('instructors.errors.notFound', 'Instructor profile not found.') })
  }

  em.assign(profile, { deletedAt: new Date() })
  await em.flush()

  return Response.json({ ok: true })
}
