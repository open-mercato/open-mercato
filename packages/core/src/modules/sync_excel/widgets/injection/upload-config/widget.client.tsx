"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { FieldMapping } from '../../../../data_sync/lib/adapter'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { Notice } from '@open-mercato/ui/primitives/Notice'
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
  state?: {
    isEnabled?: boolean
  } | null
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

const ENTITY_TYPE = 'customers.person' as const

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

export default function SyncExcelUploadConfigWidget({
  context,
  data,
}: InjectionWidgetComponentProps<SyncExcelIntegrationContext, SyncExcelIntegrationData>) {
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
  const mutationContextId = `${context.formId ?? 'sync-excel'}:sync-excel-import`
  const lastAppliedSuggestionSignatureRef = React.useRef<string | null>(null)
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

  const syncPreviewState = React.useCallback((nextPreview: UploadResponse) => {
    const nextSuggestedMapping = buildPeopleSuggestedMapping(nextPreview.headers, nextPreview.suggestedMapping, customFieldDefs)
    setPreview(nextPreview)
    setMappingRows(buildMappingRows(nextPreview.headers, nextSuggestedMapping))
    setMatchStrategy(nextSuggestedMapping.matchStrategy)
    setIsMappingDirty(false)
    lastAppliedSuggestionSignatureRef.current = buildSuggestedMappingSignature(nextPreview.headers, nextSuggestedMapping)
  }, [customFieldDefs])

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
      return call.result
    }
    return null
  }, [])

  React.useEffect(() => {
    if (!runId) return

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      const detail = await refreshRunDetail(runId)
      if (cancelled) return
      const status = normalizeStatus(detail?.status)
      if (status === 'pending' || status === 'running') {
        timeoutId = setTimeout(() => {
          void poll()
        }, 5000)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [refreshRunDetail, runId])

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
      syncPreviewState(call.result)
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
      flash(t('sync_excel.widget.messages.importStarted', 'Import run started.'), 'success')
      await refreshRunDetail(call.result.runId)
    } catch {
      flash(t('sync_excel.widget.messages.importError', 'Failed to start import run.'), 'error')
    } finally {
      setIsStartingImport(false)
    }
  }, [context, mappingRows, matchStrategy, preview, refreshRunDetail, runMutation, t, targetOptions])

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
    } catch {
      flash(t('sync_excel.widget.messages.cancelError', 'Failed to cancel import run.'), 'error')
    } finally {
      setIsCancelling(false)
    }
  }, [context, refreshRunDetail, runId, runMutation, t])

  const firstSampleRow = preview?.sampleRows[0] ?? null

  return (
    <div className="space-y-6">
      {!resolvedIntegrationEnabled ? (
        <Notice
          variant="warning"
          title={t('sync_excel.widget.disabled.title', 'Integration disabled')}
          message={t('sync_excel.widget.disabled.message', 'Enable this integration to upload CSV files and start imports.')}
        />
      ) : null}

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
              disabled={isUploading || isRunActive}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void handleUpload()} disabled={!selectedFile || isUploading || isRunActive}>
              {isUploading ? <Spinner className="mr-2 size-4" /> : <Upload className="mr-2 size-4" />}
              {isUploading
                ? t('sync_excel.widget.actions.uploadPending', 'Uploading...')
                : t('sync_excel.widget.actions.upload', 'Upload and preview')}
            </Button>
            {preview ? (
              <Button type="button" variant="outline" onClick={() => void handleRefreshPreview()} disabled={isRefreshingPreview || isUploading || isRunActive}>
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

      {preview ? (
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
                  <Notice
                    variant="warning"
                    title={t('sync_excel.widget.matchStrategy.customWarningTitle', 'Use custom matching with care')}
                    message={t(
                      'sync_excel.widget.matchStrategy.customWarningMessage',
                      'Custom matching may create duplicates if the mapped fields do not uniquely identify a person.',
                    )}
                  />
                ) : null}

                {diagnostics.duplicateTargets.length > 0 ? (
                  <Notice
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
                  <Notice
                    variant="warning"
                    title={t('sync_excel.widget.validation.identityTitle', 'Map an identity field')}
                    message={t('sync_excel.widget.validation.identityMessage', 'Map either External ID or Primary email so reimports can match existing people.')}
                  />
                ) : null}

                {!diagnostics.hasNameTarget ? (
                  <Notice
                    variant="warning"
                    title={t('sync_excel.widget.validation.nameTitle', 'Map a name field')}
                    message={t('sync_excel.widget.validation.nameMessage', 'Map Last name or Display name so the importer can build person records.')}
                  />
                ) : null}

                {diagnostics.hasIdentityTarget && diagnostics.hasNameTarget && diagnostics.duplicateTargets.length === 0 ? (
                  <Notice
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

      {runId ? (
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
              <Notice
                variant="error"
                title={t('sync_excel.widget.run.errorTitle', 'Run error')}
                message={runDetail.lastError}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void refreshRunDetail(runId)} disabled={isRunActive && isRefreshingPreview}>
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
