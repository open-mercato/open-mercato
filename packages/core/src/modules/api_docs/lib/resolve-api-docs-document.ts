import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { getAuthFromCookies, getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { buildSanitizedApiDocsOpenApiDocument } from './openapi-document'
import {
  API_DOCS_VIEW_FEATURE,
  isApiDocsPubliclyAvailable,
} from './public-access'
import { redactOpenApiSecurityMetadata } from './redact-openapi-security'

export async function userCanViewFullApiDocs(
  auth: AuthContext,
  request?: Request,
): Promise<boolean> {
  if (!auth?.sub) return false
  const container = await createRequestContainer()
  const rbac = container.resolve<RbacService>('rbacService')
  const featureContext = await resolveFeatureCheckContext({ container, auth, request })
  return rbac.userHasAllFeatures(auth.sub, [API_DOCS_VIEW_FEATURE], {
    tenantId: featureContext.scope.tenantId ?? auth.tenantId ?? null,
    organizationId: featureContext.organizationId,
  })
}

export async function resolveApiDocsDocumentForRequest(req: Request): Promise<OpenApiDocument> {
  const doc = await buildSanitizedApiDocsOpenApiDocument()
  if (!isApiDocsPubliclyAvailable()) {
    return doc
  }
  const auth = await getAuthFromRequest(req)
  if (auth && (await userCanViewFullApiDocs(auth, req))) {
    return doc
  }
  return redactOpenApiSecurityMetadata(doc)
}

export async function resolveApiDocsDocumentForViewer(): Promise<OpenApiDocument> {
  const doc = await buildSanitizedApiDocsOpenApiDocument()
  if (!isApiDocsPubliclyAvailable()) {
    return doc
  }
  const auth = await getAuthFromCookies()
  if (auth && (await userCanViewFullApiDocs(auth))) {
    return doc
  }
  return redactOpenApiSecurityMetadata(doc)
}
