/**
 * One evaluation path for a workflow definition.
 *
 * The Studio's Problems panel and the definition API routes historically ran
 * the same checks through two different normalizers: the panel builds
 * `WorkflowValidationIssue[]` via `collectValidationIssues`, the routes build
 * the structured `{path, code, message, expected?, got?}` body via
 * `normalizeDefinitionValidationIssues`. Neither reimplements the checks — they
 * share `workflowDefinitionDataSchema` — but nothing composed both.
 *
 * This module composes them, and NOTHING ELSE. Every check below is an existing
 * exported function; a second validator that could disagree with the panel is
 * precisely the failure mode to avoid, so callers that need "what would the
 * Studio show me?" MUST come through here rather than re-deriving the recipe.
 */

import { collectActivityConfigWarnings } from '../data/activity-config-warnings'
import { workflowDefinitionDataSchema } from '../data/validators'
import type { WorkflowDefinitionData } from '../data/entities'
import {
  collectValidationIssues,
  countIssuesBySeverity,
  type WorkflowIssueTranslator,
  type WorkflowValidationIssue,
  type ZodIssueLike,
} from './collect-validation-issues'
import type { ContextLedger } from './context-ledger'
import {
  normalizeDefinitionValidationIssues,
  type DefinitionValidationIssue,
} from './definition-error-body'
import { collectUnresolvedContextRefWarnings } from './expression-refs'
import { definitionToGraph, validateWorkflowGraph } from './graph-utils'

/**
 * Problems-panel copy for an unresolved `{{context.*}}` reference. Shared so
 * the Studio and every server-side evaluator emit the identical warning instead
 * of drifting apart on the message text.
 */
export const UNRESOLVED_CONTEXT_REF_MESSAGE = {
  key: 'workflows.visualEditor.problems.unresolvedContextRef',
  fallback: 'Context reference "{path}" is not provided by any earlier step, trigger, or input',
} as const

function interpolateFallback(fallback: string, params: Record<string, string>): string {
  return fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name] : match,
  )
}

/**
 * Map unresolved `{{context.*}}` references onto Problems-panel warnings.
 * `translate` is optional — omit it (server, agent tools) to get the English
 * fallback the panel itself falls back to.
 */
export function toUnresolvedContextRefIssues(
  definition: WorkflowDefinitionData,
  ledger: ContextLedger,
  translate?: WorkflowIssueTranslator,
): ZodIssueLike[] {
  return collectUnresolvedContextRefWarnings(definition, ledger).map((warning) => ({
    path: warning.path,
    message: translate
      ? translate(UNRESOLVED_CONTEXT_REF_MESSAGE.key, UNRESOLVED_CONTEXT_REF_MESSAGE.fallback, {
          path: warning.refPath,
        })
      : interpolateFallback(UNRESOLVED_CONTEXT_REF_MESSAGE.fallback, { path: warning.refPath }),
  }))
}

export interface EvaluateWorkflowDefinitionOptions {
  /**
   * Server-computed context ledger. When supplied, unresolved-reference
   * warnings join the result exactly as they do in the Studio; when omitted
   * those warnings are skipped (they are advisory and never blocking).
   */
  ledger?: ContextLedger | null
}

export interface WorkflowDefinitionEvaluation {
  /** No blocking errors — the same bar the Studio's Save handler enforces. */
  valid: boolean
  errorCount: number
  warningCount: number
  /**
   * The structured issue format: identical in shape and content to the
   * `details[]` array the definition create/update routes return on a 400.
   * Empty when the definition parses.
   */
  issues: DefinitionValidationIssue[]
  /** Exactly what the Studio's Problems panel renders, in its order. */
  problems: WorkflowValidationIssue[]
}

/**
 * Run the Studio Problems-panel evaluation plus the API routes' structured-body
 * normalizer over one definition.
 */
export function evaluateWorkflowDefinition(
  definition: WorkflowDefinitionData,
  options: EvaluateWorkflowDefinitionOptions = {},
): WorkflowDefinitionEvaluation {
  // The Studio only ever evaluates well-formed canvas state, but an agent can
  // hand us anything. A definition whose `steps`/`transitions` are not arrays
  // cannot be turned into a graph at all, so it answers with the schema issues
  // alone rather than throwing out of a validation call.
  const shaped =
    Array.isArray((definition as { steps?: unknown })?.steps) &&
    Array.isArray((definition as { transitions?: unknown })?.transitions)
  if (!shaped) {
    const parsedShape = workflowDefinitionDataSchema.safeParse(definition)
    const structuralIssues = parsedShape.success
      ? []
      : normalizeDefinitionValidationIssues(parsedShape.error)
    return {
      valid: false,
      errorCount: structuralIssues.length,
      warningCount: 0,
      issues: structuralIssues,
      problems: structuralIssues.map((entry, index) => ({
        id: `schema-${index}`,
        severity: 'error' as const,
        message: entry.path.length ? `${entry.path.join('.')} - ${entry.message}` : entry.message,
      })),
    }
  }

  const { nodes, edges } = definitionToGraph(definition, { autoLayout: false })
  const graphErrors = validateWorkflowGraph(nodes, edges)
  const parsed = workflowDefinitionDataSchema.safeParse(definition)
  const zodIssues: ZodIssueLike[] = parsed.success ? [] : parsed.error.issues
  const ledger = options.ledger ?? null
  const configWarnings: ZodIssueLike[] = [
    ...collectActivityConfigWarnings(definition),
    ...(ledger ? toUnresolvedContextRefIssues(definition, ledger) : []),
  ]

  const problems = collectValidationIssues({
    graphErrors,
    zodIssues,
    configWarnings,
    nodes,
    edges,
    definition,
    ledger: ledger ?? undefined,
  })
  const { errors, warnings } = countIssuesBySeverity(problems)

  return {
    valid: errors === 0,
    errorCount: errors,
    warningCount: warnings,
    issues: parsed.success ? [] : normalizeDefinitionValidationIssues(parsed.error),
    problems,
  }
}
