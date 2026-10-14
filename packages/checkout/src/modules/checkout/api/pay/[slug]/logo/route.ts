import { NextResponse } from 'next/server'
import type { AttachmentOwner, AttachmentService, ReadScopedAttachmentResult } from '@open-mercato/core/modules/attachments'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink } from '../../../../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../../../../lib/constants'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { checkoutPublicViewRateLimitConfig, enforceCheckoutRateLimit } from '../../../../lib/rateLimiter'
import { isCheckoutLinkPublic, verifyCheckoutAccessToken } from '../../../../lib/utils'
import { handleCheckoutRouteError, readCheckoutAccessCookie, requirePreviewContext } from '../../../helpers'
import { checkoutTag } from '../../../openapi'

export const metadata = {
  path: '/checkout/pay/[slug]/logo',
  GET: { requireAuth: false },
}

type OwnerScopedReader = Required<Pick<AttachmentService, 'readScopedForOwner'>>

const LOGO_RENDITION = { width: 640, height: 240, cropType: 'contain' } as const

const RASTER_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])

function notFound() {
  return NextResponse.json({ error: 'checkout.payPage.errors.logoNotFound' }, { status: 404 })
}

function isRasterLogo(logo: ReadScopedAttachmentResult): boolean {
  const contentType = logo.contentType.split(';')[0]!.trim().toLowerCase()
  return logo.contentDisposition.startsWith('inline') && RASTER_LOGO_TYPES.has(contentType)
}

function resolveOwnerScopedReader(container: { resolve: (name: string) => unknown }): OwnerScopedReader | null {
  try {
    const candidate = container.resolve('attachmentService') as Partial<AttachmentService> | null
    if (candidate && typeof candidate.readScopedForOwner === 'function') return candidate as OwnerScopedReader
  } catch {
    return null
  }
  return null
}

async function readLogo(
  reader: OwnerScopedReader,
  link: CheckoutLink,
  attachmentId: string,
): Promise<ReadScopedAttachmentResult | null> {
  const owners: AttachmentOwner[] = [{ entityId: CHECKOUT_ENTITY_IDS.link, recordId: link.id }]
  if (link.templateId) owners.push({ entityId: CHECKOUT_ENTITY_IDS.template, recordId: link.templateId })
  for (const expectedOwner of owners) {
    try {
      return await reader.readScopedForOwner({
        attachmentId,
        tenantId: link.tenantId,
        organizationId: link.organizationId,
        expectedOwner,
        rendition: LOGO_RENDITION,
      })
    } catch (error) {
      if (isCrudHttpError(error) && error.status === 404) continue
      if (isCrudHttpError(error) && error.status < 500) return null
      throw error
    }
  }
  return null
}

/**
 * Serves a pay link's logo to the pay page's visitors, who are usually not
 * signed in.
 *
 * A public request is rate limited and served only for a published link, and
 * for a password-protected link only with a valid access cookie. A preview
 * (`?preview=true`) requires the checkout preview context and looks the link
 * up only within the caller's own tenant and organization.
 *
 * The logo is the link's own `logoAttachmentId`, read through the attachments
 * service's owner-scoped read, pinned to the link's tenant and organization,
 * to the link — or, for a logo inherited from its template, the template — as
 * owner, and to the partition the attachments upload route stores that owner's
 * files in by default (a logo uploaded to another partition is a 404). It comes back as the 640×240 `contain` rendition from
 * the attachments image pipeline, and only raster images are served: an SVG
 * or anything else is a 404.
 *
 * Caching: `public, max-age=300` for a published link (a logo on a public
 * page; five minutes bounds how long a replaced logo or an unpublished link
 * stays in shared caches), `private, max-age=300` for a password-protected
 * link (only the unlocked visitor's browser may keep it), and
 * `private, no-store` for a preview.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  try {
    const resolvedParams = await params
    const previewRequested = new URL(req.url).searchParams.get('preview') === 'true'
    const container = await createRequestContainer()
    if (!previewRequested) {
      const rateLimitResponse = await enforceCheckoutRateLimit({
        req,
        container,
        config: checkoutPublicViewRateLimitConfig,
        namespace: 'checkout-public-logo',
        errorMessage: 'Too many checkout page requests. Please try again later.',
        posture: 'fail-open',
      })
      if (rateLimitResponse) return rateLimitResponse
    }
    const previewScope = previewRequested ? (await requirePreviewContext(req)).auth : null
    const em = container.resolve('em')
    const link = await findOneWithDecryption(em, CheckoutLink, previewScope
      ? { slug: resolvedParams.slug, deletedAt: null, tenantId: previewScope.tenantId, organizationId: previewScope.orgId }
      : { slug: resolvedParams.slug, deletedAt: null })
    if (!link || (!previewRequested && !isCheckoutLinkPublic(link.status))) return notFound()
    const passwordVerified = previewRequested || !link.passwordHash || verifyCheckoutAccessToken(readCheckoutAccessCookie(req), link.slug, {
      linkId: link.id,
      sessionVersion: link.passwordHash,
    })
    const attachmentId = link.logoAttachmentId
    if (!passwordVerified || !attachmentId) return notFound()
    const reader = resolveOwnerScopedReader(container)
    if (!reader) return notFound()
    const logo = await readLogo(reader, link, attachmentId)
    if (!logo || !isRasterLogo(logo)) return notFound()
    const cacheControl = previewRequested
      ? 'private, no-store'
      : link.passwordHash
        ? 'private, max-age=300'
        : 'public, max-age=300'
    return new NextResponse(new Uint8Array(logo.buffer), {
      status: 200,
      headers: {
        'Cache-Control': cacheControl,
        'Content-Disposition': logo.contentDisposition,
        'Content-Length': String(logo.buffer.length),
        'Content-Type': logo.contentType,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
  methods: {
    GET: {
      summary: 'Pay link logo',
      description: 'Serves the logo of a published pay link to anonymous visitors, gated like the pay page itself.',
      errors: [
        { status: 404, description: 'The link is not published, is locked, or has no servable logo' },
        { status: 429, description: 'Too many checkout page requests', schema: rateLimitErrorSchema },
      ],
    },
  },
}

export default GET
