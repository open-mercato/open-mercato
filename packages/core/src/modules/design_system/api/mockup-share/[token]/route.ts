import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { loadCopyFileFor } from '../../../mockups/loader'
import {
  getShareSecret,
  mockupShareViewRateLimitConfig,
  resolveSharedMockup,
} from '../../../mockups/share'
import { designSystemTag, mockupErrorSchema, mockupSharedViewResponseSchema } from '../../mockups/openapi'

export const metadata = {
  GET: { requireAuth: false },
} as const

const NOINDEX_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow' } as const

function uniformNotFound(): NextResponse {
  // One answer for every failure class — invalid, expired, tampered, and
  // unknown-document tokens are indistinguishable (no oracle).
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NOINDEX_HEADERS })
}

/**
 * The module's single public surface (spec 2026-07-05-ds-live-mockup-composer.md,
 * Phase 2 — Share links): token-gated, read-only, rate-limited, noindex,
 * disabled entirely without `MOCKUP_SHARE_SECRET`. The token authorizes one
 * slug — no list, no writes.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const container = await createRequestContainer()
    const rateLimiter = container.resolve('rateLimiterService') as RateLimiterService
    const ip = getClientIp(req, rateLimiter.trustProxyDepth) ?? 'unknown'
    const rateLimitResponse = await checkRateLimit(
      rateLimiter,
      mockupShareViewRateLimitConfig,
      `mockup-share-view:${ip}`,
      'Too many requests. Please try again later.',
    )
    if (rateLimitResponse) return rateLimitResponse
  } catch {
    // Rate limiting is fail-open, matching the other public routes.
  }

  const { token } = await params
  const resolution = resolveSharedMockup(token, getShareSecret())
  if (!resolution.ok) return uniformNotFound()

  const { mockup } = resolution
  return NextResponse.json(
    {
      document: mockup.document,
      coverage: {
        totals: mockup.counts,
        userStories: mockup.userStories,
        findings: mockup.findings,
      },
      contentHash: mockup.contentHash,
      copy: loadCopyFileFor(mockup),
    },
    { headers: NOINDEX_HEADERS },
  )
}

export const openApi = {
  GET: {
    summary: 'Read a shared design mockup (token-gated public surface)',
    description:
      'Read-only access to exactly one mockup through a signed, expiring share token. Uniform 404 for invalid, expired, or tampered tokens; rate-limited per IP; noindex; disabled entirely without MOCKUP_SHARE_SECRET. Mockups contain committed sample data only — never tenant data.',
    tags: [designSystemTag],
    responses: {
      200: {
        description: 'Shared mockup document with coverage',
        content: { 'application/json': { schema: mockupSharedViewResponseSchema } },
      },
      404: {
        description: 'Invalid, expired, or tampered token — uniform for all failure classes',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
}
