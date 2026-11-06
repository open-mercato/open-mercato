import { z } from 'zod'
import {
  TRACE_CAPTURE_LEVELS,
  TRACE_CAPTURE_PER_AGENT_MAX,
  traceCapturePolicySchema,
  type TraceCapturePolicy,
} from '../../data/validators'

/**
 * Pure mapping between the trace capture settings page's editable form and the
 * policy object the settings API reads and writes. Kept free of React so the
 * round-trip and validation rules are unit-testable.
 */

export type TraceCaptureLevel = (typeof TRACE_CAPTURE_LEVELS)[number]

export const INHERIT_EVAL_LEVEL = 'inherit' as const
export type EvalLevelChoice = TraceCaptureLevel | typeof INHERIT_EVAL_LEVEL

export const RETENTION_DAYS_MIN = 1
export const RETENTION_DAYS_MAX = 3650

export type TraceCaptureOverrideRow = {
  key: string
  agentId: string
  level: TraceCaptureLevel
  until: Date | null
}

export type TraceCaptureSettingsForm = {
  level: TraceCaptureLevel
  evalLevel: EvalLevelChoice
  retentionDays: string
  redactPii: boolean
  includeProviderBody: boolean
  overrides: TraceCaptureOverrideRow[]
}

export type OverrideErrorCode = 'agentRequired' | 'agentDuplicate'
export type RetentionErrorCode = 'retentionInvalid'

export type TraceCaptureFormErrors = {
  retentionDays?: RetentionErrorCode
  overrides: Record<string, OverrideErrorCode>
  tooManyOverrides?: boolean
}

export type FormToPolicyResult =
  | { ok: true; policy: TraceCapturePolicy }
  | { ok: false; errors: TraceCaptureFormErrors }

const captureLevelSchema = z.enum(TRACE_CAPTURE_LEVELS)

const settingsResponseSchema = z.object({
  policy: traceCapturePolicySchema,
  source: z.enum(['tenant', 'default']),
  deploymentDefault: captureLevelSchema,
  deploymentCeiling: captureLevelSchema,
  updatedAt: z.string().nullable().optional(),
})

export type TraceCaptureSettingsResponse = {
  policy: TraceCapturePolicy
  source: 'tenant' | 'default'
  deploymentDefault: TraceCaptureLevel
  deploymentCeiling: TraceCaptureLevel
  updatedAt: string | null
}

export function parseTraceCaptureSettingsResponse(value: unknown): TraceCaptureSettingsResponse | null {
  const parsed = settingsResponseSchema.safeParse(value)
  if (!parsed.success) return null
  return { ...parsed.data, updatedAt: parsed.data.updatedAt ?? null }
}

const agentListSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), label: z.string().optional() }).passthrough()),
})

export type AgentOption = { id: string; label: string }

export function parseAgentOptions(value: unknown): AgentOption[] {
  const parsed = agentListSchema.safeParse(value)
  if (!parsed.success) return []
  return parsed.data.items
    .map((item) => ({ id: item.id, label: item.label && item.label.trim() ? item.label : item.id }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function withMissingAgentOptions(options: AgentOption[], agentIds: string[]): AgentOption[] {
  const known = new Set(options.map((option) => option.id))
  const missing = agentIds
    .filter((agentId) => agentId && !known.has(agentId))
    .map((agentId) => ({ id: agentId, label: agentId }))
  return [...options, ...missing]
}

function parseUntil(value: string | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function policyToForm(policy: TraceCapturePolicy): TraceCaptureSettingsForm {
  const overrides = Object.entries(policy.perAgent)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([agentId, override], index) => ({
      key: `override-${index}`,
      agentId,
      level: override.level,
      until: parseUntil(override.until),
    }))
  return {
    level: policy.level,
    evalLevel: policy.evalLevel ?? INHERIT_EVAL_LEVEL,
    retentionDays: String(policy.retentionDays),
    redactPii: policy.redactPii,
    includeProviderBody: policy.includeProviderBody,
    overrides,
  }
}

function parseRetentionDays(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < RETENTION_DAYS_MIN || value > RETENTION_DAYS_MAX) return null
  return value
}

export function validateTraceCaptureForm(form: TraceCaptureSettingsForm): TraceCaptureFormErrors {
  const errors: TraceCaptureFormErrors = { overrides: {} }
  if (parseRetentionDays(form.retentionDays) === null) errors.retentionDays = 'retentionInvalid'
  const seen = new Set<string>()
  for (const row of form.overrides) {
    const agentId = row.agentId.trim()
    if (!agentId) {
      errors.overrides[row.key] = 'agentRequired'
      continue
    }
    if (seen.has(agentId)) errors.overrides[row.key] = 'agentDuplicate'
    seen.add(agentId)
  }
  if (form.overrides.length > TRACE_CAPTURE_PER_AGENT_MAX) errors.tooManyOverrides = true
  return errors
}

export function hasFormErrors(errors: TraceCaptureFormErrors): boolean {
  return (
    errors.retentionDays !== undefined ||
    errors.tooManyOverrides === true ||
    Object.keys(errors.overrides).length > 0
  )
}

export function formToPolicy(form: TraceCaptureSettingsForm): FormToPolicyResult {
  const errors = validateTraceCaptureForm(form)
  const retentionDays = parseRetentionDays(form.retentionDays)
  if (hasFormErrors(errors) || retentionDays === null) return { ok: false, errors }
  const perAgent: TraceCapturePolicy['perAgent'] = {}
  for (const row of form.overrides) {
    perAgent[row.agentId.trim()] = row.until
      ? { level: row.level, until: row.until.toISOString() }
      : { level: row.level }
  }
  const candidate = {
    level: form.level,
    ...(form.evalLevel === INHERIT_EVAL_LEVEL ? {} : { evalLevel: form.evalLevel }),
    perAgent,
    retentionDays,
    redactPii: form.redactPii,
    includeProviderBody: form.includeProviderBody,
  }
  const parsed = traceCapturePolicySchema.safeParse(candidate)
  if (!parsed.success) return { ok: false, errors: { overrides: {}, retentionDays: 'retentionInvalid' } }
  return { ok: true, policy: parsed.data }
}

export function formSignature(form: TraceCaptureSettingsForm): string {
  return JSON.stringify({
    level: form.level,
    evalLevel: form.evalLevel,
    retentionDays: form.retentionDays.trim(),
    redactPii: form.redactPii,
    includeProviderBody: form.includeProviderBody,
    overrides: form.overrides.map((row) => ({
      agentId: row.agentId.trim(),
      level: row.level,
      until: row.until ? row.until.toISOString() : null,
    })),
  })
}

const LEVEL_RANK: Record<TraceCaptureLevel, number> = { off: 0, metadata: 1, full: 2 }

export function exceedsCeiling(level: TraceCaptureLevel, ceiling: TraceCaptureLevel): boolean {
  return LEVEL_RANK[level] > LEVEL_RANK[ceiling]
}

export function formRequestsFullCapture(form: TraceCaptureSettingsForm): boolean {
  return (
    form.level === 'full' ||
    form.evalLevel === 'full' ||
    form.overrides.some((row) => row.level === 'full')
  )
}

export function formExceedsCeiling(form: TraceCaptureSettingsForm, ceiling: TraceCaptureLevel): boolean {
  const levels: TraceCaptureLevel[] = [form.level, ...form.overrides.map((row) => row.level)]
  if (form.evalLevel !== INHERIT_EVAL_LEVEL) levels.push(form.evalLevel)
  return levels.some((level) => exceedsCeiling(level, ceiling))
}

export function isOverrideExpired(row: TraceCaptureOverrideRow, now: Date): boolean {
  return row.until !== null && row.until.getTime() <= now.getTime()
}
