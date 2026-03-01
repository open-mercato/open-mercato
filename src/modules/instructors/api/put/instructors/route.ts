import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { instructorUpdateSchema } from '../../../data/validators'
import { InstructorProfile } from '../../../data/entities'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['instructors.manage'] },
}

export async function PUT(request: Request, ctx: Record<string, unknown>) {
  const { translate: t } = await resolveTranslations()
  const body = await request.json()
  const container = (ctx as { container?: { resolve: (key: string) => unknown } }).container
  if (!container) throw new CrudHttpError(500, { error: 'Container unavailable' })

  const em = container.resolve('em') as {
    findOne: (entity: unknown, where: unknown) => Promise<Record<string, unknown> | null>
    assign: (entity: unknown, data: unknown) => void
    flush: () => Promise<void>
  }

  const scoped = withScopedPayload(body, ctx as Parameters<typeof withScopedPayload>[1], t)
  const recordId = scoped.id as string | undefined
  if (!recordId) {
    throw new CrudHttpError(400, { error: t('instructors.errors.idRequired', 'Instructor profile id is required.') })
  }

  const parsed = instructorUpdateSchema.parse(scoped)

  const profile = await em.findOne(InstructorProfile, {
    id: recordId,
    tenantId: scoped.tenantId,
    deletedAt: null,
  })
  if (!profile) {
    throw new CrudHttpError(404, { error: t('instructors.errors.notFound', 'Instructor profile not found.') })
  }

  if (parsed.slug) {
    const slugExists = await em.findOne(InstructorProfile, {
      tenantId: scoped.tenantId,
      slug: parsed.slug,
      deletedAt: null,
      id: { $ne: recordId },
    } as Record<string, unknown>)
    if (slugExists) {
      throw new CrudHttpError(409, { error: t('instructors.errors.slugTaken', 'This slug is already in use.') })
    }
  }

  const updateData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      updateData[key] = value
    }
  }

  em.assign(profile, updateData)
  await em.flush()

  return Response.json({ ok: true })
}
