import { z } from 'zod'
import {
  OTEL_EXPORT_AGENT_ALLOWLIST_MAX,
  OTEL_EXPORT_CONTENT_MODES,
  otelExportSettingsSchema,
  type OtelExportSettings,
} from '../../../data/validators'

/**
 * Pure mapping between the OTel export settings page's editable form and the
 * settings object the API reads and writes, plus parsers for the settings and
 * test-span responses. Kept free of React so the rules are unit-testable.
 */

export type OtelExportContentMode = (typeof OTEL_EXPORT_CONTENT_MODES)[number]

export type OtelExportSettingsForm = {
  enabled: boolean
  exportUserIds: boolean
  content: OtelExportContentMode
  agentAllowlist: string[]
}

const deploymentSchema = z.object({
  enabled: z.boolean(),
  switchOn: z.boolean(),
  endpointConfigured: z.boolean(),
  protocol: z.string(),
  protocolSupported: z.boolean(),
  contentAllowed: z.boolean(),
  traceLinkConfigured: z.boolean(),
})

const healthSchema = z.object({
  lastSuccessAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
})

const settingsResponseSchema = z.object({
  settings: otelExportSettingsSchema,
  source: z.enum(['tenant', 'default']),
  updatedAt: z.string().nullable().optional(),
  deployment: deploymentSchema,
  health: healthSchema,
})

export type OtelExportDeploymentView = z.infer<typeof deploymentSchema>
export type OtelExportHealthView = z.infer<typeof healthSchema>

export type OtelExportSettingsResponse = {
  settings: OtelExportSettings
  source: 'tenant' | 'default'
  updatedAt: string | null
  deployment: OtelExportDeploymentView
  health: OtelExportHealthView
}

export function parseOtelExportSettingsResponse(value: unknown): OtelExportSettingsResponse | null {
  const parsed = settingsResponseSchema.safeParse(value)
  if (!parsed.success) return null
  return { ...parsed.data, updatedAt: parsed.data.updatedAt ?? null }
}

const testResponseSchema = z.object({
  ok: z.boolean(),
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number(),
  errorCode: z.string().nullable(),
})

export type OtelExportTestResult = z.infer<typeof testResponseSchema>

export function parseOtelExportTestResponse(value: unknown): OtelExportTestResult | null {
  const parsed = testResponseSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function settingsToForm(settings: OtelExportSettings): OtelExportSettingsForm {
  return {
    enabled: settings.enabled,
    exportUserIds: settings.exportUserIds,
    content: settings.content,
    agentAllowlist: [...(settings.agentAllowlist ?? [])].sort((left, right) => left.localeCompare(right)),
  }
}

function normalizeAllowlist(agentIds: string[]): string[] {
  return Array.from(new Set(agentIds.map((agentId) => agentId.trim()).filter((agentId) => agentId !== ''))).sort(
    (left, right) => left.localeCompare(right),
  )
}

export type FormToSettingsResult = { ok: true; settings: OtelExportSettings } | { ok: false }

/** An empty allowlist means every agent, so it is sent as an absent allowlist. */
export function formToSettings(form: OtelExportSettingsForm): FormToSettingsResult {
  const allowlist = normalizeAllowlist(form.agentAllowlist)
  const candidate = {
    enabled: form.enabled,
    content: form.content,
    exportUserIds: form.exportUserIds,
    ...(allowlist.length > 0 ? { agentAllowlist: allowlist } : {}),
  }
  const parsed = otelExportSettingsSchema.safeParse(candidate)
  return parsed.success ? { ok: true, settings: parsed.data } : { ok: false }
}

export function canAddAllowlistAgent(form: OtelExportSettingsForm): boolean {
  return form.agentAllowlist.length < OTEL_EXPORT_AGENT_ALLOWLIST_MAX
}

export function addAllowlistAgent(form: OtelExportSettingsForm, agentId: string): OtelExportSettingsForm {
  const trimmed = agentId.trim()
  if (!trimmed || form.agentAllowlist.includes(trimmed) || !canAddAllowlistAgent(form)) return form
  return { ...form, agentAllowlist: normalizeAllowlist([...form.agentAllowlist, trimmed]) }
}

export function removeAllowlistAgent(form: OtelExportSettingsForm, agentId: string): OtelExportSettingsForm {
  return { ...form, agentAllowlist: form.agentAllowlist.filter((entry) => entry !== agentId) }
}

export function formSignature(form: OtelExportSettingsForm): string {
  return JSON.stringify({
    enabled: form.enabled,
    exportUserIds: form.exportUserIds,
    content: form.content,
    agentAllowlist: normalizeAllowlist(form.agentAllowlist),
  })
}
