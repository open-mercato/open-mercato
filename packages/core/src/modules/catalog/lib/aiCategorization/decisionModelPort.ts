import type { DecisionErrorCode, DecisionRequest, DecisionResult } from '@open-mercato/shared/lib/ai/decision-model'

/**
 * Catalog's own structural view of the `decisionModelService` DI contract
 * from `@open-mercato/ai-assistant` (spec D8: catalog adds no code there or
 * in `shared`, and imports only the port's shared types). `reason` / the
 * error `code` stay open strings — the port's reason/error unions are open,
 * and catalog adds its own `not_installed` reason on top.
 */
export type CatalogDecisionModelAvailability = {
  available: boolean
  provider?: string
  model?: string
  reason?: string
}

export type CatalogDecisionModelDecideError = {
  code: DecisionErrorCode | string
  message: string
  httpStatus?: number
}

export type CatalogDecisionModelDecideResult =
  | { ok: true; result: DecisionResult }
  | { ok: false; error: CatalogDecisionModelDecideError }

export type CatalogDecisionModelDecideInput = {
  request: DecisionRequest
  moduleId?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export type CatalogDecisionModelPort = {
  getAvailability(input?: { moduleId?: string }): CatalogDecisionModelAvailability
  decide(input: CatalogDecisionModelDecideInput): Promise<CatalogDecisionModelDecideResult>
}
