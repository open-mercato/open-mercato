import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  COLLAB_TOKEN_TTL_SECONDS,
  isCollabTokenV2Ready,
  mintCollabTokenV2,
  verifyCollabTokenV2,
} from '../../../lib/collabToken'
import { resolveUserLabels } from '../../../lib/userLabels'
import { resolveCollaborationUserColor } from '../../../lib/collaborationAwareness'
import { resolveDocumentsCollaborationEndpoint } from '../../../lib/collabEndpoint'
import { resolvePermission } from '../../../lib/permissions'
import {
  loadDocumentArchivedState,
  deriveCapabilitiesForContext,
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
  tier: z.enum(['owner', 'editor', 'commenter', 'viewer']),
  expiresInSec: z.number(),
  expiresAt: z.string(),
  userName: z.string(),
  userColor: z.string(),
  canEdit: z.boolean(),
  readOnly: z.boolean(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
}

const logger = createLogger('documents').child({ component: 'api' })

let warnedCollabTokenSecretNotReady = false
let warnedCollabEndpointInvalid = false

function warnCollabTokenSecretNotReadyOnce(): void {
  if (warnedCollabTokenSecretNotReady) return
  warnedCollabTokenSecretNotReady = true
  logger.warn(
    'DOCUMENTS_COLLAB_JWT_SECRET_V2 is missing, shorter than 32 UTF-8 bytes, '
    + 'or equal to DOCUMENTS_COLLAB_JWT_SECRET; collaboration tokens cannot be minted '
    + 'and clients fall back to non-collaborative editing.',
  )
}

function warnCollabEndpointInvalidOnce(): void {
  if (warnedCollabEndpointInvalid) return
  warnedCollabEndpointInvalid = true
  logger.warn(
    'Ignoring NEXT_PUBLIC_DOCUMENTS_COLLAB_URL because it is not a valid browser-reachable '
    + 'ws(s) endpoint; collaboration is disabled and clients fall back to non-collaborative editing.',
  )
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params
    const id = params.id
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    // The collaboration sidecar currently reauthorizes the signed user
    // identity and has no API-key subject with which to reload the key's
    // restricted ACL/roles. Do not mint a token that would silently promote a
    // bound key to its backing user's full collaboration access.
    if (ctx.auth.isApiKey === true || ctx.auth.sub.startsWith('api_key:')) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    // One relationship lookup feeds both projections. The pre-archive check
    // still runs first so an unauthorized caller cannot tell an existing
    // document apart from a missing one via the 404 the archived read raises.
    const relationshipTier = await resolvePermission(ctx.em, id, ctx.auth)
    if (!relationshipTier || !deriveCapabilitiesForContext(ctx, relationshipTier).canView) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const archivedState = await loadDocumentArchivedState(ctx, id)
    const capabilities = deriveCapabilitiesForContext(ctx, relationshipTier, {
      archived: archivedState.archivedAt !== null,
    })
    if (!capabilities.canView) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const userId = resolveActorUserId(ctx.auth)
    const [userLabels, translations] = await Promise.all([
      resolveUserLabels(
        ctx.container,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        [userId],
      ),
      resolveTranslations(),
    ])
    const userName = userLabels.get(userId)?.label
      ?? translations.translate('documents.users.unknown', 'Unknown user')
    const userColor = resolveCollaborationUserColor(userId)
    const readOnly = !capabilities.canEdit
    if (!isCollabTokenV2Ready()) {
      // A misconfigured capability secret must degrade to the same graceful
      // non-collaborative response as an unset NEXT_PUBLIC_DOCUMENTS_COLLAB_URL
      // (url: null) instead of a 500 the client would classify as transient
      // and retry until its fallback timer.
      warnCollabTokenSecretNotReadyOnce()
      return NextResponse.json(
        {
          token: '',
          url: null,
          documentId: id,
          tier: relationshipTier,
          expiresInSec: COLLAB_TOKEN_TTL_SECONDS,
          expiresAt: new Date(Date.now() + COLLAB_TOKEN_TTL_SECONDS * 1000).toISOString(),
          userName,
          userColor,
          canEdit: capabilities.canEdit,
          readOnly,
          user: {
            id: userId,
            name: userName,
            color: userColor,
          },
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    const collaborationEndpoint = resolveDocumentsCollaborationEndpoint()
    if (process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL && !collaborationEndpoint) {
      warnCollabEndpointInvalidOnce()
    }
    const token = mintCollabTokenV2({
      userId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId: id,
      tier: relationshipTier,
      tokenVersion: 2,
      readOnly,
    })
    const verifiedToken = verifyCollabTokenV2(token)
    if (!verifiedToken) {
      throw new Error('[internal] Failed to verify a freshly minted collaboration token')
    }

    return NextResponse.json(
      {
        token,
        url: collaborationEndpoint,
        documentId: id,
        tier: relationshipTier,
        expiresInSec: COLLAB_TOKEN_TTL_SECONDS,
        expiresAt: new Date(verifiedToken.exp * 1000).toISOString(),
        userName,
        userColor,
        canEdit: capabilities.canEdit,
        readOnly,
        user: {
          id: userId,
          name: userName,
          color: userColor,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
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
