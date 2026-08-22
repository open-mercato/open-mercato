"use client"

import * as React from 'react'
import { FileJson, Upload } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CompanySelectField, type CompanySnapshot } from './formConfig'
import { CountrySelectField } from './CountrySelectField'
import { readJsonFileText } from './GeometryInput'

type ImportResult = {
  created: number
  failed: Array<{ index: number; name: string; errorKey: string }>
}

type ParsedImportInput =
  | { ok: true; value: unknown; featureCount: number }
  | { ok: false; errorKey: string }

export type PlotImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: () => void
}

function parseImportInput(raw: string): ParsedImportInput {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, errorKey: 'geometryInvalid' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, errorKey: 'geometryInvalid' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errorKey: 'geometryInvalid' }
  }
  const record = parsed as Record<string, unknown>
  if (record.type !== 'FeatureCollection' || !Array.isArray(record.features)) {
    return { ok: false, errorKey: 'geometryInvalid' }
  }
  return { ok: true, value: parsed, featureCount: record.features.length }
}

function translateErrorKey(translate: ReturnType<typeof useT>, errorKey: string): string {
  return errorKey.startsWith('eudr.errors.')
    ? translate(errorKey)
    : translate(`eudr.errors.${errorKey}`)
}

export function PlotImportDialog({ open, onOpenChange, onImported }: PlotImportDialogProps) {
  const translate = useT()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [supplierEntityId, setSupplierEntityId] = React.useState('')
  const [, setSupplierSnapshot] = React.useState<CompanySnapshot | null>(null)
  const [defaultCountry, setDefaultCountry] = React.useState<string | null>(null)
  const [geoJsonText, setGeoJsonText] = React.useState('')
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const parsedInput = React.useMemo(() => parseImportInput(geoJsonText), [geoJsonText])
  const mutationContextId = 'eudr-plots-import'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: translate('ui.forms.flash.saveBlocked'),
  })

  React.useEffect(() => {
    if (!open) return
    setSupplierEntityId('')
    setSupplierSnapshot(null)
    setDefaultCountry(null)
    setGeoJsonText('')
    setResult(null)
    setSubmitting(false)
  }, [open])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen && result) onImported?.()
  }, [onImported, onOpenChange, result])

  const handleFile = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setGeoJsonText(await readJsonFileText(file))
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (submitting) return
    if (!supplierEntityId || !parsedInput.ok) {
      flash(translate('eudr.plots.import.invalid'), 'error')
      return
    }
    setSubmitting(true)
    try {
      const response = await runMutation({
        operation: async () => apiCallOrThrow<ImportResult>(
          '/api/eudr/plots/import',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              supplierEntityId,
              ...(defaultCountry ? { defaultCountry } : {}),
              featureCollection: parsedInput.value,
            }),
          },
          { fallback: { created: 0, failed: [] }, errorMessage: translate('eudr.plots.import.error') },
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.plot',
          resourceId: 'import',
          retryLastMutation,
        },
        mutationPayload: {
          supplierEntityId,
          defaultCountry,
        },
      })
      const result = response.result ?? { created: 0, failed: [] }
      setResult(result)
      if (result.failed.length === 0) {
        flash(translate('eudr.plots.import.success'), 'success')
      } else {
        flash(translate('eudr.plots.import.partialResult', {
          created: result.created,
          failed: result.failed.length,
        }), result.created > 0 ? 'warning' : 'error')
      }
    } catch {
      flash(translate('eudr.plots.import.error'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [defaultCountry, mutationContextId, parsedInput, retryLastMutation, runMutation, submitting, supplierEntityId, translate])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleOpenChange(false)
    }
  }, [handleOpenChange, handleSubmit])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{translate('eudr.plots.import.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="eudr-plot-import-supplier">
              {translate('eudr.evidenceSubmissions.form.supplier')}
            </label>
            <CompanySelectField
              id="eudr-plot-import-supplier"
              value={supplierEntityId || null}
              onChange={(nextValue) => setSupplierEntityId(nextValue ?? '')}
              onSnapshot={setSupplierSnapshot}
              placeholder={translate('eudr.evidenceSubmissions.form.supplierPlaceholder')}
              loadError={translate('eudr.evidenceSubmissions.form.supplierLoadError')}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="eudr-plot-import-country">
              {translate('eudr.plots.import.defaultCountry')}
            </label>
            <CountrySelectField
              id="eudr-plot-import-country"
              value={defaultCountry}
              onChange={setDefaultCountry}
              placeholder={translate('eudr.plots.form.originCountryPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" aria-hidden="true" />
                {translate('eudr.plots.geometry.upload')}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".json,.geojson,application/json,application/geo+json"
                onChange={(event) => {
                  void handleFile(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>
            <Textarea
              value={geoJsonText}
              rows={8}
              placeholder={translate('eudr.plots.import.placeholder')}
              onChange={(event) => setGeoJsonText(event.target.value)}
            />
            {geoJsonText.trim().length > 0 && parsedInput.ok ? (
              <p className="text-sm text-status-success-text">
                {translate('eudr.plots.import.featureCount', { count: parsedInput.featureCount })}
              </p>
            ) : null}
            {geoJsonText.trim().length > 0 && !parsedInput.ok ? (
              <p className="text-sm text-status-error-text">
                {translateErrorKey(translate, parsedInput.errorKey)}
              </p>
            ) : null}
          </div>

          {result ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FileJson className="size-4 text-muted-foreground" aria-hidden="true" />
                {translate('eudr.plots.import.createdCount', { count: result.created })}
              </div>
              {result.failed.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-status-warning-text">
                    {translate('eudr.plots.import.failedTitle', { count: result.failed.length })}
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background">
                    {result.failed.map((failure) => (
                      <div key={`${failure.index}:${failure.name}`} className="grid gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 md:grid-cols-[5rem_1fr_1.5fr]">
                        <span className="text-muted-foreground">{failure.index + 1}</span>
                        <span className="truncate text-foreground">{failure.name}</span>
                        <span className="text-status-error-text">{translateErrorKey(translate, failure.errorKey)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {translate('eudr.plots.import.close')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !supplierEntityId || !parsedInput.ok}
          >
            {translate('eudr.plots.import.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PlotImportDialog
