import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'

export type TemplateFeatureAuthorizer = {
  userHasAllFeatures: (
    userId: string,
    requiredFeatures: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export type TemplateAccessPolicyOptions = {
  featureAuthorizer: TemplateFeatureAuthorizer
  auth: AuthContext
}

export type TemplateAccessInput = {
  requiredFeatures?: string[]
}

export type FilterAuthorizedTemplatesInput = {
  templates: TemplateMeta[]
}

type TemplateAccessChecks = Map<string, Promise<boolean>>

type EvaluateTemplateAccessInput = {
  template: TemplateMeta
  checks: TemplateAccessChecks
}

type CachedAccessDecisionInput = TemplateAccessInput & {
  checks: TemplateAccessChecks
}

type TemplateAccessDecision = {
  template: TemplateMeta
  allowed: boolean
}

export class TemplateAccessDeniedError extends Error {
  constructor(readonly requiredFeatures: string[]) {
    super('[internal] Document template access denied')
    this.name = 'TemplateAccessDeniedError'
  }
}

/** Applies source-module feature requirements declared by document templates. */
export class TemplateAccessPolicy {
  private readonly featureAuthorizer: TemplateFeatureAuthorizer
  private readonly auth: AuthContext

  constructor({ featureAuthorizer, auth }: TemplateAccessPolicyOptions) {
    this.featureAuthorizer = featureAuthorizer
    this.auth = auth
  }

  /** Throws when the authenticated caller lacks a feature required by the template. */
  async requireAccess(input: TemplateAccessInput): Promise<void> {
    if (await this.hasRequiredFeatures(input)) return
    throw new TemplateAccessDeniedError(input.requiredFeatures ?? [])
  }

  /** Returns only templates whose source-module requirements the caller satisfies. */
  async filterAuthorizedTemplates({ templates }: FilterAuthorizedTemplatesInput): Promise<TemplateMeta[]> {
    const checks: TemplateAccessChecks = new Map()
    const decisions = await Promise.all(
      templates.map((template) => this.evaluateTemplateAuthorization({ template, checks })),
    )

    return decisions
      .filter((decision) => decision.allowed)
      .map((decision) => decision.template)
  }

  private async evaluateTemplateAuthorization({
    template,
    checks,
  }: EvaluateTemplateAccessInput): Promise<TemplateAccessDecision> {
    const allowed = await this.getOrCreateFeatureCheck({
      requiredFeatures: template.requiredFeatures,
      checks,
    })

    return { template, allowed }
  }

  private getOrCreateFeatureCheck({
    requiredFeatures = [],
    checks,
  }: CachedAccessDecisionInput): Promise<boolean> {
    const key = [...requiredFeatures].sort().join('\u0000')
    const existingCheck = checks.get(key)
    if (existingCheck) return existingCheck

    const check = this.hasRequiredFeatures({ requiredFeatures })
    checks.set(key, check)
    return check
  }

  private async hasRequiredFeatures({ requiredFeatures = [] }: TemplateAccessInput): Promise<boolean> {
    if (requiredFeatures.length === 0) return true
    if (!this.auth?.sub) return false

    return this.featureAuthorizer.userHasAllFeatures(this.auth.sub, requiredFeatures, {
      tenantId: this.auth.tenantId ?? null,
      organizationId: this.auth.orgId ?? null,
    })
  }
}
