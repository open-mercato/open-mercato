"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { FieldMapping } from '../../../../data_sync/lib/adapter'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { AlertTriangle, CheckCircle2, Play, RefreshCw, Upload, XCircle } from 'lucide-react'
import {
  buildPeopleSuggestedMapping,
  buildPeopleTargetOptions,
  buildSuggestedMappingSignature,
  findMappingTargetOption,
  SYNC_EXCEL_PEOPLE_CUSTOM_FIELD_ENTITY_IDS,
  type MappingTargetOption,
  type SuggestedMapping,
} from './target-options'

type SyncExcelIntegrationContext = {
  formId?: string
  integrationDetailWidgetSpotId?: string
  integrationId?: string
  activeTab?: string
  state?: {
    isEnabled?: boolean
  } | null
  refreshDetail?: () => Promise<void>
  refreshLogs?: () => Promise<void>
  refreshHealthSnapshot?: () => Promise<void>
}

type SyncExcelIntegrationData = {
  state?: {
    isEnabled?: boolean
  } | null
}

type PreviewRow = Record<string, string | null>

type UploadResponse = {
  uploadId: string
  filename: string
  mimeType: string
  fileSize: number
  entityType: 'customers.person'
  headers: string[]
  sampleRows: PreviewRow[]
  totalRows: number
  suggestedMapping: SuggestedMapping
}

type ImportResponse = {
  runId: string
  progressJobId: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

type SyncRunDetail = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  lastError: string | null
  progressJobId: string | null
  progressJob: {
    id: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    progressPercent: number
    processedCount: number
    totalCount: number | null
    etaSeconds: number | null
  } | null
}

type MappingRowState = {
  sourceColumn: string
  targetField: string
}

type MappingDiagnostics = {
  duplicateTargets: string[]
  hasNameTarget: boolean
  hasIdentityTarget: boolean
  mappedCount: number
  unmappedCount: number
}

type PersistedSessionSnapshot = {
  uploadId: string
  filename: string
  preview: UploadResponse | null
  mappingRows: MappingRowState[]
  matchStrategy: SuggestedMapping['matchStrategy']
  runId: string | null
  progressJobId: string | null
}

const ENTITY_TYPE = 'customers.person' as const
const SESSION_STORAGE_PREFIX = 'om:sync_excel:session'
const RUN_POLL_INTERVAL_MS = 4_000

const SELECT_CLASS_NAME = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function buildMappingRows(headers: string[], suggestedMapping: SuggestedMapping): MappingRowState[] {
  const mappedFields = new Map(suggestedMapping.fields.map((field) => [field.externalField, field.localField]))
  return headers.map((header) => ({
    sourceColumn: header,
    targetField: mappedFields.get(header) ?? '',
  }))
}

function buildFieldMapping(sourceColumn: string, targetField: string, targetOptions: MappingTargetOption[]): FieldMapping {
  const matchedOption = findMappingTargetOption(targetOptions, targetField)
  const mappingKind = matchedOption?.mappingKind ?? (targetField.startsWith('cf:') ? 'custom_field' : 'core')
  const dedupeRole = matchedOption?.dedupeRole

  return {
    externalField: sourceColumn,
    localField: targetField,
    mappingKind,
    ...(dedupeRole ? { dedupeRole } : {}),
  }
}

function inferMatchStrategy(rows: MappingRowState[]): SuggestedMapping['matchStrategy'] {
  if (rows.some((row) => row.targetField === 'person.externalId')) return 'externalId'
  if (rows.some((row) => row.targetField === 'person.primaryEmail')) return 'email'
  return 'custom'
}

function buildMapping(
  rows: MappingRowState[],
  matchStrategy: SuggestedMapping['matchStrategy'],
  targetOptions: MappingTargetOption[],
): SuggestedMapping {
  const mappedRows = rows.filter((row) => row.targetField.trim().length > 0)
  const fields = mappedRows.map((row) => buildFieldMapping(row.sourceColumn, row.targetField, targetOptions))
  const resolvedMatchStrategy = matchStrategy === 'custom' ? inferMatchStrategy(rows) : matchStrategy
  const matchField = resolvedMatchStrategy === 'externalId'
    ? 'person.externalId'
    : resolvedMatchStrategy === 'email'
      ? 'person.primaryEmail'
      : undefined

  return {
    entityType: ENTITY_TYPE,
    matchStrategy: resolvedMatchStrategy,
    ...(matchField ? { matchField } : {}),
    fields,
    unmappedColumns: rows.filter((row) => row.targetField.trim().length === 0).map((row) => row.sourceColumn),
  }
}

function buildDiagnostics(rows: MappingRowState[]): MappingDiagnostics {
  const duplicateTargets = Array.from(
    rows
      .filter((row) => row.targetField.trim().length > 0)
      .reduce((accumulator, row) => {
        const nextCount = (accumulator.get(row.targetField) ?? 0) + 1
        accumulator.set(row.targetField, nextCount)
        return accumulator
      }, new Map<string, number>())
      .entries(),
  )
    .filter(([, count]) => count > 1)
    .map(([target]) => target)

  const hasNameTarget = rows.some((row) => row.targetField === 'person.lastName' || row.targetField === 'person.displayName')
  const hasIdentityTarget = rows.some((row) => row.targetField === 'person.externalId' || row.targetField === 'person.primaryEmail')
  const mappedCount = rows.filter((row) => row.targetField.trim().length > 0).length

  return {
    duplicateTargets,
    hasNameTarget,
    hasIdentityTarget,
    mappedCount,
    unmappedCount: rows.length - mappedCount,
  }
}

function formatTargetLabel(
  targetField: string,
  t: ReturnType<typeof useT>,
  targetOptions: MappingTargetOption[],
): string {
  const option = findMappingTargetOption(targetOptions, targetField)
  if (!option) return targetField
  return option.labelKey ? t(option.labelKey, option.fallback) : option.fallback
}

function getMatchStrategyLabel(
  matchStrategy: SuggestedMapping['matchStrategy'],
  t: ReturnType<typeof useT>,
): string {
  if (matchStrategy === 'externalId') {
    return t('sync_excel.widget.matchStrategy.externalId', 'Source record ID (Recommended)')
  }
  if (matchStrategy === 'email') {
    return t('sync_excel.widget.matchStrategy.email', 'Email address')
  }
  return t('sync_excel.widget.matchStrategy.custom', 'Custom matching')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readApiErrorMessage(result: Record<string, unknown> | null | undefined, fallback: string): string {
  const value = result?.error
  if (typeof value === 'string' && value.trim().length > 0) return value
  return fallback
}

function normalizeStatus(status: SyncRunDetail['status'] | ImportResponse['status'] | null | undefined): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'idle' {
  if (status === 'pending' || status === 'running' || status === 'completed' || status === 'failed' || status === 'cancelled') {
    return status
  }
  return 'idle'
}

function getSessionStorageKey(integrationId: string | undefined): string {
  return `${SESSION_STORAGE_PREFIX}:${integrationId ?? 'sync_excel'}`
}

function readPersistedSessionSnapshot(integrationId: string | undefined): PersistedSessionSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(getSessionStorageKey(integrationId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedSessionSnapshot> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.uploadId !== 'string' || parsed.uploadId.trim().length === 0) return null
    if (typeof parsed.filename !== 'string') return null
    if (!Array.isArray(parsed.mappingRows)) return null
    if (parsed.matchStrategy !== 'externalId' && parsed.matchStrategy !== 'email' && parsed.matchStrategy !== 'custom') {
      return null
    }
    const preview = (
      parsed.preview
      && typeof parsed.preview === 'object'
      && typeof parsed.preview.uploadId === 'string'
      && parsed.preview.uploadId.trim().length > 0
      && typeof parsed.preview.filename === 'string'
      && Array.isArray(parsed.preview.headers)
      && Array.isArray(parsed.preview.sampleRows)
      && typeof parsed.preview.totalRows === 'number'
      && typeof parsed.preview.fileSize === 'number'
      && parsed.preview.entityType === ENTITY_TYPE
      && parsed.preview.suggestedMapping
    )
      ? parsed.preview as UploadResponse
      : null

    return {
      uploadId: parsed.uploadId,
      filename: parsed.filename,
      preview,
      mappingRows: parsed.mappingRows
        .filter((row): row is MappingRowState => (
          Boolean(row)
          && typeof row.sourceColumn === 'string'
          && typeof row.targetField === 'string'
        )),
      matchStrategy: parsed.matchStrategy,
      runId: typeof parsed.runId === 'string' && parsed.runId.trim().length > 0 ? parsed.runId : null,
      progressJobId: typeof parsed.progressJobId === 'string' && parsed.progressJobId.trim().length > 0 ? parsed.progressJobId : null,
    }
  } catch {
    return null
  }
}

function writePersistedSessionSnapshot(
  integrationId: string | undefined,
  snapshot: PersistedSessionSnapshot | null,
): void {
  if (typeof window === 'undefined') return
  try {
    const key = getSessionStorageKey(integrationId)
    if (!snapshot) {
      window.sessionStorage.removeItem(key)
      return
    }
    window.sessionStorage.setItem(key, JSON.stringify(snapshot))
  } catch {}
}

export default function SyncExcelUploadConfigWidget({
  context,
  data,
}: InjectionWidgetComponentProps<SyncExcelIntegrationContext, SyncExcelIntegrationData>) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const { data: customFieldDefs = [] } = useCustomFieldDefs([...SYNC_EXCEL_PEOPLE_CUSTOM_FIELD_ENTITY_IDS])
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<UploadResponse | null>(null)
  const [mappingRows, setMappingRows] = React.useState<MappingRowState[]>([])
  const [matchStrategy, setMatchStrategy] = React.useState<SuggestedMapping['matchStrategy']>('custom')
  const [isMappingDirty, setIsMappingDirty] = React.useState(false)
  const [runDetail, setRunDetail] = React.useState<SyncRunDetail | null>(null)
  const [runId, setRunId] = React.useState<string | null>(null)
  const [progressJobId, setProgressJobId] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isRefreshingPreview, setIsRefreshingPreview] = React.useState(false)
  const [isStartingImport, setIsStartingImport] = React.useState(false)
  const [isCancelling, setIsCancelling] = React.useState(false)
  const [isRestoringSession, setIsRestoringSession] = React.useState(true)
  const mutationContextId = `${context.formId ?? 'sync-excel'}:sync-excel-import`
  const lastAppliedSuggestionSignatureRef = React.useRef<string | null>(null)
  const restoringSnapshotRef = React.useRef<PersistedSessionSnapshot | null>(null)
  const lastRestoreRequestKeyRef = React.useRef<string | null>(null)
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: mutationContextId,
    spotId: context.integrationDetailWidgetSpotId,
  })

  const targetOptions = React.useMemo(
    () => buildPeopleTargetOptions(customFieldDefs),
    [customFieldDefs],
  )
  const previewSuggestion = React.useMemo(
    () => preview ? buildPeopleSuggestedMapping(preview.headers, preview.suggestedMapping, customFieldDefs) : null,
    [customFieldDefs, preview],
  )
  const resolvedIntegrationEnabled = data?.state?.isEnabled ?? context.state?.isEnabled ?? true
  const diagnostics = React.useMemo(() => buildDiagnostics(mappingRows), [mappingRows])
  const canStartImport = Boolean(preview)
    && diagnostics.duplicateTargets.length === 0
    && diagnostics.hasNameTarget
    && diagnostics.hasIdentityTarget
    && mappingRows.some((row) => row.targetField.trim().length > 0)
  const importStatus = normalizeStatus(runDetail?.status ?? (runId ? 'pending' : null))
  const progressValue = runDetail?.progressJob?.progressPercent ?? 0
  const isRunActive = importStatus === 'pending' || importStatus === 'running'
  const searchParamsKey = searchParams?.toString() ?? ''
  const uploadIdFromUrl = searchParams?.get('uploadId') ?? null
  const runIdFromUrl = searchParams?.get('runId') ?? null
  const shouldHideInteractiveContent = isRestoringSession && Boolean(uploadIdFromUrl)
  const hasExistingRunForCurrentUpload = Boolean(preview?.uploadId && runId)
  const hasSafeDedupeStrategy = matchStrategy === 'externalId' || matchStrategy === 'email'

  const replaceQueryParams = React.useCallback((updates: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams(searchParamsKey)
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
    }
    const query = params.toString()
    if (query === searchParamsKey) return
    router.replace(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router, searchParamsKey])

  const clearPersistedSession = React.useCallback(() => {
    writePersistedSessionSnapshot(context.integrationId, null)
    replaceQueryParams({ uploadId: null, runId: null })
  }, [context.integrationId, replaceQueryParams])

  const persistCurrentSession = React.useCallback((next?: Partial<PersistedSessionSnapshot>) => {
    const persistedPreview = next?.preview ?? preview ?? null
    const uploadId = next?.uploadId ?? persistedPreview?.uploadId ?? null
    const filename = next?.filename ?? persistedPreview?.filename ?? null
    if (!uploadId || !filename) {
      writePersistedSessionSnapshot(context.integrationId, null)
      return
    }

    writePersistedSessionSnapshot(context.integrationId, {
      uploadId,
      filename,
      preview: persistedPreview,
      mappingRows: next?.mappingRows ?? mappingRows,
      matchStrategy: next?.matchStrategy ?? matchStrategy,
      runId: next?.runId ?? runId,
      progressJobId: next?.progressJobId ?? progressJobId,
    })
  }, [context.integrationId, mappingRows, matchStrategy, preview, progressJobId, runId])

  const syncPreviewState = React.useCallback((nextPreview: UploadResponse, options?: {
    preserveManualState?: boolean
    restoredSnapshot?: PersistedSessionSnapshot | null
  }) => {
    const nextSuggestedMapping = buildPeopleSuggestedMapping(nextPreview.headers, nextPreview.suggestedMapping, customFieldDefs)
    setPreview(nextPreview)

    const restoredSnapshot = options?.restoredSnapshot
    const shouldRestoreSnapshot = Boolean(
      restoredSnapshot
      && restoredSnapshot.uploadId === nextPreview.uploadId
      && restoredSnapshot.mappingRows.length > 0,
    )

    if (shouldRestoreSnapshot) {
      setMappingRows(restoredSnapshot!.mappingRows)
      setMatchStrategy(restoredSnapshot!.matchStrategy)
      setRunId(restoredSnapshot!.runId)
      setProgressJobId(restoredSnapshot!.progressJobId)
      setIsMappingDirty(true)
      lastAppliedSuggestionSignatureRef.current = null
      persistCurrentSession({
        uploadId: nextPreview.uploadId,
        filename: nextPreview.filename,
        preview: nextPreview,
        mappingRows: restoredSnapshot!.mappingRows,
        matchStrategy: restoredSnapshot!.matchStrategy,
        runId: restoredSnapshot!.runId,
        progressJobId: restoredSnapshot!.progressJobId,
      })
      replaceQueryParams({
        uploadId: nextPreview.uploadId,
        runId: restoredSnapshot!.runId,
      })
      return
    }

    if (options?.preserveManualState && preview?.uploadId === nextPreview.uploadId) {
      persistCurrentSession({
        uploadId: nextPreview.uploadId,
        filename: nextPreview.filename,
        preview: nextPreview,
      })
      replaceQueryParams({ uploadId: nextPreview.uploadId })
      return
    }

    const nextRows = buildMappingRows(nextPreview.headers, nextSuggestedMapping)
    setMappingRows(nextRows)
    setMatchStrategy(nextSuggestedMapping.matchStrategy)
    setIsMappingDirty(false)
    lastAppliedSuggestionSignatureRef.current = buildSuggestedMappingSignature(nextPreview.headers, nextSuggestedMapping)
    persistCurrentSession({
      uploadId: nextPreview.uploadId,
      filename: nextPreview.filename,
      preview: nextPreview,
      mappingRows: nextRows,
      matchStrategy: nextSuggestedMapping.matchStrategy,
      runId: null,
      progressJobId: null,
    })
    replaceQueryParams({
      uploadId: nextPreview.uploadId,
      runId: null,
    })
  }, [customFieldDefs, persistCurrentSession, preview?.uploadId, replaceQueryParams])

  React.useEffect(() => {
    if (!preview || !previewSuggestion) return
    if (isMappingDirty) return
    const nextSignature = buildSuggestedMappingSignature(preview.headers, previewSuggestion)
    if (lastAppliedSuggestionSignatureRef.current === nextSignature) return
    setMappingRows(buildMappingRows(preview.headers, previewSuggestion))
    setMatchStrategy(previewSuggestion.matchStrategy)
    lastAppliedSuggestionSignatureRef.current = nextSignature
  }, [isMappingDirty, preview, previewSuggestion])

  const refreshRunDetail = React.useCallback(async (currentRunId: string) => {
    const call = await apiCall<SyncRunDetail>(`/api/data_sync/runs/${encodeURIComponent(currentRunId)}`, undefined, { fallback: null })
    if (call.ok && call.result) {
      setRunDetail(call.result)
      setProgressJobId(call.result.progressJobId ?? null)
      persistCurrentSession({
        runId: currentRunId,
        progressJobId: call.result.progressJobId ?? null,
      })
      return call.result
    }
    return null
  }, [persistCurrentSession])

  React.useEffect(() => {
    if (!preview?.uploadId) return
    persistCurrentSession()
  }, [mappingRows, matchStrategy, persistCurrentSession, preview?.uploadId, progressJobId, runId])

  React.useEffect(() => {
    const persistedSnapshot = readPersistedSessionSnapshot(context.integrationId)
    const resolvedUploadId = uploadIdFromUrl ?? persistedSnapshot?.uploadId ?? null
    const resolvedRunId = runIdFromUrl ?? persistedSnapshot?.runId ?? null

    if (!resolvedUploadId) {
      restoringSnapshotRef.current = null
      lastRestoreRequestKeyRef.current = null
      setIsRestoringSession(false)
      return
    }

    if (!uploadIdFromUrl && persistedSnapshot?.uploadId === resolvedUploadId) {
      replaceQueryParams({
        uploadId: resolvedUploadId,
        runId: resolvedRunId,
      })
    }

    if (preview?.uploadId === resolvedUploadId && mappingRows.length > 0) {
      if (resolvedRunId && runId !== resolvedRunId) {
        setRunId(resolvedRunId)
      }
      setIsRestoringSession(false)
      return
    }

    const restoreRequestKey = `${resolvedUploadId}:${resolvedRunId ?? ''}`
    if (lastRestoreRequestKeyRef.current === restoreRequestKey) {
      setIsRestoringSession(false)
      return
    }

    lastRestoreRequestKeyRef.current = restoreRequestKey

    let cancelled = false
    restoringSnapshotRef.current = persistedSnapshot
    const persistedPreview = restoringSnapshotRef.current?.preview?.uploadId === resolvedUploadId
      ? restoringSnapshotRef.current.preview
      : null

    if (persistedPreview) {
      syncPreviewState(persistedPreview, {
        restoredSnapshot: restoringSnapshotRef.current,
      })
      setIsRestoringSession(false)
    } else {
      setIsRestoringSession(true)
    }

    const restoreSession = async () => {
      const call = await apiCall<UploadResponse>(
        `/api/sync_excel/preview?uploadId=${encodeURIComponent(resolvedUploadId)}&entityType=${encodeURIComponent(ENTITY_TYPE)}`,
        undefined,
        { fallback: null },
      )

      if (cancelled) return

      if (!call.ok || !call.result) {
        setPreview(null)
        setMappingRows([])
        setMatchStrategy('custom')
        setRunId(null)
        setRunDetail(null)
        setProgressJobId(null)
        clearPersistedSession()
        lastRestoreRequestKeyRef.current = null
        setIsRestoringSession(false)
        return
      }

      syncPreviewState(call.result, {
        restoredSnapshot: restoringSnapshotRef.current,
      })

      if (resolvedRunId && !(restoringSnapshotRef.current?.runId)) {
        setRunId(resolvedRunId)
      }

      setIsRestoringSession(false)
    }

    void restoreSession()

    return () => {
      cancelled = true
    }
  }, [clearPersistedSession, context.integrationId, mappingRows.length, preview?.uploadId, replaceQueryParams, runId, runIdFromUrl, syncPreviewState, uploadIdFromUrl])

  React.useEffect(() => {
    if (!runId) return

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      const detail = await refreshRunDetail(runId)
      if (cancelled) return
      if (context.activeTab === 'logs') {
        await context.refreshLogs?.()
      }
      if (context.activeTab === 'health' || normalizeStatus(detail?.status) !== 'idle') {
        await context.refreshHealthSnapshot?.()
      }
      const status = normalizeStatus(detail?.status)
      if (status === 'pending' || status === 'running') {
        timeoutId = setTimeout(() => {
          void poll()
        }, RUN_POLL_INTERVAL_MS)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [context.activeTab, context.refreshHealthSnapshot, context.refreshLogs, refreshRunDetail, runId])

  const handleUpload = React.useCallback(async () => {
    if (!selectedFile) {
      flash(t('sync_excel.widget.messages.fileRequired', 'Select a CSV file first.'), 'error')
      return
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.set('file', selectedFile)
      formData.set('entityType', ENTITY_TYPE)

      const call = await runMutation({
        operation: () => apiCall<UploadResponse>('/api/sync_excel/upload', {
          method: 'POST',
          body: formData,
        }, { fallback: null }),
        mutationPayload: {
          integrationId: context.integrationId ?? 'sync_excel',
          entityType: ENTITY_TYPE,
          fileName: selectedFile.name,
        },
        context: {
          ...context,
          operation: 'create',
          actionId: 'sync-excel-upload',
        },
      })

      if (!call.ok || !call.result) {
        flash(
          readApiErrorMessage(call.result as Record<string, unknown> | null, t('sync_excel.widget.messages.uploadError', 'Failed to upload CSV file.')),
          'error',
        )
        return
      }

      syncPreviewState(call.result)
      setSelectedFile(null)
      setRunId(null)
      setRunDetail(null)
      setProgressJobId(null)
      flash(t('sync_excel.widget.messages.uploadSuccess', 'CSV preview is ready.'), 'success')
    } catch {
      flash(t('sync_excel.widget.messages.uploadError', 'Failed to upload CSV file.'), 'error')
    } finally {
      setIsUploading(false)
    }
  }, [context, runMutation, selectedFile, syncPreviewState, t])

  const handleRefreshPreview = React.useCallback(async () => {
    if (!preview) return
    setIsRefreshingPreview(true)
    try {
      const call = await apiCall<UploadResponse>(
        `/api/sync_excel/preview?uploadId=${encodeURIComponent(preview.uploadId)}&entityType=${encodeURIComponent(ENTITY_TYPE)}`,
        undefined,
        { fallback: null },
      )
      if (!call.ok || !call.result) {
        flash(t('sync_excel.widget.messages.previewError', 'Failed to refresh preview.'), 'error')
        return
      }
      syncPreviewState(call.result, { preserveManualState: true })
      flash(t('sync_excel.widget.messages.previewRefreshed', 'Preview refreshed.'), 'success')
    } catch {
      flash(t('sync_excel.widget.messages.previewError', 'Failed to refresh preview.'), 'error')
    } finally {
      setIsRefreshingPreview(false)
    }
  }, [preview, syncPreviewState, t])

  const handleTargetFieldChange = React.useCallback((sourceColumn: string, targetField: string) => {
    setIsMappingDirty(true)
    setMappingRows((current) => current.map((row) => row.sourceColumn === sourceColumn ? { ...row, targetField } : row))
  }, [])

  const handleResetToSuggested = React.useCallback(() => {
    if (!preview || !previewSuggestion) return
    setMappingRows(buildMappingRows(preview.headers, previewSuggestion))
    setMatchStrategy(previewSuggestion.matchStrategy)
    setIsMappingDirty(false)
    lastAppliedSuggestionSignatureRef.current = buildSuggestedMappingSignature(preview.headers, previewSuggestion)
    flash(t('sync_excel.widget.messages.mappingReset', 'Suggested mapping restored.'), 'success')
  }, [preview, previewSuggestion, t])

  const handleStartImport = React.useCallback(async () => {
    if (!preview) return

    const mapping = buildMapping(mappingRows, matchStrategy, targetOptions)
    setIsStartingImport(true)

    try {
      const call = await runMutation({
        operation: () => apiCall<ImportResponse>('/api/sync_excel/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId: preview.uploadId,
            entityType: ENTITY_TYPE,
            mapping,
          }),
        }, { fallback: null }),
        mutationPayload: {
          integrationId: context.integrationId ?? 'sync_excel',
          uploadId: preview.uploadId,
          entityType: ENTITY_TYPE,
          mapping,
        },
        context: {
          ...context,
          operation: 'create',
          actionId: 'sync-excel-start-import',
        },
      })

      if (!call.ok || !call.result) {
        flash(
          readApiErrorMessage(call.result as Record<string, unknown> | null, t('sync_excel.widget.messages.importError', 'Failed to start import run.')),
          'error',
        )
        return
      }

      setRunId(call.result.runId)
      setProgressJobId(call.result.progressJobId)
      replaceQueryParams({
        uploadId: preview.uploadId,
        runId: call.result.runId,
      })
      persistCurrentSession({
        uploadId: preview.uploadId,
        filename: preview.filename,
        runId: call.result.runId,
        progressJobId: call.result.progressJobId,
      })
      flash(t('sync_excel.widget.messages.importStarted', 'Import run started.'), 'success')
      await refreshRunDetail(call.result.runId)
      await context.refreshLogs?.()
      await context.refreshHealthSnapshot?.()
    } catch {
      flash(t('sync_excel.widget.messages.importError', 'Failed to start import run.'), 'error')
    } finally {
      setIsStartingImport(false)
    }
  }, [context, mappingRows, matchStrategy, persistCurrentSession, preview, refreshRunDetail, replaceQueryParams, runMutation, t, targetOptions])

  const handleCancelRun = React.useCallback(async () => {
    if (!runId) return

    setIsCancelling(true)
    try {
      const call = await runMutation({
        operation: () => apiCall<{ ok?: boolean }>(`/api/data_sync/runs/${encodeURIComponent(runId)}/cancel`, {
          method: 'POST',
        }, { fallback: null }),
        mutationPayload: {
          integrationId: context.integrationId ?? 'sync_excel',
          runId,
        },
        context: {
          ...context,
          operation: 'update',
          actionId: 'sync-excel-cancel-import',
        },
      })

      if (!call.ok) {
        flash(t('sync_excel.widget.messages.cancelError', 'Failed to cancel import run.'), 'error')
        return
      }

      flash(t('sync_excel.widget.messages.cancelSuccess', 'Import run cancelled.'), 'success')
      await refreshRunDetail(runId)
      await context.refreshLogs?.()
      await context.refreshHealthSnapshot?.()
    } catch {
      flash(t('sync_excel.widget.messages.cancelError', 'Failed to cancel import run.'), 'error')
    } finally {
      setIsCancelling(false)
    }
  }, [context, refreshRunDetail, runId, runMutation, t])

  const handleRefreshAll = React.useCallback(async () => {
    if (!runId) return
    await refreshRunDetail(runId)
    await context.refreshLogs?.()
    await context.refreshHealthSnapshot?.()
  }, [context, refreshRunDetail, runId])

  const firstSampleRow = preview?.sampleRows[0] ?? null

  return (
    <div className="space-y-6">
      {isRestoringSession ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Spinner className="size-4" />
            <div className="text-sm text-muted-foreground">
              {t('sync_excel.widget.messages.restoringSession', 'Restoring the last CSV session...')}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!resolvedIntegrationEnabled ? (
        <StatusAlert
          variant="warning"
          title={t('sync_excel.widget.disabled.title', 'Integration disabled')}
          message={t('sync_excel.widget.disabled.message', 'Enable this integration to upload CSV files and start imports.')}
        />
      ) : null}

      {!shouldHideInteractiveContent ? (
      <Card>
        <CardHeader>
          <CardTitle>{t('sync_excel.widget.upload.title', 'Upload CSV')}</CardTitle>
          <CardDescription>
            {t('sync_excel.widget.upload.description', 'Upload a CSV file, review the suggested people mapping, and start a background import run.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sync-excel-upload-file">{t('sync_excel.widget.upload.fileLabel', 'CSV file')}</Label>
            <Input
              id="sync-excel-upload-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              disabled={isUploading || isRunActive || isRestoringSession}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void handleUpload()} disabled={!selectedFile || isUploading || isRunActive || isRestoringSession}>
              {isUploading ? <Spinner className="mr-2 size-4" /> : <Upload className="mr-2 size-4" />}
              {isUploading
                ? t('sync_excel.widget.actions.uploadPending', 'Uploading...')
                : t('sync_excel.widget.actions.upload', 'Upload and preview')}
            </Button>
            {preview ? (
              <Button type="button" variant="outline" onClick={() => void handleRefreshPreview()} disabled={isRefreshingPreview || isUploading || isRunActive || isRestoringSession}>
                {isRefreshingPreview ? <Spinner className="mr-2 size-4" /> : <RefreshCw className="mr-2 size-4" />}
                {isRefreshingPreview
                  ? t('sync_excel.widget.actions.refreshPending', 'Refreshing...')
                  : t('sync_excel.widget.actions.refresh', 'Refresh preview')}
              </Button>
            ) : null}
          </div>

          {selectedFile ? (
            <div className="text-sm text-muted-foreground">
              {t('sync_excel.widget.upload.selectedFile', 'Selected file')}: <span className="font-medium text-foreground">{selectedFile.name}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      {preview && !shouldHideInteractiveContent ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{t('sync_excel.widget.preview.title', 'Preview and mapping')}</CardTitle>
                <CardDescription>
                  {t('sync_excel.widget.preview.description', 'Every source column stays visible here. Leave a target empty to keep the column unmapped for now.')}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{preview.filename}</Badge>
                <Badge variant="outline">{t('sync_excel.widget.preview.rows', '{count} rows', { count: preview.totalRows })}</Badge>
                <Badge variant="outline">{formatFileSize(preview.fileSize)}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label={t('sync_excel.widget.metrics.mapped', 'Mapped columns')}
                value={String(diagnostics.mappedCount)}
              />
              <MetricCard
                label={t('sync_excel.widget.metrics.unmapped', 'Unmapped columns')}
                value={String(diagnostics.unmappedCount)}
              />
              <MetricCard
                label={t('sync_excel.widget.metrics.identity', 'Identity strategy')}
                value={getMatchStrategyLabel(matchStrategy, t)}
              />
              <MetricCard
                label={t('sync_excel.widget.metrics.entity', 'Target entity')}
                value={ENTITY_TYPE}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('sync_excel.widget.mapping.sourceColumn', 'Source column')}</TableHead>
                      <TableHead>{t('sync_excel.widget.mapping.sampleValue', 'Sample value')}</TableHead>
                      <TableHead>{t('sync_excel.widget.mapping.targetField', 'Target field')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappingRows.map((row) => (
                      <TableRow key={row.sourceColumn}>
                        <TableCell className="font-medium">{row.sourceColumn}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-muted-foreground">
                          {firstSampleRow?.[row.sourceColumn] ?? '—'}
                        </TableCell>
                        <TableCell>
                          <select
                            className={SELECT_CLASS_NAME}
                            value={row.targetField}
                            onChange={(event) => handleTargetFieldChange(row.sourceColumn, event.target.value)}
                            disabled={isStartingImport || isRunActive}
                          >
                            <option value="">{t('sync_excel.mapping.targets.ignore', 'Leave unmapped')}</option>
                            {targetOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.labelKey ? t(option.labelKey, option.fallback) : option.fallback}
                              </option>
                            ))}
                          </select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sync-excel-match-strategy">
                    {t('sync_excel.widget.matchStrategy.label', 'How to match existing people')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      'sync_excel.widget.matchStrategy.help',
                      'This decides whether imported rows update existing people or create new ones.',
                    )}
                  </p>
                  <select
                    id="sync-excel-match-strategy"
                    className={SELECT_CLASS_NAME}
                    value={matchStrategy}
                    onChange={(event) => {
                      setIsMappingDirty(true)
                      setMatchStrategy(event.target.value as SuggestedMapping['matchStrategy'])
                    }}
                    disabled={isStartingImport || isRunActive}
                  >
                    <option value="externalId">
                      {t('sync_excel.widget.matchStrategy.externalId', 'Source record ID (Recommended)')}
                    </option>
                    <option value="email">{t('sync_excel.widget.matchStrategy.email', 'Email address')}</option>
                    <option value="custom">{t('sync_excel.widget.matchStrategy.custom', 'Custom matching')}</option>
                  </select>
                  <p className="text-sm text-muted-foreground">
                    {matchStrategy === 'externalId'
                      ? t(
                          'sync_excel.widget.matchStrategy.externalIdDescription',
                          'Best for repeated imports from the same source. Future imports update the same people instead of creating duplicates.',
                        )
                      : matchStrategy === 'email'
                        ? t(
                            'sync_excel.widget.matchStrategy.emailDescription',
                            'Matches people by email. Works best when each person has one reliable, unique email address.',
                          )
                        : t(
                            'sync_excel.widget.matchStrategy.customDescription',
                            'Advanced option. Use only if you know how existing records should be identified in this import.',
                          )}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handleResetToSuggested} disabled={isStartingImport || isRunActive}>
                    <RefreshCw className="mr-2 size-4" />
                    {t('sync_excel.widget.actions.reset', 'Reset to suggestion')}
                  </Button>
                  <Button type="button" onClick={() => void handleStartImport()} disabled={!canStartImport || isStartingImport || isRunActive}>
                    {isStartingImport ? <Spinner className="mr-2 size-4" /> : <Play className="mr-2 size-4" />}
                    {isStartingImport
                      ? t('sync_excel.widget.actions.startPending', 'Starting...')
                      : t('sync_excel.widget.actions.start', 'Start import')}
                  </Button>
                </div>

                {matchStrategy === 'custom' ? (
                  <StatusAlert
                    variant="warning"
                    title={t('sync_excel.widget.matchStrategy.customWarningTitle', 'Use custom matching with care')}
                    message={t(
                      'sync_excel.widget.matchStrategy.customWarningMessage',
                      'Custom matching may create duplicates if the mapped fields do not uniquely identify a person.',
                    )}
                  />
                ) : null}

                {hasExistingRunForCurrentUpload ? (
                  <StatusAlert
                    variant="warning"
                    title={t('sync_excel.widget.validation.reimportTitle', 'This upload already has a run')}
                    message={t(
                      'sync_excel.widget.validation.reimportMessage',
                      'Starting another import from the same uploaded CSV may create duplicates unless your matching strategy reliably identifies existing people.',
                    )}
                  />
                ) : null}

                {!hasSafeDedupeStrategy ? (
                  <StatusAlert
                    variant="warning"
                    title={t('sync_excel.widget.validation.duplicateRiskTitle', 'Duplicate risk')}
                    message={t(
                      'sync_excel.widget.validation.duplicateRiskMessage',
                      'This mapping does not use the recommended External ID or Email matching strategy. Re-importing the same dataset may create duplicate people.',
                    )}
                  />
                ) : null}

                {diagnostics.duplicateTargets.length > 0 ? (
                  <StatusAlert
                    variant="error"
                    title={t('sync_excel.widget.validation.duplicateTargetsTitle', 'Duplicate target fields')}
                    message={t(
                      'sync_excel.widget.validation.duplicateTargetsMessage',
                      'Each target field can only be mapped once in this foundation slice: {targets}',
                      { targets: diagnostics.duplicateTargets.map((target) => formatTargetLabel(target, t, targetOptions)).join(', ') },
                    )}
                  />
                ) : null}

                {!diagnostics.hasIdentityTarget ? (
                  <StatusAlert
                    variant="warning"
                    title={t('sync_excel.widget.validation.identityTitle', 'Map an identity field')}
                    message={t('sync_excel.widget.validation.identityMessage', 'Map either External ID or Primary email so reimports can match existing people.')}
                  />
                ) : null}

                {!diagnostics.hasNameTarget ? (
                  <StatusAlert
                    variant="warning"
                    title={t('sync_excel.widget.validation.nameTitle', 'Map a name field')}
                    message={t('sync_excel.widget.validation.nameMessage', 'Map Last name or Display name so the importer can build person records.')}
                  />
                ) : null}

                {diagnostics.hasIdentityTarget && diagnostics.hasNameTarget && diagnostics.duplicateTargets.length === 0 ? (
                  <StatusAlert
                    variant="info"
                    title={t('sync_excel.widget.validation.readyTitle', 'Ready to import')}
                    message={t('sync_excel.widget.validation.readyMessage', 'The current mapping is valid for the first customers.person slice.')}
                  />
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {runId && !shouldHideInteractiveContent ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{t('sync_excel.widget.run.title', 'Import run status')}</CardTitle>
                <CardDescription>
                  {t('sync_excel.widget.run.description', 'The import runs in the background through Data Sync and updates this view as progress changes.')}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RunStatusBadge status={importStatus} t={t} />
                {progressJobId ? <Badge variant="outline">{progressJobId}</Badge> : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('sync_excel.widget.run.progressLabel', 'Progress')}</span>
                <span className="font-medium">{progressValue}%</span>
              </div>
              <Progress value={progressValue} className="h-2.5" />
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard label={t('sync_excel.widget.run.metrics.created', 'Created')} value={String(runDetail?.createdCount ?? 0)} />
              <MetricCard label={t('sync_excel.widget.run.metrics.updated', 'Updated')} value={String(runDetail?.updatedCount ?? 0)} />
              <MetricCard label={t('sync_excel.widget.run.metrics.skipped', 'Skipped')} value={String(runDetail?.skippedCount ?? 0)} />
              <MetricCard label={t('sync_excel.widget.run.metrics.failed', 'Failed')} value={String(runDetail?.failedCount ?? 0)} />
              <MetricCard label={t('sync_excel.widget.run.metrics.processed', 'Processed')} value={String(runDetail?.progressJob?.processedCount ?? 0)} />
            </div>

            {runDetail?.lastError ? (
              <StatusAlert
                variant="error"
                title={t('sync_excel.widget.run.errorTitle', 'Run error')}
                message={runDetail.lastError}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void handleRefreshAll()} disabled={isRefreshingPreview || isRestoringSession}>
                <RefreshCw className="mr-2 size-4" />
                {t('sync_excel.widget.actions.refreshRun', 'Refresh run status')}
              </Button>
              {isRunActive ? (
                <Button type="button" variant="destructive" onClick={() => void handleCancelRun()} disabled={isCancelling}>
                  {isCancelling ? <Spinner className="mr-2 size-4" /> : <XCircle className="mr-2 size-4" />}
                  {isCancelling
                    ? t('sync_excel.widget.actions.cancelPending', 'Cancelling...')
                    : t('sync_excel.widget.actions.cancel', 'Cancel run')}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function StatusAlert({
  variant,
  title,
  message,
}: {
  variant: 'warning' | 'error' | 'info'
  title: string
  message: string
}) {
  return (
    <Alert variant={variant === 'error' ? 'destructive' : variant}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold text-foreground">{value}</div>
    </div>
  )
}

function RunStatusBadge({
  status,
  t,
}: {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'idle'
  t: ReturnType<typeof useT>
}) {
  if (status === 'completed') {
    return (
      <Badge variant="outline" className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
        <CheckCircle2 className="size-3.5" />
        {t('sync_excel.widget.run.status.completed', 'Completed')}
      </Badge>
    )
  }

  if (status === 'failed') {
    return (
      <Badge variant="outline" className="gap-1.5 border-red-500/30 bg-red-500/10 text-red-300">
        <AlertTriangle className="size-3.5" />
        {t('sync_excel.widget.run.status.failed', 'Failed')}
      </Badge>
    )
  }

  if (status === 'cancelled') {
    return (
      <Badge variant="outline" className="gap-1.5 border-zinc-500/30 bg-zinc-500/10 text-zinc-300">
        <XCircle className="size-3.5" />
        {t('sync_excel.widget.run.status.cancelled', 'Cancelled')}
      </Badge>
    )
  }

  if (status === 'pending' || status === 'running') {
    return (
      <Badge variant="outline" className="gap-1.5 border-blue-500/30 bg-blue-500/10 text-blue-300">
        <RefreshCw className={cn('size-3.5', status === 'running' ? 'animate-spin' : '')} />
        {status === 'pending'
          ? t('sync_excel.widget.run.status.pending', 'Pending')
          : t('sync_excel.widget.run.status.running', 'Running')}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="gap-1.5 border-zinc-500/30 bg-zinc-500/10 text-zinc-300">
      {t('sync_excel.widget.run.status.idle', 'Idle')}
    </Badge>
  )
}
