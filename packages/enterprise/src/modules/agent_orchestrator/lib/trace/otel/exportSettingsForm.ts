import { z } from 'zod'
import {
  OTEL_EXPORT_AGENT_ALLOWLIST_MAX,
  OTEL_EXPORT_CONTENT_MODES,
  otelExportSettingsSchema,
  type OtelExportDestinationKind,
  type OtelExportSettings,
} from '../../../data/validators'
import { OTEL_EXPORT_DESTINATION_ERRORS, OTEL_EXPORT_INTEGRATION_ID } from './exportIntegrationIds'

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
  destination: OtelExportDestinationKind
}

const deploymentSchema = z.object({
  enabled: z.boolean(),
  switchOn: z.boolean(),
  endpointConfigured: z.boolean(),
  protocol: z.string(),
  protocolSupported: z.boolean(),
  contentAllowed: z.boolean(),
  tenantEndpointsAllowed: z.boolean().default(false),
  traceLinkConfigured: z.boolean(),
})

const healthSchema = z.object({
  lastSuccessAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
})

const integrationSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
})

const settingsResponseSchema = z.object({
  settings: otelExportSettingsSchema,
  source: z.enum(['tenant', 'instance', 'default']),
  updatedAt: z.string().nullable().optional(),
  deployment: deploymentSchema,
  health: healthSchema,
  integration: integrationSchema.default({ configured: false, enabled: false }),
})

export type OtelExportDeploymentView = z.infer<typeof deploymentSchema>
export type OtelExportHealthView = z.infer<typeof healthSchema>
export type OtelExportIntegrationView = z.infer<typeof integrationSchema>

export const OTEL_EXPORT_INTEGRATION_HREF = `/backend/integrations/${OTEL_EXPORT_INTEGRATION_ID}`

export type OtelExportSettingsResponse = {
  settings: OtelExportSettings
  source: 'tenant' | 'instance' | 'default'
  updatedAt: string | null
  deployment: OtelExportDeploymentView
  health: OtelExportHealthView
  integration: OtelExportIntegrationView
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
    destination: settings.destination,
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
    destination: form.destination,
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
    destination: form.destination,
  })
}

export type OtelExportContentAccess = {
  canManage: boolean
  canViewContent: boolean
  contentAllowed: boolean
}

/**
 * Content export needs the deployment to allow it and the editor to hold both
 * agent management and trace content access; the server enforces the same.
 */
export function canEditContentMode(access: OtelExportContentAccess): boolean {
  return access.canManage && access.canViewContent && access.contentAllowed
}

export type OtelExportDestinationAccess = {
  canManage: boolean
  tenantEndpointsAllowed: boolean
  destination: OtelExportDestinationKind
}

/**
 * The destination can be picked only by an agent manager while the deployment
 * allows tenant endpoints. A stored `integration` destination stays editable
 * after the deployment denies them so the tenant can move back to the
 * deployment endpoint; the server refuses to save `integration` meanwhile.
 */
export function canEditDestination(access: OtelExportDestinationAccess): boolean {
  if (!access.canManage) return false
  return access.tenantEndpointsAllowed || access.destination === 'integration'
}

export type OtelExportDestinationErrorCode =
  (typeof OTEL_EXPORT_DESTINATION_ERRORS)[keyof typeof OTEL_EXPORT_DESTINATION_ERRORS]

const DESTINATION_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(OTEL_EXPORT_DESTINATION_ERRORS))

export function isOtelExportDestinationErrorCode(code: string | null): code is OtelExportDestinationErrorCode {
  return code !== null && DESTINATION_ERROR_CODES.has(code)
}

export type OtelExportSaveErrorKind =
  | 'contentForbidden'
  | 'contentNotAllowed'
  | 'tenantEndpointsNotAllowed'
  | 'generic'

function readErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null
  const status = (error as { status: unknown }).status
  return typeof status === 'number' ? status : null
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('error' in error)) return null
  const code = (error as { error: unknown }).error
  return typeof code === 'string' ? code : null
}

export const OTEL_EXPORT_TENANT_ENDPOINTS_NOT_ALLOWED = 'tenant_endpoints_not_allowed'

export function classifyOtelExportSaveError(
  error: unknown,
  content: OtelExportContentMode,
): OtelExportSaveErrorKind {
  const status = readErrorStatus(error)
  if (status === 422 && readErrorCode(error) === OTEL_EXPORT_TENANT_ENDPOINTS_NOT_ALLOWED) {
    return 'tenantEndpointsNotAllowed'
  }
  if (content !== 'full') return 'generic'
  if (status === 403) return 'contentForbidden'
  if (status === 422) return 'contentNotAllowed'
  return 'generic'
}
