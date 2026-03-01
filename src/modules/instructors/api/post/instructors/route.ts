import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { instructorCreateSchema } from '../../../data/validators'
import { InstructorProfile } from '../../../data/entities'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['instructors.manage'] },
}

export async function POST(request: Request, ctx: Record<string, unknown>) {
  const { translate: t } = await resolveTranslations()
  const body = await request.json()
  const container = (ctx as { container?: { resolve: (key: string) => unknown } }).container
  if (!container) throw new CrudHttpError(500, { error: 'Container unavailable' })

  const em = container.resolve('em') as {
    create: (entity: unknown, data: unknown) => unknown
    persistAndFlush: (entity: unknown) => Promise<void>
    findOne: (entity: unknown, where: unknown) => Promise<unknown>
  }

  const scoped = withScopedPayload(body, ctx as Parameters<typeof withScopedPayload>[1], t)
  const parsed = instructorCreateSchema.parse(scoped)

  const existing = await em.findOne(InstructorProfile, {
    tenantId: scoped.tenantId,
    userId: parsed.userId,
    deletedAt: null,
  })
  if (existing) {
    throw new CrudHttpError(409, { error: t('instructors.errors.profileExists', 'An instructor profile already exists for this user.') })
  }

  const slugExists = await em.findOne(InstructorProfile, {
    tenantId: scoped.tenantId,
    slug: parsed.slug,
    deletedAt: null,
  })
  if (slugExists) {
    throw new CrudHttpError(409, { error: t('instructors.errors.slugTaken', 'This slug is already in use.') })
  }

  const profile = em.create(InstructorProfile, {
    organizationId: scoped.organizationId ?? scoped.tenantId,
    tenantId: scoped.tenantId,
    userId: parsed.userId,
    displayName: parsed.displayName,
    slug: parsed.slug,
    bio: parsed.bio ?? null,
    headline: parsed.headline ?? null,
    avatarUrl: parsed.avatarUrl ?? null,
    specializations: parsed.specializations ?? null,
    experienceYears: parsed.experienceYears ?? null,
    hourlyRate: parsed.hourlyRate ?? null,
    currency: parsed.currency,
    isAvailable: parsed.isAvailable ?? true,
    websiteUrl: parsed.websiteUrl ?? null,
    githubUrl: parsed.githubUrl ?? null,
    linkedinUrl: parsed.linkedinUrl ?? null,
  })

  await em.persistAndFlush(profile)

  return Response.json(
    { id: (profile as { id: string }).id },
    { status: 201 },
  )
}
