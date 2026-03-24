import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { UserConsent } from '@open-mercato/core/modules/auth/data/entities'
import { verifyConsentIntegrityHash } from '@open-mercato/core/modules/auth/lib/consentIntegrity'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  path: '/auth/users/consents',
  GET: {
    requireAuth: true,
    requireFeatures: ['users.view'],
  },
}

const querySchema = z.object({
  userId: z.string().uuid(),
})

type ConsentItem = {
  id: string
  consentType: string
  isGranted: boolean
  grantedAt: string | null
  withdrawnAt: string | null
  source: string | null
  ipAddress: string | null
  integrityValid: boolean
  createdAt: string
  updatedAt: string | null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const parsed = querySchema.safeParse({ userId: url.searchParams.get('userId') })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid userId' }, { status: 400 })
  }

  const container = await createRequestContainer(req)
  const em = container.resolve('em') as EntityManager
  const consents = await em.find(UserConsent, {
    userId: parsed.data.userId,
    deletedAt: null,
  }, { orderBy: { createdAt: 'DESC' } })

  const items: ConsentItem[] = consents.map((c) => ({
    id: c.id,
    consentType: c.consentType,
    isGranted: c.isGranted,
    grantedAt: c.grantedAt?.toISOString() ?? null,
    withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
    source: c.source ?? null,
    ipAddress: c.ipAddress ?? null,
    integrityValid: verifyConsentIntegrityHash({
      userId: c.userId,
      consentType: c.consentType,
      isGranted: c.isGranted,
      grantedAt: c.grantedAt,
      withdrawnAt: c.withdrawnAt,
      ipAddress: c.ipAddress,
      source: c.source,
    }, c.integrityHash),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt?.toISOString() ?? null,
  }))

  return NextResponse.json({ ok: true, items })
}

export default GET

const consentsGetDoc: OpenApiMethodDoc = {
  summary: 'List user consents',
  description: 'Returns all consent records for a given user, with integrity verification status.',
  tags: ['Auth'],
  query: querySchema,
  responses: [
    { status: 200, description: 'Consent list returned' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Auth',
  summary: 'User consents',
  methods: {
    GET: consentsGetDoc,
  },
}
