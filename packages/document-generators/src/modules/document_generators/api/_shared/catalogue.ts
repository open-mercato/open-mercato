import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { TemplateAccessPolicy, type TemplateFeatureAuthorizer } from '../../lib/template-access-policy'
import { requireOrganization, type OrganizationScopeContainer, type TranslateFn } from './http'

export async function listAuthorizedTemplates(input: {
  auth: NonNullable<AuthContext>
  container: OrganizationScopeContainer
  request: Request
  translate: TranslateFn
  templates: TemplateMeta[]
}): Promise<TemplateMeta[]> {
  const { auth, container, request, translate, templates } = input
  const organization = await requireOrganization({ auth, container, request, translate })
  const effectiveAuth = organization.ok ? organization.auth : auth
  const featureAuthorizer = container.resolve('rbacService') as TemplateFeatureAuthorizer
  const policy = new TemplateAccessPolicy({ featureAuthorizer, auth: effectiveAuth })
  return policy.filterAuthorizedTemplates({ templates })
}
