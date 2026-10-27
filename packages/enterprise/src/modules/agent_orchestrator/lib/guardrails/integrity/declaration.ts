import type { ZodTypeAny } from 'zod'
import { integrityRulesSchema, type IntegrityRule } from '../../../data/validators'
import { validatePathAgainstSchema } from './paths'
import { normalizeToolName } from './pipeline'

type PathCheck = { field: string; path: string }

function registrationError(agentId: string, ruleId: string | null, detail: string): Error {
  const ruleLabel = ruleId ? ` rule "${ruleId}"` : ''
  return new Error(`[internal] agent "${agentId}" integrity${ruleLabel}: ${detail}`)
}

function resolveBase(agentId: string, rule: IntegrityRule, schema: ZodTypeAny, field: string, path: string): ZodTypeAny[] {
  const check = validatePathAgainstSchema(schema, path)
  if (!check.ok) {
    throw registrationError(agentId, rule.id, `${field} path "${path}" cannot exist in the result schema (at "${check.segment}")`)
  }
  return check.leaves
}

function requireOnItems(agentId: string, rule: IntegrityRule, itemSchemas: ZodTypeAny[], checks: PathCheck[]): void {
  for (const { field, path } of checks) {
    const resolvable = itemSchemas.some((itemSchema) => validatePathAgainstSchema(itemSchema, path).ok)
    if (!resolvable) {
      throw registrationError(agentId, rule.id, `${field} path "${path}" cannot exist on the item schema`)
    }
  }
}

function validateRulePaths(agentId: string, rule: IntegrityRule, schema: ZodTypeAny): void {
  if (rule.kind === 'evidence_quote') {
    const itemSchemas = resolveBase(agentId, rule, schema, 'items', rule.items)
    const checks: PathCheck[] = [{ field: 'quote', path: rule.quote }]
    if (rule.offsets) {
      checks.push({ field: 'offsets.start', path: rule.offsets.start }, { field: 'offsets.end', path: rule.offsets.end })
    }
    if ('fromItem' in rule.source) checks.push({ field: 'source.fromItem', path: rule.source.fromItem })
    requireOnItems(agentId, rule, itemSchemas, checks)
    return
  }
  if (rule.kind === 'reference_exists') {
    const itemSchemas = resolveBase(agentId, rule, schema, 'ids', rule.ids)
    const checks: PathCheck[] = []
    if (rule.idPath) checks.push({ field: 'idPath', path: rule.idPath })
    if (rule.versionPath) checks.push({ field: 'versionPath', path: rule.versionPath })
    if (rule.version && 'path' in rule.version) checks.push({ field: 'version.path', path: rule.version.path })
    requireOnItems(agentId, rule, itemSchemas, checks)
    return
  }
  if (rule.kind === 'tool_consulted') {
    resolveBase(agentId, rule, schema, 'cites', rule.cites)
  }
}

function validatePrepareStepTools(agentId: string, rule: IntegrityRule, effectiveTools: readonly string[]): void {
  if (rule.kind !== 'tool_consulted' || rule.enforce !== 'prepare_step') return
  const available = new Set(effectiveTools.map(normalizeToolName))
  const reachable = rule.tools.some((tool) => available.has(normalizeToolName(tool)))
  if (!reachable) {
    throw registrationError(
      agentId,
      rule.id,
      `enforce "prepare_step" requires at least one of tools [${rule.tools.join(', ')}] in the agent's effective tools (own, skill and delegate tools)`,
    )
  }
}

export type ParseAgentIntegrityRulesOptions = {
  /**
   * The agent's effective tool allowlist (own + skill + delegate tools). When
   * given, a `tool_consulted` rule enforced at `prepare_step` must name at least
   * one of them — otherwise the run could never satisfy it.
   */
  effectiveTools?: readonly string[]
}

/**
 * Parses an agent's `integrity` declaration and checks every output path against
 * its result schema — `items`/`ids`/`cites` from the result root, item-relative
 * paths (`quote`, `offsets`, `source.fromItem`, `idPath`, `versionPath`,
 * `version.path`) from the addressed item. Run-input and tool-result paths are
 * syntax-checked only: neither has a schema at registration. Fails loud with an
 * `[internal]` error naming the agent and rule; returns undefined for no rules.
 */
export function parseAgentIntegrityRules(
  agentId: string,
  schema: ZodTypeAny,
  declared: unknown,
  options: ParseAgentIntegrityRulesOptions = {},
): IntegrityRule[] | undefined {
  if (declared === undefined || declared === null) return undefined
  const parsed = integrityRulesSchema.safeParse(declared)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const ruleIndex = typeof issue?.path[0] === 'number' ? issue.path[0] : null
    const declaredRules = Array.isArray(declared) ? declared : []
    const candidate: unknown = ruleIndex === null ? null : declaredRules[ruleIndex]
    const ruleId =
      candidate && typeof candidate === 'object' && 'id' in candidate && typeof candidate.id === 'string'
        ? candidate.id
        : null
    const location = issue ? issue.path.join('.') : ''
    throw registrationError(agentId, ruleId, `invalid declaration${location ? ` at "${location}"` : ''}: ${issue?.message ?? 'unknown error'}`)
  }
  for (const rule of parsed.data) {
    validateRulePaths(agentId, rule, schema)
    if (options.effectiveTools) validatePrepareStepTools(agentId, rule, options.effectiveTools)
  }
  return parsed.data.length > 0 ? parsed.data : undefined
}
