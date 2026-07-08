import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { assertTier } from '../../../lib/permissions'
import {
  COLLAB_TOKEN_TTL_SECONDS,
  mintCollabToken,
} from '../../../lib/collabToken'
import {
  handleDocumentsRouteError,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const collabTokenResponseSchema = z.object({
  token: z.string(),
  url: z.string().nullable(),
  documentId: z.string(),
  tier: z.string(),
  expiresInSec: z.number(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
  }),
})

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function channelToHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0')
}

function hslToHex(hue: number, saturationPercent: number, lightnessPercent: number): string {
  const saturation = saturationPercent / 100
  const lightness = lightnessPercent / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const intermediate = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = lightness - chroma / 2
  const [red, green, blue] =
    hue < 60 ? [chroma, intermediate, 0]
      : hue < 120 ? [intermediate, chroma, 0]
        : hue < 180 ? [0, chroma, intermediate]
          : hue < 240 ? [0, intermediate, chroma]
            : hue < 300 ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate]
  return `#${channelToHex((red + match) * 255)}${channelToHex((green + match) * 255)}${channelToHex((blue + match) * 255)}`
}

function resolveUserColor(userId: string): string {
  return hslToHex(hashString(userId) % 360, 64, 42)
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params
    const id = params.id
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const tier = await assertTier(ctx.em, id, ctx.auth, 'viewer')
    const userId = resolveActorUserId(ctx.auth)
    const userName = typeof ctx.auth.email === 'string' && ctx.auth.email ? ctx.auth.email : userId
    const token = mintCollabToken({
      userId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId: id,
      tier,
    })

    return NextResponse.json({
      token,
      url: process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL ?? null,
      documentId: id,
      tier,
      expiresInSec: COLLAB_TOKEN_TTL_SECONDS,
      user: {
        id: userId,
        name: userName,
        color: resolveUserColor(userId),
      },
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.collabToken.get')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document collaboration token',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Mint document collaboration token',
      responses: [{ status: 200, description: 'Collaboration token', schema: collabTokenResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Not found', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET }
