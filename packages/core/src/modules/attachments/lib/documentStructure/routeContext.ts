import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Attachment } from '../../data/entities'
import { isSuperAdminAuth } from '../access'
import { resolveAttachmentRequestScope } from '../requestScope'
import type { DocumentStructureAccessScope } from './service'

export type DocumentStructureRouteParams = { id: string }
export type DocumentStructureRouteContext = { params: Promise<DocumentStructureRouteParams> }

type AuthenticatedAuth = NonNullable<AuthContext>

export type DocumentStructureRouteScope = {
  container: AwilixContainer
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
  const attachmentId = await readAttachmentId(ctx)
  const container = await createRequestContainer()
  const requestScope = await resolveAttachmentRequestScope(container, auth, req)
  if (requestScope.denied) return documentStructureNotFoundResponse()
  const tenantId = auth.tenantId
  let organizationId = requestScope.organizationId
  if (!organizationId && !isSuperAdminAuth(auth)) return organizationScopeRequiredResponse()
  if (!attachmentId) return documentStructureNotFoundResponse()
  if (!organizationId) {
    organizationId = await resolveAttachmentOrganizationForSuperAdmin(container, tenantId, attachmentId)
    if (!organizationId) return documentStructureNotFoundResponse()
  }
  const scopedAuth: AuthenticatedAuth = { ...auth, orgId: organizationId }
  return {
    container,
    auth: scopedAuth,
    tenantId,
    organizationId,
    attachmentId,
    scope: { tenantId, organizationId, auth: scopedAuth },
  }
}

async function resolveAttachmentOrganizationForSuperAdmin(
  container: AwilixContainer,
  tenantId: string,
  attachmentId: string,
): Promise<string | null> {
  const em = container.resolve<EntityManager>('em')
  const attachment = await findOneWithDecryption(
    em,
    Attachment,
    { id: attachmentId, tenantId },
    { fields: ['id', 'organizationId'] },
    { tenantId, organizationId: null },
  )
  return attachment?.organizationId ?? null
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
