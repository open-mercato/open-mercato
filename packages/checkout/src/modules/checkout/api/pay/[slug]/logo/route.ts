import { NextResponse } from 'next/server'
import type { AttachmentOwner, AttachmentService, ReadScopedAttachmentResult } from '@open-mercato/core/modules/attachments'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink } from '../../../../data/entities'
import { CHECKOUT_ENTITY_IDS, CHECKOUT_LOGO_ATTACHMENT_PARTITION } from '../../../../lib/constants'
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

function notFound() {
  return NextResponse.json({ error: 'Logo not found' }, { status: 404 })
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
        expectedPartitionCode: CHECKOUT_LOGO_ATTACHMENT_PARTITION,
      })
    } catch (error) {
      if (isCrudHttpError(error) && error.status === 404) continue
      throw error
    }
  }
  return null
}

/**
 * Serves a pay link's logo to the pay page's visitors, who are usually not
 * signed in. The link is resolved and gated exactly as the pay page itself
 * (published or previewed, unlocked when password-protected); the logo is
 * read through the attachments service's owner-scoped read, pinned to the
 * link's tenant, organization and partition and to the link — or, for a logo
 * inherited from its template, the template — as owner. Only files the
 * attachments service serves inline (raster images) are returned.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  try {
    const resolvedParams = await params
    const previewRequested = new URL(req.url).searchParams.get('preview') === 'true'
    const container = await createRequestContainer()
    if (previewRequested) await requirePreviewContext(req)
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
    const em = container.resolve('em')
    const link = await findOneWithDecryption(em, CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
    })
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
    if (!logo || !logo.contentDisposition.startsWith('inline')) return notFound()
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
