"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowRightLeft, CheckCircle2, Clock3 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectTriggerLeading,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { TimelinePanel } from './TimelinePanel'
import { ParticipantsPanel } from './ParticipantsPanel'
import { EscalationPanel } from './EscalationPanel'
import { ImpactPanel } from './ImpactPanel'

type IncidentSeverityKey = 'critical' | 'high' | 'medium' | 'low'
type IncidentStatus = 'open' | 'investigating' | 'identified' | 'mitigated' | 'resolved' | 'closed'

const severityVariant: StatusMap<IncidentSeverityKey> = {
  critical: 'error',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

const statusVariant: Record<IncidentStatus, StatusBadgeVariant> = {
  open: 'error',
  investigating: 'warning',
  identified: 'warning',
  mitigated: 'info',
  resolved: 'success',
  closed: 'neutral',
}

const allowedTransitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ['investigating', 'identified', 'mitigated', 'resolved'],
  investigating: ['identified'],
  identified: ['investigating', 'mitigated'],
  mitigated: ['identified', 'resolved'],
  resolved: ['closed', 'open'],
  closed: ['open'],
}

const featureCheckList = [
  'incidents.incident.manage',
  'incidents.incident.close',
] as const

const snoozeOptions = [
  { value: '1', hours: 1 },
  { value: '4', hours: 4 },
  { value: '24', hours: 24 },
] as const

type IncidentDetailRecord = {
  id: string
  number?: string | null
  title?: string | null
  description?: string | null
  status?: string | null
  severity_id?: string | null
  incident_type_id?: string | null
  priority?: string | null
  owner_user_id?: string | null
  owning_team_id?: string | null
  customer_impact_summary?: string | null
  revenue_at_risk_minor?: string | null
  revenue_at_risk_currency?: string | null
  acknowledged_at?: string | null
  escalation_level?: number | null
  escalation_policy_id?: string | null
  escalation_status?: string | null
  escalation_repeats_done?: number | null
  escalation_last_targets?: {
    targets?: Array<{ type: string; id: string; label?: string }>
    recipients?: Array<{ userId: string; label?: string }>
    resolvedAt?: string
  } | null
  next_escalation_at?: string | null
  snoozed_until?: string | null
  created_at?: string | null
  updated_at?: string | null
  customValues?: Record<string, unknown> | null
}

type CatalogItem = {
  id: string
  key?: string | null
  label?: string | null
  required_fields_on_resolve?: string[] | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type IncidentInjectionContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  data: IncidentDetailRecord | null
  retryLastMutation: () => Promise<boolean>
}

type IncidentActionResponse = {
  ok?: boolean
  incidentId?: string | null
  updatedAt?: string | null
}

type FeatureCheckResponse = {
  granted?: unknown[]
}

type IncidentActionKey = 'acknowledge' | 'transition' | 'escalate' | 'snooze'

type ResolveDialogState = {
  status: IncidentStatus
  fields: string[]
  values: Record<string, string>
  errors: Record<string, string>
}

const emptyCatalogResponse = (): PagedResponse<CatalogItem> => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 100,
  totalPages: 0,
})

function isIncidentSeverityKey(value: string): value is IncidentSeverityKey {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
}

function isIncidentStatus(value: string | null | undefined): value is IncidentStatus {
  return value === 'open' ||
    value === 'investigating' ||
    value === 'identified' ||
    value === 'mitigated' ||
    value === 'resolved' ||
    value === 'closed'
}

function nextStatusesFor(status: string | null | undefined, canClose: boolean): IncidentStatus[] {
  if (!isIncidentStatus(status)) return []
  return allowedTransitions[status].filter((candidate) => candidate !== 'closed' || canClose)
}

function isResolveLikeStatus(status: IncidentStatus): boolean {
  return status === 'resolved' || status === 'closed'
}

function normalizeResolveFields(fields: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const field of fields ?? []) {
    const trimmed = field.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

function buildResolveDialogState(
  status: IncidentStatus,
  fields: readonly string[],
  errors: Record<string, string> = {},
): ResolveDialogState {
  const merged = normalizeResolveFields([...fields, ...Object.keys(errors)])
  const values = merged.reduce<Record<string, string>>((acc, field) => {
    acc[field] = ''
    return acc
  }, {})
  return { status, fields: merged, values, errors }
}

function normalizeSeverityKey(item: CatalogItem | null | undefined): IncidentSeverityKey | null {
  const key = (item?.key ?? '').toLowerCase()
  if (isIncidentSeverityKey(key)) return key
  if (key === 'sev1') return 'critical'
  if (key === 'sev2') return 'high'
  if (key === 'sev3') return 'medium'
  if (key === 'sev4') return 'low'
  const label = (item?.label ?? '').toLowerCase()
  if (label.includes('critical')) return 'critical'
  if (label.includes('high')) return 'high'
  if (label.includes('medium')) return 'medium'
  if (label.includes('low')) return 'low'
  return null
}

function statusLabel(t: ReturnType<typeof useT>, status: string | null | undefined): string {
  if (status === 'open') return t('incidents.incident.status.open')
  if (status === 'investigating') return t('incidents.incident.status.investigating')
  if (status === 'identified') return t('incidents.incident.status.identified')
  if (status === 'mitigated') return t('incidents.incident.status.mitigated')
  if (status === 'resolved') return t('incidents.incident.status.resolved')
  if (status === 'closed') return t('incidents.incident.status.closed')
  return status ?? t('incidents.incident.status.unknown')
}

function statusBadgeVariant(status: string | null | undefined): StatusBadgeVariant {
  return isIncidentStatus(status) ? statusVariant[status] : 'neutral'
}

function resolveFieldLabel(t: ReturnType<typeof useT>, field: string): string {
  if (field === 'root_cause' || field === 'rootCause') return t('incidents.incident.detail.resolveDialog.fields.rootCause')
  if (field === 'summary') return t('incidents.incident.detail.resolveDialog.fields.summary')
  if (field === 'impact') return t('incidents.incident.detail.resolveDialog.fields.impact')
  if (field === 'contributing_factors' || field === 'contributingFactors') {
    return t('incidents.incident.detail.resolveDialog.fields.contributingFactors')
  }
  if (field === 'lessons') return t('incidents.incident.detail.resolveDialog.fields.lessons')
  return field
}

function fieldErrorLabel(t: ReturnType<typeof useT>, value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'required') return t('incidents.incident.detail.resolveDialog.errors.required')
  return value
}

function severityLabel(t: ReturnType<typeof useT>, key: IncidentSeverityKey | null, item: CatalogItem | null | undefined): string {
  if (item?.label) return item.label
  if (key === 'critical') return t('incidents.incident.severity.critical')
  if (key === 'high') return t('incidents.incident.severity.high')
  if (key === 'medium') return t('incidents.incident.severity.medium')
  if (key === 'low') return t('incidents.incident.severity.low')
  return t('incidents.incident.severity.unknown')
}

function priorityLabel(t: ReturnType<typeof useT>, priority: string | null | undefined): string {
  if (priority === 'low') return t('incidents.incident.priority.low')
  if (priority === 'medium') return t('incidents.incident.priority.medium')
  if (priority === 'high') return t('incidents.incident.priority.high')
  if (priority === 'critical') return t('incidents.incident.priority.critical')
  return priority ?? t('incidents.common.notSet')
}

function formatRelativeAge(value: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!value) return t('incidents.common.notSet')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('incidents.common.notSet')
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return t('incidents.incident.detail.age.justNow')
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return t('incidents.incident.detail.age.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('incidents.incident.detail.age.hours', { count: hours })
  const days = Math.floor(hours / 24)
  return t('incidents.incident.detail.age.days', { count: days })
}

function formatDate(value: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!value) return t('incidents.common.notSet')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('incidents.common.notSet')
  return date.toLocaleString()
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function formatCustomValue(value: unknown, t: ReturnType<typeof useT>): string {
  if (value === null || value === undefined) return t('incidents.common.notSet')
  if (typeof value === 'string') return value.trim() || t('incidents.common.notSet')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((entry) => formatCustomValue(entry, t)).join(', ')
  try {
    return JSON.stringify(value)
  } catch {
    return t('incidents.common.notSet')
  }
}

async function loadCatalog(path: string): Promise<CatalogItem[]> {
  const result = await apiCall<PagedResponse<CatalogItem>>(
    `${path}?page=1&pageSize=100&isActive=true`,
    undefined,
    { fallback: emptyCatalogResponse() },
  )
  if (!result.ok || !result.result) return []
  return result.result.items
}

export default function IncidentDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const [data, setData] = React.useState<IncidentDetailRecord | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [severities, setSeverities] = React.useState<CatalogItem[]>([])
  const [types, setTypes] = React.useState<CatalogItem[]>([])
  const [grantedFeatures, setGrantedFeatures] = React.useState<string[]>([])
  const [pendingAction, setPendingAction] = React.useState<IncidentActionKey | null>(null)
  const [transitionSelectValue, setTransitionSelectValue] = React.useState('')
  const [snoozeSelectValue, setSnoozeSelectValue] = React.useState('')
  const [resolveDialog, setResolveDialog] = React.useState<ResolveDialogState | null>(null)

  const mutationContextId = React.useMemo(() => `incident:${id ?? 'pending'}`, [id])
  const { runMutation, retryLastMutation } = useGuardedMutation<IncidentInjectionContext>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const loadData = React.useCallback(async () => {
    if (!id) {
      setIsNotFound(true)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    setIsNotFound(false)
    try {
      const payload = await readApiResultOrThrow<PagedResponse<IncidentDetailRecord>>(
        `/api/incidents?id=${encodeURIComponent(id)}&page=1&pageSize=1`,
        undefined,
        { errorMessage: t('incidents.incident.detail.error.load') },
      )
      const record = payload.items[0] ?? null
      if (!record) {
        setData(null)
        setIsNotFound(true)
        return
      }
      setData(record)
    } catch (err) {
      if (errorStatus(err) === 404) {
        setData(null)
        setIsNotFound(true)
      } else {
        setError(err instanceof Error ? err.message : t('incidents.incident.detail.error.load'))
      }
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  React.useEffect(() => {
    loadData().catch(() => {
      setError(t('incidents.incident.detail.error.load'))
      setIsLoading(false)
    })
  }, [loadData, t])

  React.useEffect(() => {
    let cancelled = false
    const loadCatalogs = async () => {
      const [nextSeverities, nextTypes] = await Promise.all([
        loadCatalog('/api/incidents/severities'),
        loadCatalog('/api/incidents/types'),
      ])
      if (cancelled) return
      setSeverities(nextSeverities)
      setTypes(nextTypes)
    }
    loadCatalogs().catch(() => {
      if (!cancelled) {
        setSeverities([])
        setTypes([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const loadPermissions = async () => {
      const result = await apiCall<FeatureCheckResponse>(
        '/api/auth/feature-check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ features: featureCheckList }),
        },
      )
      if (cancelled) return
      const granted = Array.isArray(result.result?.granted)
        ? result.result.granted.filter((feature): feature is string => typeof feature === 'string' && feature.length > 0)
        : []
      setGrantedFeatures(granted)
    }
    loadPermissions().catch(() => {
      if (!cancelled) setGrantedFeatures([])
    })
    return () => {
      cancelled = true
    }
  }, [])

  useAppEvent('incidents.incident.*', () => {
    void loadData()
  }, [id, loadData])

  useAppEvent('incidents.impact.*', () => {
    void loadData()
  }, [id, loadData])

  const severityById = React.useMemo(() => {
    const map = new Map<string, CatalogItem>()
    severities.forEach((item) => {
      if (item.id) map.set(item.id, item)
    })
    return map
  }, [severities])

  const typeById = React.useMemo(() => {
    const map = new Map<string, CatalogItem>()
    types.forEach((item) => {
      if (item.id) map.set(item.id, item)
    })
    return map
  }, [types])

  const injectionContext = React.useMemo<IncidentInjectionContext>(() => ({
    formId: mutationContextId,
    resourceKind: 'incidents.incident',
    resourceId: data?.id ?? id ?? 'pending',
    data,
    retryLastMutation,
  }), [data, id, mutationContextId, retryLastMutation])

  const canManage = React.useMemo(
    () => hasFeature(grantedFeatures, 'incidents.incident.manage'),
    [grantedFeatures],
  )
  const canClose = React.useMemo(
    () => hasFeature(grantedFeatures, 'incidents.incident.close'),
    [grantedFeatures],
  )
  const requiredResolveFields = React.useMemo(() => {
    const incidentType = data?.incident_type_id ? typeById.get(data.incident_type_id) : null
    return normalizeResolveFields(incidentType?.required_fields_on_resolve)
  }, [data?.incident_type_id, typeById])

  const runIncidentAction = React.useCallback(async (
    action: IncidentActionKey,
    payload: Record<string, unknown>,
    messages: { success: string; error: string },
    onError?: (err: unknown) => boolean,
  ): Promise<boolean> => {
    if (!id || !data) return false
    setPendingAction(action)
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<IncidentActionResponse>(
          `/api/incidents/${encodeURIComponent(id)}/${action}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(data.updated_at),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: messages.error },
        ),
        context: injectionContext,
        mutationPayload: { incidentId: id, action, ...payload },
      })
      const updatedAt = call.result?.updatedAt
      if (typeof updatedAt === 'string' && updatedAt.length > 0) {
        setData((prev) => (prev?.id === id ? { ...prev, updated_at: updatedAt } : prev))
      }
      flash(messages.success, 'success')
      void loadData()
      return true
    } catch (err) {
      if (onError?.(err)) return false
      if (!surfaceRecordConflict(err, t, { onRefresh: () => void loadData() })) {
        flash(messages.error, 'error')
      }
      return false
    } finally {
      setPendingAction(null)
    }
  }, [data, id, injectionContext, loadData, runMutation, t])

  const openResolveDialogFromError = React.useCallback((
    status: IncidentStatus,
    fieldKeys: readonly string[],
    err: unknown,
  ): boolean => {
    const normalized = normalizeCrudServerError(err)
    const fieldErrors = normalized.fieldErrors
    if (!fieldErrors || Object.keys(fieldErrors).length === 0) return false
    setResolveDialog(buildResolveDialogState(status, fieldKeys, fieldErrors))
    return true
  }, [])

  const submitTransition = React.useCallback(async (
    status: IncidentStatus,
    fields?: Record<string, string>,
    fieldKeys: readonly string[] = requiredResolveFields,
  ): Promise<boolean> => {
    const payload: Record<string, unknown> = fields ? { status, fields } : { status }
    return runIncidentAction(
      'transition',
      payload,
      {
        success: t('incidents.incident.detail.actions.transitionSuccess'),
        error: t('incidents.incident.detail.actions.transitionError'),
      },
      (err) => {
        if (!isResolveLikeStatus(status)) return false
        return openResolveDialogFromError(status, fieldKeys, err)
      },
    )
  }, [openResolveDialogFromError, requiredResolveFields, runIncidentAction, t])

  const handleAcknowledge = React.useCallback(() => {
    void runIncidentAction(
      'acknowledge',
      {},
      {
        success: t('incidents.incident.detail.actions.acknowledgeSuccess'),
        error: t('incidents.incident.detail.actions.acknowledgeError'),
      },
    )
  }, [runIncidentAction, t])

  const handleTransitionSelect = React.useCallback((value: string) => {
    setTransitionSelectValue('')
    if (!isIncidentStatus(value)) return
    if (isResolveLikeStatus(value) && requiredResolveFields.length > 0) {
      setResolveDialog(buildResolveDialogState(value, requiredResolveFields))
      return
    }
    void submitTransition(value, undefined, requiredResolveFields)
  }, [requiredResolveFields, submitTransition])

  const handleResolveFieldChange = React.useCallback((field: string, value: string) => {
    setResolveDialog((prev) => {
      if (!prev) return prev
      const nextErrors = { ...prev.errors }
      delete nextErrors[field]
      return {
        ...prev,
        values: { ...prev.values, [field]: value },
        errors: nextErrors,
      }
    })
  }, [])

  const handleResolveDialogSubmit = React.useCallback(async () => {
    if (!resolveDialog) return
    const fields = resolveDialog.fields.reduce<Record<string, string>>((acc, field) => {
      acc[field] = resolveDialog.values[field] ?? ''
      return acc
    }, {})
    const ok = await submitTransition(resolveDialog.status, fields, resolveDialog.fields)
    if (ok) setResolveDialog(null)
  }, [resolveDialog, submitTransition])

  const handleResolveDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleResolveDialogSubmit()
    }
    if (event.key === 'Escape') {
      setResolveDialog(null)
    }
  }, [handleResolveDialogSubmit])

  const handleSnoozeSelect = React.useCallback((value: string) => {
    setSnoozeSelectValue('')
    const option = snoozeOptions.find((candidate) => candidate.value === value)
    if (!option) return
    const until = new Date(Date.now() + option.hours * 60 * 60 * 1000).toISOString()
    void runIncidentAction(
      'snooze',
      { until },
      {
        success: t('incidents.incident.detail.actions.snoozeSuccess'),
        error: t('incidents.incident.detail.actions.snoozeError'),
      },
    )
  }, [runIncidentAction, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('incidents.incident.detail.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('incidents.incident.detail.notFound.title')}
            description={t('incidents.incident.detail.notFound.description')}
            backHref="/backend/incidents"
            backLabel={t('incidents.incident.detail.actions.backToList')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error ?? t('incidents.incident.detail.error.load')}
            action={(
              <Button asChild variant="outline">
                <Link href="/backend/incidents">{t('incidents.incident.detail.actions.backToList')}</Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const severity = data.severity_id ? severityById.get(data.severity_id) : null
  const severityKey = normalizeSeverityKey(severity)
  const incidentType = data.incident_type_id ? typeById.get(data.incident_type_id) : null
  const customEntries = Object.entries(data.customValues ?? {}).filter(([, value]) => value !== null && value !== undefined)
  const title = data.title?.trim() || t('incidents.incident.detail.untitled')
  const number = data.number?.trim() || t('incidents.incident.list.unnumbered')
  const availableTransitions = nextStatusesFor(data.status, canClose)
  const isAcknowledged = Boolean(data.acknowledged_at)

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{number}</p>
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge variant={severityKey ? severityVariant[severityKey] : 'neutral'} dot>
                    {severityLabel(t, severityKey, severity)}
                  </StatusBadge>
                  <StatusBadge variant={statusBadgeVariant(data.status)} dot>
                    {statusLabel(t, data.status)}
                  </StatusBadge>
                </div>
                <dl className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
                  <div>
                    <dt className="font-medium text-foreground">{t('incidents.incident.detail.fields.owner')}</dt>
                    <dd className="truncate">{data.owner_user_id ?? t('incidents.incident.owner.unassigned')}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">{t('incidents.incident.detail.fields.age')}</dt>
                    <dd>{formatRelativeAge(data.created_at, t)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">{t('incidents.incident.detail.fields.updated')}</dt>
                    <dd>{formatDate(data.updated_at, t)}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {!isAcknowledged ? (
                  <Button
                    type="button"
                    onClick={handleAcknowledge}
                    disabled={!canManage || pendingAction !== null}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    {t('incidents.incident.detail.actions.acknowledge')}
                  </Button>
                ) : null}
                <Select
                  value={transitionSelectValue}
                  onValueChange={handleTransitionSelect}
                  disabled={!canManage || pendingAction !== null || availableTransitions.length === 0}
                >
                  <SelectTrigger className="w-auto min-w-44" aria-label={t('incidents.incident.detail.actions.changeStatus')}>
                    <SelectTriggerLeading>
                      <ArrowRightLeft aria-hidden="true" />
                    </SelectTriggerLeading>
                    <SelectValue placeholder={t('incidents.incident.detail.actions.changeStatus')} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTransitions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {statusLabel(t, status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={snoozeSelectValue}
                  onValueChange={handleSnoozeSelect}
                  disabled={!canManage || pendingAction !== null}
                >
                  <SelectTrigger className="w-auto min-w-36" aria-label={t('incidents.incident.detail.actions.snooze')}>
                    <SelectTriggerLeading>
                      <Clock3 aria-hidden="true" />
                    </SelectTriggerLeading>
                    <SelectValue placeholder={t('incidents.incident.detail.actions.snooze')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">{t('incidents.incident.detail.actions.snooze1h')}</SelectItem>
                    <SelectItem value="4">{t('incidents.incident.detail.actions.snooze4h')}</SelectItem>
                    <SelectItem value="24">{t('incidents.incident.detail.actions.snooze24h')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4">
              <InjectionSpot spotId="detail:incidents.incident:header" context={injectionContext} data={data} />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <main className="space-y-6 lg:col-span-2">
              <section className="rounded-lg border border-border bg-card p-4">
                <SectionHeader title={t('incidents.incident.detail.sections.timeline')} />
                <div className="mt-4">
                  <TimelinePanel
                    incidentId={data.id}
                    updatedAt={data.updated_at}
                    canManage={canManage}
                    onChanged={() => void loadData()}
                  />
                </div>
              </section>

              <InjectionSpot spotId="detail:incidents.incident:tabs" context={injectionContext} data={data} />

              <section className="rounded-lg border border-border bg-card p-4">
                <SectionHeader title={t('incidents.incident.detail.sections.description')} />
                <div className="mt-4">
                  {data.description?.trim() ? (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{data.description}</p>
                  ) : (
                    <EmptyState
                      variant="subtle"
                      title={t('incidents.incident.detail.description.empty.title')}
                      description={t('incidents.incident.detail.description.empty.description')}
                    />
                  )}
                </div>
              </section>

              {data.customer_impact_summary?.trim() ? (
                <section className="rounded-lg border border-border bg-card p-4">
                  <SectionHeader title={t('incidents.incident.detail.sections.customerImpact')} />
                  <div className="mt-4">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{data.customer_impact_summary}</p>
                  </div>
                </section>
              ) : null}

              <ImpactPanel
                incidentId={data.id}
                updatedAt={data.updated_at}
                revenueAtRiskMinor={data.revenue_at_risk_minor ?? null}
                revenueAtRiskCurrency={data.revenue_at_risk_currency ?? null}
                canManage={canManage}
                onChanged={() => void loadData()}
              />
            </main>

            <aside className="space-y-6">
              <section className="rounded-lg border border-border bg-card p-4">
                <SectionHeader title={t('incidents.incident.detail.sections.details')} />
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">{t('incidents.incident.detail.fields.severity')}</dt>
                    <dd className="mt-1">
                      <StatusBadge variant={severityKey ? severityVariant[severityKey] : 'neutral'} dot>
                        {severityLabel(t, severityKey, severity)}
                      </StatusBadge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('incidents.incident.detail.fields.priority')}</dt>
                    <dd className="mt-1 text-foreground">{priorityLabel(t, data.priority)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('incidents.incident.detail.fields.type')}</dt>
                    <dd className="mt-1 text-foreground">{incidentType?.label ?? t('incidents.common.notSet')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('incidents.incident.detail.fields.owner')}</dt>
                    <dd className="mt-1 break-all text-foreground">{data.owner_user_id ?? t('incidents.incident.owner.unassigned')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('incidents.incident.detail.fields.team')}</dt>
                    <dd className="mt-1 break-all text-foreground">{data.owning_team_id ?? t('incidents.common.notSet')}</dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <SectionHeader title={t('incidents.incident.detail.sections.participants')} />
                <div className="mt-4">
                  <ParticipantsPanel
                    incidentId={data.id}
                    updatedAt={data.updated_at}
                    canManage={canManage}
                    onChanged={() => void loadData()}
                  />
                </div>
              </section>

              <EscalationPanel
                incidentId={data.id}
                updatedAt={data.updated_at}
                escalationStatus={data.escalation_status ?? null}
                escalationLevel={data.escalation_level ?? null}
                escalationRepeatsDone={data.escalation_repeats_done ?? null}
                nextEscalationAt={data.next_escalation_at ?? null}
                escalationLastTargets={data.escalation_last_targets ?? null}
                canManage={canManage}
                onChanged={() => void loadData()}
              />

              <section className="rounded-lg border border-border bg-card p-4">
                <SectionHeader title={t('incidents.incident.detail.sections.customFields')} />
                <div className="mt-4">
                  {customEntries.length ? (
                    <dl className="space-y-3 text-sm">
                      {customEntries.map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-muted-foreground">{key}</dt>
                          <dd className="mt-1 break-words text-foreground">{formatCustomValue(value, t)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <EmptyState
                      variant="subtle"
                      title={t('incidents.incident.detail.customFields.empty.title')}
                      description={t('incidents.incident.detail.customFields.empty.description')}
                    />
                  )}
                </div>
              </section>

              <InjectionSpot spotId="detail:incidents.incident:sidebar" context={injectionContext} data={data} />
            </aside>
          </div>

          <InjectionSpot spotId="detail:incidents.incident:footer" context={injectionContext} data={data} />
        </div>
        <Dialog open={resolveDialog !== null} onOpenChange={(open) => {
          if (!open) setResolveDialog(null)
        }}>
          <DialogContent className="sm:max-w-lg" onKeyDown={handleResolveDialogKeyDown}>
            <DialogHeader>
              <DialogTitle>{t('incidents.incident.detail.resolveDialog.title')}</DialogTitle>
              <DialogDescription>
                {resolveDialog
                  ? t('incidents.incident.detail.resolveDialog.description', { status: statusLabel(t, resolveDialog.status) })
                  : t('incidents.incident.detail.resolveDialog.descriptionFallback')}
              </DialogDescription>
            </DialogHeader>
            {resolveDialog ? (
              <div className="space-y-4">
                {resolveDialog.fields.map((field) => {
                  const errorLabel = fieldErrorLabel(t, resolveDialog.errors[field])
                  const fieldId = `incident-resolve-${field}`
                  const errorId = `${fieldId}-error`
                  return (
                    <div key={field} className="space-y-2">
                      <Label htmlFor={fieldId}>{resolveFieldLabel(t, field)}</Label>
                      <Textarea
                        id={fieldId}
                        value={resolveDialog.values[field] ?? ''}
                        onChange={(event) => handleResolveFieldChange(field, event.currentTarget.value)}
                        aria-invalid={errorLabel ? true : undefined}
                        aria-describedby={errorLabel ? errorId : undefined}
                        placeholder={t('incidents.incident.detail.resolveDialog.fieldPlaceholder')}
                      />
                      {errorLabel ? (
                        <p id={errorId} className="text-sm text-destructive">
                          {errorLabel}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setResolveDialog(null)}
                disabled={pendingAction === 'transition'}
              >
                {t('incidents.common.cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void handleResolveDialogSubmit()}
                disabled={pendingAction === 'transition'}
              >
                {t('incidents.incident.detail.resolveDialog.submit')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
