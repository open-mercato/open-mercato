import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { TemplateAccessDeniedError } from './template-errors'

export interface TemplateFeatureAuthorizer {
  userHasAllFeatures(
    userId: string,
    requiredFeatures: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}

export class TemplateAccessPolicy {
  constructor(private readonly options: { featureAuthorizer: TemplateFeatureAuthorizer; auth: AuthContext }) {}

  async requireAccess(input: { requiredFeatures?: string[] }): Promise<void> {
    if (!await this.hasAccess(input.requiredFeatures ?? [])) {
      throw new TemplateAccessDeniedError(input.requiredFeatures ?? [])
    }
  }

  async filterAuthorizedTemplates(input: { templates: TemplateMeta[] }): Promise<TemplateMeta[]> {
    const checks = new Map<string, Promise<boolean>>()
    const allowed = await Promise.all(input.templates.map((template) => {
      const features = [...new Set(template.requiredFeatures ?? [])].sort()
      const key = JSON.stringify(features)
      let check = checks.get(key)
      if (!check) {
        check = this.hasAccess(features)
        checks.set(key, check)
      }
      return check
    }))
    return input.templates.filter((_template, index) => allowed[index])
  }

  private async hasAccess(features: string[]): Promise<boolean> {
    if (features.length === 0) return true
    const auth = this.options.auth
    if (!auth?.sub) return false
    return this.options.featureAuthorizer.userHasAllFeatures(auth.sub, features, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
  }
}
