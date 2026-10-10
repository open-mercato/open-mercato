"use client"

import * as React from 'react'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import {
  WORKFLOW_COMMANDS_API_PATH,
  WORKFLOW_DEFINITIONS_API_PATH,
  XRAY_API_BASE,
  buildQueryString,
  isAbortError,
  readXrayError,
  xraySuggestionApiPath,
  type XrayRequestError,
  type XrayRequestResult,
} from './api'
import { readCreatedDefinitionId } from './draft'
import type { XraySettingsResponse, XraySettingsUpdate, XraySuggestion, XraySuggestionResponse } from './types'

/**
 * Calls an X-Ray read endpoint through `apiCall` (never raw fetch). Aborted requests reject with
 * the `AbortError` so callers can drop them.
 */
export async function xrayRequest<TBody>(url: string, init?: RequestInit): Promise<XrayRequestResult<TBody>> {
  const call = await apiCall<TBody>(url, init)
  if (call.ok && call.result !== null && call.result !== undefined) return { ok: true, body: call.result }
  return { ok: false, error: readXrayError(call.status || null, call.result) }
}

export type XrayResourceState<TBody> = {
  data: TBody | null
  error: XrayRequestError | null
  loading: boolean
  reload: () => void
}

export type XrayResourceOptions = {
  /** Keep showing the previous URL's data while the next one loads (page-level summaries only). */
  keepPreviousData?: boolean
}

type ResourceSnapshot<TBody> = { url: string | null; data: TBody | null; error: XrayRequestError | null }

/**
 * Loads one X-Ray read endpoint: `null` url loads nothing; a new url (or `reload`) aborts the
 * request in flight, so a stale response never replaces a newer one. By default the data and
 * error of a previous url are never returned for a new one (a tab never shows rows under the
 * wrong grouping, filters or mode while it reloads).
 */
export function useXrayResource<TBody>(url: string | null, options: XrayResourceOptions = {}): XrayResourceState<TBody> {
  const [snapshot, setSnapshot] = React.useState<ResourceSnapshot<TBody>>({ url: null, data: null, error: null })
  const [pendingUrl, setPendingUrl] = React.useState<string | null>(url)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    if (!url) {
      setSnapshot({ url: null, data: null, error: null })
      setPendingUrl(null)
      return
    }
    const controller = new AbortController()
    setPendingUrl(url)
    xrayRequest<TBody>(url, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setSnapshot(result.ok ? { url, data: result.body, error: null } : { url, data: null, error: result.error })
        setPendingUrl(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setSnapshot({ url, data: null, error: { httpStatus: null, code: null, hint: null, message: null } })
        setPendingUrl(null)
      })
    return () => controller.abort()
  }, [url, version])

  const current = snapshot.url === url
  const loading = url !== null && (pendingUrl !== null || !current)
  const data = current || options.keepPreviousData ? snapshot.data : null
  const error = current ? snapshot.error : null
  const reload = React.useCallback(() => setVersion((value) => value + 1), [])
  return { data, error, loading, reload }
}

export const XRAY_UI_FEATURES = [
  'insights.xray.manage',
  'insights.xray.view_individuals',
  'workflows.definitions.create',
  'workflows.definitions.edit',
  'workflows.definitions.view',
] as const

export type XrayPermissions = {
  canManage: boolean
  canViewIndividuals: boolean
  canCreateWorkflows: boolean
  canEditWorkflows: boolean
  canViewWorkflows: boolean
  loading: boolean
}

const NO_PERMISSIONS: XrayPermissions = {
  canManage: false,
  canViewIndividuals: false,
  canCreateWorkflows: false,
  canEditWorkflows: false,
  canViewWorkflows: false,
  loading: true,
}

type FeatureCheckResponse = { ok?: boolean; granted?: unknown }

/**
 * What the viewer may do on the X-Ray pages, from the wildcard-aware feature check of the
 * current organization. UI affordances only: every route enforces its own features.
 */
export function useXrayPermissions(): XrayPermissions {
  const [permissions, setPermissions] = React.useState<XrayPermissions>(NO_PERMISSIONS)
  React.useEffect(() => {
    let cancelled = false
    apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: XRAY_UI_FEATURES }),
    })
      .then((call) => {
        if (cancelled) return
        const granted = Array.isArray(call.result?.granted)
          ? call.result.granted.filter((feature): feature is string => typeof feature === 'string')
          : []
        setPermissions({
          canManage: hasAllFeatures(['insights.xray.manage'], granted),
          canViewIndividuals: hasAllFeatures(['insights.xray.view_individuals'], granted),
          canCreateWorkflows: hasAllFeatures(['workflows.definitions.create'], granted),
          canEditWorkflows: hasAllFeatures(['workflows.definitions.edit'], granted),
          canViewWorkflows: hasAllFeatures(['workflows.definitions.view'], granted),
          loading: false,
        })
      })
      .catch(() => {
        if (!cancelled) setPermissions({ ...NO_PERMISSIONS, loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [])
  return permissions
}

export const XRAY_WORKFLOW_RESOURCE_KIND = 'workflows.definition'
export const XRAY_SUGGESTION_RESOURCE_KIND = 'insights.xray_suggestion'

type XrayMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

const JSON_HEADERS = { 'content-type': 'application/json' }

export type XraySuggestionPatch = { status: 'open' | 'dismissed' } | { status: 'drafted'; draftedArtifactId: string }

/**
 * The writes of the X-Ray pages, each through `useGuardedMutation` (global mutation guards,
 * record locks, conflict UI; `retryLastMutation` is part of the injection context):
 * creating a draft workflow definition AS THE USER through the workflows API (the X-Ray draft
 * endpoints persist nothing), changing a suggestion's status with the optimistic-lock header of
 * the version the user saw, and requesting an on-demand mining pass.
 */
export function useXrayMutations(contextId: string) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<XrayMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const createWorkflowDefinition = React.useCallback(async (payload: Record<string, unknown>): Promise<string | null> => {
    const call = await runMutation({
      operation: () => apiCallOrThrow<unknown>(WORKFLOW_DEFINITIONS_API_PATH, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      }),
      context: { formId: contextId, resourceKind: XRAY_WORKFLOW_RESOURCE_KIND, retryLastMutation },
      mutationPayload: payload,
    })
    return readCreatedDefinitionId(call.result)
  }, [contextId, retryLastMutation, runMutation])

  const updateSuggestion = React.useCallback(async (suggestion: Pick<XraySuggestion, 'id' | 'updatedAt'>, patch: XraySuggestionPatch): Promise<XraySuggestion | null> => {
    const call = await runMutation({
      operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(suggestion.updatedAt), () =>
        apiCallOrThrow<XraySuggestionResponse>(xraySuggestionApiPath(suggestion.id), {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(patch),
        })),
      context: { formId: contextId, resourceKind: XRAY_SUGGESTION_RESOURCE_KIND, resourceId: suggestion.id, retryLastMutation },
      mutationPayload: patch,
    })
    return call.result?.result ?? null
  }, [contextId, retryLastMutation, runMutation])

  const requestMining = React.useCallback(async (): Promise<void> => {
    await runMutation({
      operation: () => apiCallOrThrow(`${XRAY_API_BASE}/suggestions/mine`, { method: 'POST', headers: JSON_HEADERS, body: '{}' }),
      context: { formId: contextId, resourceKind: 'insights.xray_suggestion_mining', retryLastMutation },
      mutationPayload: {},
    })
  }, [contextId, retryLastMutation, runMutation])

  const startBackfill = React.useCallback(async (): Promise<{ progressJobId: string | null }> => {
    const call = await runMutation({
      operation: () => apiCallOrThrow<{ progressJobId?: string | null }>(`${XRAY_API_BASE}/backfill`, { method: 'POST', headers: JSON_HEADERS, body: '{}' }),
      context: { formId: contextId, resourceKind: 'insights.xray_backfill', retryLastMutation },
      mutationPayload: {},
    })
    return { progressJobId: call.result?.progressJobId ?? null }
  }, [contextId, retryLastMutation, runMutation])

  return { createWorkflowDefinition, updateSuggestion, requestMining, startBackfill, retryLastMutation }
}

/** The HTTP status and route `code` carried by an error thrown by `apiCallOrThrow`. */
export function readMutationError(error: unknown): { status: number | null; code: string | null } {
  if (typeof error !== 'object' || error === null) return { status: null, code: null }
  const record = error as Record<string, unknown>
  const status = typeof record.status === 'number' ? record.status : null
  const code = typeof record.code === 'string'
    ? record.code
    : typeof record.body === 'object' && record.body !== null && typeof (record.body as Record<string, unknown>).code === 'string'
      ? (record.body as Record<string, string>).code
      : null
  return { status, code }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WORKFLOW_OPTIONS_LIMIT = 50

export type XrayOption = { value: string; label: string }

type WorkflowDefinitionItem = { id?: unknown; workflowId?: unknown; workflowName?: unknown; version?: unknown }

function workflowDefinitionOption(item: WorkflowDefinitionItem): XrayOption | null {
  if (typeof item.id !== 'string' || !UUID_PATTERN.test(item.id)) return null
  const name = typeof item.workflowName === 'string' && item.workflowName ? item.workflowName : String(item.workflowId ?? item.id)
  const version = typeof item.version === 'number' ? ` v${item.version}` : ''
  const workflowId = typeof item.workflowId === 'string' ? ` (${item.workflowId}${version})` : ''
  return { value: item.id, label: `${name}${workflowId}` }
}

/** Stored workflow definitions of the organization for the conformance picker (code-only definitions have no id to compare with). */
export async function loadWorkflowDefinitionOptions(query?: string): Promise<XrayOption[]> {
  const call = await apiCall<{ data?: WorkflowDefinitionItem[] }>(`${WORKFLOW_DEFINITIONS_API_PATH}${buildQueryString({ search: query, limit: WORKFLOW_OPTIONS_LIMIT })}`)
  if (!call.ok || !Array.isArray(call.result?.data)) return []
  return call.result.data.map(workflowDefinitionOption).filter((option): option is XrayOption => option !== null)
}

export async function resolveWorkflowDefinitionLabel(id: string): Promise<string> {
  const call = await apiCall<{ data?: WorkflowDefinitionItem }>(`${WORKFLOW_DEFINITIONS_API_PATH}/${encodeURIComponent(id)}`)
  const option = call.ok && call.result?.data ? workflowDefinitionOption(call.result.data) : null
  return option?.label ?? id
}

export type XrayWorkflowCommandOption = { commandId: string; labelKey: string | null; enabled: boolean | null }

/** The workflow-safe UPDATE_ENTITY commands (needs `workflows.definitions.edit`; none without access). */
export async function loadWorkflowCommandOptions(signal?: AbortSignal): Promise<XrayWorkflowCommandOption[]> {
  try {
    const call = await apiCall<{ items?: unknown }>(WORKFLOW_COMMANDS_API_PATH, signal ? { signal } : undefined)
    const items = call.ok && Array.isArray(call.result?.items) ? call.result.items : []
    const options: XrayWorkflowCommandOption[] = []
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const record = item as Record<string, unknown>
      if (typeof record.commandId !== 'string' || record.commandId.length === 0) continue
      options.push({
        commandId: record.commandId,
        labelKey: typeof record.labelKey === 'string' ? record.labelKey : null,
        enabled: typeof record.enabled === 'boolean' ? record.enabled : null,
      })
    }
    return options
  } catch {
    return []
  }
}

/**
 * Saves the organization's settings (`PUT /api/insights/xray/settings`). Called from the settings
 * `CrudForm` submit, which supplies the optimistic-lock header of the loaded version.
 */
export async function saveXraySettings(body: XraySettingsUpdate, errorMessage: string): Promise<XraySettingsResponse | null> {
  const call = await apiCallOrThrow<XraySettingsResponse>(`${XRAY_API_BASE}/settings`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  }, { errorMessage })
  return call.result
}
