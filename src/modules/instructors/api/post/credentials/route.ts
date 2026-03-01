import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { credentialCreateSchema } from '../../../data/validators'
import { InstructorCredential, InstructorProfile } from '../../../data/entities'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { scrapeCredential, detectCredentialType } from '../../../lib/credential-scraper'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['instructors.credentials.manage'] },
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
  const parsed = credentialCreateSchema.parse(scoped)

  const instructor = await em.findOne(InstructorProfile, {
    id: parsed.instructorId,
    tenantId: scoped.tenantId,
    deletedAt: null,
  })
  if (!instructor) {
    throw new CrudHttpError(404, { error: t('instructors.errors.instructorNotFound', 'Instructor profile not found.') })
  }

  const detectedType = parsed.credentialType ?? detectCredentialType(parsed.credentialUrl)

  let scrapedTitle = parsed.title ?? null
  let scrapedIssuer = parsed.issuer ?? null
  let scrapedBadgeImage = parsed.badgeImageUrl ?? null
  let scrapedIssuedAt = parsed.issuedAt ?? null
  let scrapedMetadata: Record<string, unknown> | null = null
  let verificationStatus: 'pending' | 'verified' | 'failed' = 'pending'

  try {
    const scraped = await scrapeCredential(parsed.credentialUrl)
    scrapedTitle = scrapedTitle ?? scraped.title
    scrapedIssuer = scrapedIssuer ?? scraped.issuer
    scrapedBadgeImage = scrapedBadgeImage ?? scraped.badgeImageUrl
    scrapedIssuedAt = scrapedIssuedAt ?? scraped.issuedAt
    scrapedMetadata = scraped.raw && Object.keys(scraped.raw).length > 0 ? scraped.raw : null
    if (scraped.title) {
      verificationStatus = 'verified'
    }
  } catch {
    // scraping failed; credential stays pending
  }

  const credential = em.create(InstructorCredential, {
    organizationId: scoped.organizationId ?? scoped.tenantId,
    tenantId: scoped.tenantId,
    instructorId: parsed.instructorId,
    credentialUrl: parsed.credentialUrl,
    credentialType: detectedType,
    title: scrapedTitle,
    issuer: scrapedIssuer,
    badgeImageUrl: scrapedBadgeImage,
    issuedAt: scrapedIssuedAt,
    expiresAt: parsed.expiresAt ?? null,
    verificationStatus,
    verifiedAt: verificationStatus === 'verified' ? new Date() : null,
    metadata: scrapedMetadata,
    sortOrder: parsed.sortOrder ?? 0,
  })

  await em.persistAndFlush(credential)

  return Response.json(
    { id: (credential as { id: string }).id, verificationStatus },
    { status: 201 },
  )
}
