import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { InstructorCredential } from '../../../../data/entities'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { scrapeCredential } from '../../../../lib/credential-scraper'
import { z } from 'zod'

const verifySchema = z.object({
  credentialId: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['instructors.credentials.manage'] },
}

export async function POST(request: Request, ctx: Record<string, unknown>) {
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
  const parsed = verifySchema.parse(scoped)

  const credential = await em.findOne(InstructorCredential, {
    id: parsed.credentialId,
    tenantId: scoped.tenantId,
    deletedAt: null,
  }) as Record<string, unknown> | null

  if (!credential) {
    throw new CrudHttpError(404, { error: t('instructors.errors.credentialNotFound', 'Credential not found.') })
  }

  const credentialUrl = credential.credentialUrl as string
  const scraped = await scrapeCredential(credentialUrl)

  const updateData: Record<string, unknown> = {
    verificationStatus: scraped.title ? 'verified' : 'failed',
    verifiedAt: scraped.title ? new Date() : null,
  }

  if (scraped.title) updateData.title = scraped.title
  if (scraped.issuer) updateData.issuer = scraped.issuer
  if (scraped.badgeImageUrl) updateData.badgeImageUrl = scraped.badgeImageUrl
  if (scraped.issuedAt) updateData.issuedAt = scraped.issuedAt
  if (scraped.expiresAt) updateData.expiresAt = scraped.expiresAt
  if (scraped.raw && Object.keys(scraped.raw).length > 0) {
    updateData.metadata = scraped.raw
  }

  em.assign(credential, updateData)
  await em.flush()

  return Response.json({
    ok: true,
    verificationStatus: updateData.verificationStatus,
    title: updateData.title ?? credential.title,
    issuer: updateData.issuer ?? credential.issuer,
  })
}
