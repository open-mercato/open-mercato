import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { templateRegistry } from '../../lib/template-registry'

type RbacService = {
  userHasAllFeatures: (
    userId: string,
    requiredFeatures: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export class TemplateAccessDeniedError extends Error {
  constructor(readonly requiredFeatures: string[]) {
    super('[internal] Document template access denied')
    this.name = 'TemplateAccessDeniedError'
  }
}

async function hasTemplateAccess(
  template: TemplateMeta,
  context: { container: AppContainer; auth: AuthContext },
): Promise<boolean> {
  const requiredFeatures = template.requiredFeatures ?? []
  if (requiredFeatures.length === 0) return true
  if (!context.auth?.sub) return false

  let rbacService: RbacService
  try {
    rbacService = context.container.resolve('rbacService') as RbacService
  } catch {
    return false
  }

  return rbacService.userHasAllFeatures(context.auth.sub, requiredFeatures, {
    tenantId: context.auth.tenantId ?? null,
    organizationId: context.auth.orgId ?? null,
  })
}

export async function requireTemplateAccess(
  templateId: string,
  context: { container: AppContainer; auth: AuthContext },
): Promise<void> {
  const template = templateRegistry.getTemplateMetadata(templateId)
  if (await hasTemplateAccess(template, context)) return
  throw new TemplateAccessDeniedError(template.requiredFeatures ?? [])
}

export async function filterTemplatesByAccess(
  templates: TemplateMeta[],
  context: { container: AppContainer; auth: AuthContext },
): Promise<TemplateMeta[]> {
  const checks = new Map<string, Promise<boolean>>()
  const access = await Promise.all(
    templates.map((template) => {
      const requiredFeatures = template.requiredFeatures ?? []
      const key = [...requiredFeatures].sort().join('\u0000')
      const existingCheck = checks.get(key)
      if (existingCheck) return existingCheck
      const check = hasTemplateAccess(template, context)
      checks.set(key, check)
      return check
    }),
  )
  return templates.filter((_template, index) => access[index])
}
