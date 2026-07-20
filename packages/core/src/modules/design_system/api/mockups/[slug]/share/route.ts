import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getMockupBySlug } from '../../../../mockups/loader'
import {
  getShareSecret,
  mintShareToken,
  SHARE_DEFAULT_EXPIRY_DAYS,
} from '../../../../mockups/share'
import {
  designSystemTag,
  mockupErrorSchema,
  mockupShareRequestSchema,
  mockupShareResponseSchema,
} from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['design_system.mockups.manage'] },
} as const

function resolveBaseUrl(req: Request): string {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (appUrl && appUrl.trim().length > 0) return appUrl.replace(/\/$/, '')
  const host = req.headers.get('host') ?? 'localhost'
  const protocol = req.headers.get('x-forwarded-proto') ?? 'http'
  return `${protocol}://${host}`
}

/**
 * Mints a tokenized read-only share link for exactly one mockup (spec
 * 2026-07-05-ds-live-mockup-composer.md, Phase 2 — Share links). 503 when
 * `MOCKUP_SHARE_SECRET` is unset — sharing never falls back to a guessable
 * scheme.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const secret = getShareSecret()
  if (!secret) {
    return NextResponse.json(
      { error: 'Sharing is disabled: MOCKUP_SHARE_SECRET is not configured' },
      { status: 503 },
    )
  }
  const { slug } = await params
  const mockup = getMockupBySlug(slug)
  if (!mockup) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!mockup.document) {
    return NextResponse.json(
      { error: 'Mockup document is invalid', issues: mockup.issues ?? [] },
      { status: 422 },
    )
  }
  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const parsed = mockupShareRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { token, expiresAt } = mintShareToken(
    slug,
    parsed.data.expiresInDays ?? SHARE_DEFAULT_EXPIRY_DAYS,
    secret,
  )
  const url = `${resolveBaseUrl(req)}/mockup-share/${token}`
  return NextResponse.json({ url, expiresAt })
}

export const openApi = {
  POST: {
    summary: 'Mint a tokenized read-only share link for a design mockup',
    description:
      'Returns a signed, expiring URL granting read access to exactly this mockup (default 7 days, maximum 30). 503 when MOCKUP_SHARE_SECRET is unset. Revocation is by secret rotation.',
    tags: [designSystemTag],
    requestBody: {
      content: { 'application/json': { schema: mockupShareRequestSchema } },
    },
    responses: {
      200: {
        description: 'Share link minted',
        content: { 'application/json': { schema: mockupShareResponseSchema } },
      },
      404: {
        description: 'Unknown slug',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      422: {
        description: 'Mockup document is invalid',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      503: {
        description: 'Sharing disabled: MOCKUP_SHARE_SECRET not configured',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
}
