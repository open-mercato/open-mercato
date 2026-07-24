import type { EntityManager } from '@mikro-orm/postgresql'
import type { WarrantyClaimEffectiveSettings } from '../lib/settings'
import type { ClaimRiskAssessment } from '../lib/risk'
import type { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import { tryResolve } from '../lib/tryResolve'

export interface WarrantyAdjudicationDecision {
  decision: 'auto_approve' | 'manual_review'
  facts: Record<string, unknown>
}

export interface WarrantyAdjudicationEvaluator {
  evaluate(args: {
    claim: WarrantyClaim
    lines: WarrantyClaimLine[]
    settings: WarrantyClaimEffectiveSettings
    risk: ClaimRiskAssessment
    container: { resolve: <R = unknown>(n: string) => R }
    em: EntityManager
    scope: { tenantId: string; organizationId: string }
  }): Promise<WarrantyAdjudicationDecision>
}

type BusinessRulesClaimData = {
  claim: Record<string, unknown>
  lines: Array<Record<string, unknown>>
  settings: Record<string, unknown>
  risk: ClaimRiskAssessment
}

type BusinessRulesClaimEvaluationArgs = {
  claim: WarrantyClaim
  lines: WarrantyClaimLine[]
  settings: WarrantyClaimEffectiveSettings
  risk: ClaimRiskAssessment
  em: EntityManager
  scope: { tenantId: string; organizationId: string }
  data: BusinessRulesClaimData
}

type BusinessRulesExecutionContext = {
  entityType: string
  entityId: string
  eventType: string
  data: BusinessRulesClaimData
  tenantId: string
  organizationId: string
  dryRun: boolean
}

type BusinessRulesExecutionResult = {
  allowed?: boolean
  executedRules?: unknown[]
  errors?: unknown[]
}

type BusinessRulesServiceLike = {
  evaluateWarrantyClaim?: (args: BusinessRulesClaimEvaluationArgs) => Promise<unknown>
  evaluate?: (args: BusinessRulesClaimEvaluationArgs) => Promise<unknown>
  executeRules?: (em: EntityManager, context: BusinessRulesExecutionContext) => Promise<BusinessRulesExecutionResult>
}

type LightDecisionEvaluation = {
  eligible: boolean
  facts: Record<string, unknown>
}

function numericAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readDecision(value: unknown): WarrantyAdjudicationDecision['decision'] | null {
  return value === 'auto_approve' || value === 'manual_review' ? value : null
}

function buildBusinessRulesData(args: {
  claim: WarrantyClaim
  lines: WarrantyClaimLine[]
  settings: WarrantyClaimEffectiveSettings
  risk: ClaimRiskAssessment
}): BusinessRulesClaimData {
  return {
    claim: {
      id: args.claim.id,
      claimType: args.claim.claimType,
      status: args.claim.status,
      currencyCode: args.claim.currencyCode ?? null,
      totalClaimedAmount: numericAmount(args.claim.totalClaimedAmount),
      customerId: args.claim.customerId ?? null,
      orderId: args.claim.orderId ?? null,
      reasonCode: args.claim.reasonCode ?? null,
    },
    lines: args.lines.map((line) => ({
      id: line.id,
      warrantyStatus: line.warrantyStatus,
      lineStatus: line.lineStatus,
      qtyClaimed: numericAmount(line.qtyClaimed),
      creditAmount: numericAmount(line.creditAmount),
      disposition: line.disposition ?? null,
      conditionGrade: line.conditionGrade ?? null,
      quarantineStatus: line.quarantineStatus,
    })),
    settings: {
      autoApproveEnabled: args.settings.autoApproveEnabled,
      autoApproveMaxAmount: args.settings.autoApproveMaxAmount,
      autoApproveCurrencyCode: args.settings.autoApproveCurrencyCode,
      autoApproveRequireInWarranty: args.settings.autoApproveRequireInWarranty,
      adjudicationUseRules: args.settings.adjudicationUseRules,
    },
    risk: args.risk,
  }
}

function evaluateLightEligibility(args: {
  claim: WarrantyClaim
  lines: WarrantyClaimLine[]
  settings: WarrantyClaimEffectiveSettings
  risk: ClaimRiskAssessment
}): LightDecisionEvaluation {
  const currencyCode = args.claim.currencyCode ?? null
  const hasLimit = args.settings.autoApproveMaxAmount !== null && args.settings.autoApproveCurrencyCode !== null
  const currencyMatches = currencyCode === args.settings.autoApproveCurrencyCode
  const amountWithinLimit = args.settings.autoApproveMaxAmount !== null
    && numericAmount(args.claim.totalClaimedAmount) <= args.settings.autoApproveMaxAmount
  const warrantyRequirementSatisfied = !args.settings.autoApproveRequireInWarranty
    || args.lines.every((line) => line.warrantyStatus === 'in_warranty')
  const eligible = args.settings.autoApproveEnabled
    && hasLimit
    && args.lines.length > 0
    && currencyMatches
    && amountWithinLimit
    && warrantyRequirementSatisfied
    && args.risk.signals.length === 0

  return {
    eligible,
    facts: {
      rule: 'light',
      mode: 'light',
      autoApproveEligible: eligible,
      forcedManualByRisk: false,
      autoApproveEnabled: args.settings.autoApproveEnabled,
      hasLimit,
      lineCount: args.lines.length,
      currencyMatches,
      amountWithinLimit,
      warrantyRequirementSatisfied,
      riskLevel: args.risk.level,
      riskSignalCount: args.risk.signals.length,
    },
  }
}

function lightDecision(args: {
  claim: WarrantyClaim
  lines: WarrantyClaimLine[]
  settings: WarrantyClaimEffectiveSettings
  risk: ClaimRiskAssessment
}): WarrantyAdjudicationDecision {
  const light = evaluateLightEligibility(args)
  return {
    decision: light.eligible ? 'auto_approve' : 'manual_review',
    facts: light.facts,
  }
}

function businessRulesDecision(
  decision: WarrantyAdjudicationDecision['decision'],
  risk: ClaimRiskAssessment,
  facts: Record<string, unknown>,
): WarrantyAdjudicationDecision {
  return {
    decision,
    facts: {
      rule: 'business_rules',
      mode: 'business_rules',
      delegated: true,
      autoApproveEligible: decision === 'auto_approve',
      forcedManualByRisk: false,
      riskLevel: risk.level,
      riskSignalCount: risk.signals.length,
      ...facts,
    },
  }
}

function parseBusinessRulesDecision(value: unknown, risk: ClaimRiskAssessment): WarrantyAdjudicationDecision | null {
  if (!isRecord(value)) return null

  const directDecision = readDecision(value.decision)
  if (directDecision) {
    return businessRulesDecision(directDecision, risk, {})
  }

  const nestedResult = isRecord(value.result) ? value.result : null
  const nestedDecision = nestedResult ? readDecision(nestedResult.decision) : null
  if (nestedDecision) {
    return businessRulesDecision(nestedDecision, risk, {})
  }

  const allowed = typeof value.allowed === 'boolean'
    ? value.allowed
    : nestedResult && typeof nestedResult.allowed === 'boolean'
      ? nestedResult.allowed
      : null
  if (allowed === null) return null

  const executedRules = Array.isArray(value.executedRules)
    ? value.executedRules
    : nestedResult && Array.isArray(nestedResult.executedRules)
      ? nestedResult.executedRules
      : null
  if (executedRules && executedRules.length === 0) return null

  const errors = Array.isArray(value.errors)
    ? value.errors
    : nestedResult && Array.isArray(nestedResult.errors)
      ? nestedResult.errors
      : []

  return businessRulesDecision(allowed ? 'auto_approve' : 'manual_review', risk, {
    allowed,
    executedRuleCount: executedRules?.length ?? null,
    errorCount: errors.length,
  })
}

async function evaluateWithBusinessRules(args: {
  claim: WarrantyClaim
  lines: WarrantyClaimLine[]
  settings: WarrantyClaimEffectiveSettings
  risk: ClaimRiskAssessment
  container: { resolve: <R = unknown>(n: string) => R }
  em: EntityManager
  scope: { tenantId: string; organizationId: string }
}): Promise<WarrantyAdjudicationDecision | null> {
  if (!args.settings.adjudicationUseRules) return null

  const service = tryResolve<BusinessRulesServiceLike>(args.container, 'businessRulesService')
    ?? tryResolve<BusinessRulesServiceLike>(args.container, 'ruleEngine')
  if (!service) return null

  const data = buildBusinessRulesData(args)
  const serviceArgs: BusinessRulesClaimEvaluationArgs = {
    claim: args.claim,
    lines: args.lines,
    settings: args.settings,
    risk: args.risk,
    em: args.em,
    scope: args.scope,
    data,
  }

  if (typeof service.evaluateWarrantyClaim === 'function') {
    return parseBusinessRulesDecision(await service.evaluateWarrantyClaim(serviceArgs), args.risk)
  }

  if (typeof service.evaluate === 'function') {
    return parseBusinessRulesDecision(await service.evaluate(serviceArgs), args.risk)
  }

  if (typeof service.executeRules === 'function') {
    return parseBusinessRulesDecision(await service.executeRules(args.em, {
      entityType: 'warranty_claims:claim',
      entityId: args.claim.id,
      eventType: 'warranty_claims.claim.adjudicate',
      data,
      tenantId: args.scope.tenantId,
      organizationId: args.scope.organizationId,
      dryRun: true,
    }), args.risk)
  }

  return null
}

export function createWarrantyAdjudicationEvaluator(): WarrantyAdjudicationEvaluator {
  return {
    async evaluate(args) {
      if (args.risk.level === 'high') {
        const light = evaluateLightEligibility(args)
        return {
          decision: 'manual_review',
          facts: {
            ...light.facts,
            riskLevel: args.risk.level,
            riskSignalCount: args.risk.signals.length,
            forcedManualByRisk: true,
          },
        }
      }

      let businessRulesDecision: WarrantyAdjudicationDecision | null = null
      try {
        businessRulesDecision = await evaluateWithBusinessRules(args)
      } catch {
        businessRulesDecision = null
      }
      if (businessRulesDecision) return businessRulesDecision

      return lightDecision(args)
    },
  }
}
