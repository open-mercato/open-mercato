import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DocumentStructureAccessScope } from './service'

export type DocumentStructureRouteParams = { id: string }
export type DocumentStructureRouteContext = { params: Promise<DocumentStructureRouteParams> }

type AuthenticatedAuth = NonNullable<AuthContext>

export type DocumentStructureRouteScope = {
  auth: AuthenticatedAuth
  tenantId: string
  organizationId: string
  attachmentId: string
  scope: DocumentStructureAccessScope
}

const attachmentIdSchema = z.string().uuid()

async function readAttachmentId(ctx: DocumentStructureRouteContext): Promise<string | null> {
  try {
    const params = await ctx.params
    const parsed = attachmentIdSchema.safeParse(params?.id)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function documentStructureNotFoundResponse(): Promise<NextResponse> {
  const { translate } = await resolveTranslations()
  return NextResponse.json(
    { error: translate('attachments.structure.errors.notFound', 'Attachment not found') },
    { status: 404 },
  )
}

export async function resolveDocumentStructureRouteScope(
  req: Request,
  ctx: DocumentStructureRouteContext,
): Promise<DocumentStructureRouteScope | Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!auth.orgId) return organizationScopeRequiredResponse()
  const attachmentId = await readAttachmentId(ctx)
  if (!attachmentId) return documentStructureNotFoundResponse()
  return {
    auth,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    attachmentId,
    scope: { tenantId: auth.tenantId, organizationId: auth.orgId, auth },
  }
}

export async function validationErrorResponse(error: z.ZodError): Promise<NextResponse> {
  const { translate } = await resolveTranslations()
  return NextResponse.json(
    {
      error: translate('attachments.structure.errors.invalidRequest', 'Invalid request'),
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    },
    { status: 400 },
  )
}

export function resolveUserFeatures(auth: AuthenticatedAuth): string[] {
  const features = auth.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}
