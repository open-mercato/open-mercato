"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { buildRateImportTemplateCsv, parseRateImportRows, type RateImportRow } from '../lib/contractRateImport'
import { isSpreadsheetAccepted, readSpreadsheetFile, sheetToObjects } from '../lib/spreadsheet'

const CONTEXT_ID = 'freight_operations.contract_routes.import'

type RowReport = {
  rowNumber: number
  status: 'valid' | 'invalid' | 'created' | 'failed'
  errors: string[]
}

type ImportSummary = {
  total: number
  valid?: number
  invalid: number
  created?: number
  failed?: number
}

function downloadTemplate() {
  const blob = new Blob([buildRateImportTemplateCsv()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'freight-contract-rates-template.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ImportContractRatesDialog({
  contractId,
  open,
  onOpenChange,
  onImported,
}: {
  contractId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const t = useT()
  const [rows, setRows] = React.useState<RateImportRow[]>([])
  const [unknownHeaders, setUnknownHeaders] = React.useState<string[]>([])
  const [missingHeaders, setMissingHeaders] = React.useState<string[]>([])
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [report, setReport] = React.useState<RowReport[] | null>(null)
  const [summary, setSummary] = React.useState<ImportSummary | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!open) return
    setRows([])
    setReport(null)
    setSummary(null)
    setError(null)
    setFileName(null)
    setUnknownHeaders([])
    setMissingHeaders([])
  }, [open])

  const clientInvalid = rows.filter((row) => row.errors.length > 0).length
  const canSubmit = rows.length > 0 && missingHeaders.length === 0 && clientInvalid === 0

  const onPickFile = React.useCallback(async (file: File) => {
    setError(null)
    setReport(null)
    setSummary(null)
    setFileName(file.name)
    if (!isSpreadsheetAccepted(file.name)) {
      setError(t('freight_operations.contract_routes.import.error.fileType', 'Upload a .csv or .xlsx file.'))
      setRows([])
      return
    }
    try {
      const sheet = await readSpreadsheetFile(file)
      const parsed = parseRateImportRows(sheetToObjects(sheet))
      setRows(parsed.rows)
      setUnknownHeaders(parsed.unknownHeaders)
      setMissingHeaders(parsed.missingRequiredHeaders)
      if (!parsed.rows.length) {
        setError(t('freight_operations.contract_routes.import.error.empty', 'The file has no data rows.'))
      }
    } catch (caught) {
      setRows([])
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.contract_routes.import.error.read', 'Could not read the file.'))
    }
  }, [t])

  const runImport = React.useCallback(async (mode: 'dry-run' | 'commit') => {
    setBusy(true)
    setError(null)
    try {
      const response = await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => apiCallOrThrow('/api/freight_operations/contract-routes/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contractId,
            mode,
            rows: rows.map((row) => ({ rowNumber: row.rowNumber, payload: row.payload })),
          }),
        }, { errorMessage: t('freight_operations.contract_routes.import.error.failed', 'The import could not be completed.') }),
        mutationPayload: { operation: 'contract_routes.import', contractId, mode, count: rows.length },
        context: { formId: CONTEXT_ID, resourceKind: 'freight_operations:freight_contract', resourceId: contractId, retryLastMutation },
      })
      const payload = response.result as { summary?: ImportSummary; rows?: RowReport[] } | null
      setSummary(payload?.summary ?? null)
      setReport(payload?.rows ?? [])
      if (mode === 'commit') {
        const created = payload?.summary?.created ?? 0
        if (created > 0) {
          flash(t('freight_operations.contract_routes.import.success', '{count} rate lines imported.', { count: created }), 'success')
          onImported()
        }
        if ((payload?.summary?.failed ?? 0) > 0) {
          setError(t('freight_operations.contract_routes.import.error.partial', 'Some rows could not be imported — see the report below.'))
        }
      }
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.contract_routes.import.error.failed', 'The import could not be completed.'))
    } finally {
      setBusy(false)
    }
  }, [contractId, onImported, retryLastMutation, rows, runMutation, t])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { if (canSubmit && !busy) void runImport('dry-run') },
    onCancel: () => onOpenChange(false),
  })

  const reportFor = (rowNumber: number): RowReport | undefined => report?.find((entry) => entry.rowNumber === rowNumber)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.contract_routes.import.title', 'Import rate lines')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.contract_routes.import.description', 'Upload a CSV or Excel sheet of lanes and rates. Nothing is written until the validation preview is clean and you confirm the import.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.tsv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void onPickFile(file)
                event.target.value = ''
              }}
            />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              {t('freight_operations.contract_routes.import.chooseFile', 'Choose a file')}
            </Button>
            <Button type="button" variant="ghost" onClick={downloadTemplate}>
              {t('freight_operations.contract_routes.import.downloadTemplate', 'Download template')}
            </Button>
            {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
          </div>

          {missingHeaders.length ? (
            <p className="text-sm text-status-error-text">
              {t('freight_operations.contract_routes.import.missingHeaders', 'Missing required columns: {columns}', {
                columns: missingHeaders.join(', '),
              })}
            </p>
          ) : null}
          {unknownHeaders.length ? (
            <p className="text-sm text-muted-foreground">
              {t('freight_operations.contract_routes.import.unknownHeaders', 'Ignored columns: {columns}', {
                columns: unknownHeaders.join(', '),
              })}
            </p>
          ) : null}

          {rows.length ? (
            <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-start text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium">{t('freight_operations.contract_routes.import.row', 'Row')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.lane', 'Lane')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.rate', 'Rate')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('freight_operations.contract_routes.import.status', 'Status')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('freight_operations.contract_routes.import.problems', 'Problems')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const serverReport = reportFor(row.rowNumber)
                    const problems = serverReport?.errors ?? row.errors
                    const status = serverReport?.status ?? (row.errors.length ? 'invalid' : 'valid')
                    return (
                      <tr key={row.rowNumber} className="border-b border-border/60">
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2">{`${row.payload.origin ?? ''} → ${row.payload.destination ?? ''}`}</td>
                        <td className="px-3 py-2">{`${row.payload.rateAmount ?? ''} ${row.payload.currencyCode ?? ''}`.trim()}</td>
                        <td className="px-3 py-2">
                          <Badge variant="secondary">
                            {t(`freight_operations.contract_routes.import.status.${status}`, status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-status-error-text">{problems.join('; ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {summary ? (
            <p className="text-sm text-muted-foreground">
              {summary.created !== undefined
                ? t('freight_operations.contract_routes.import.summaryCommit', 'Rows: {total} · imported: {created} · failed: {failed} · invalid: {invalid}', {
                    total: summary.total,
                    created: summary.created,
                    failed: summary.failed ?? 0,
                    invalid: summary.invalid,
                  })
                : t('freight_operations.contract_routes.import.summaryDryRun', 'Rows: {total} · valid: {valid} · invalid: {invalid}', {
                    total: summary.total,
                    valid: summary.valid ?? 0,
                    invalid: summary.invalid,
                  })}
            </p>
          ) : null}

          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.contract_routes.import.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canSubmit || busy}
            onClick={() => { void runImport('dry-run') }}
          >
            {busy ? <Spinner className="me-2 size-4" /> : null}
            {t('freight_operations.contract_routes.import.validate', 'Validate')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || busy || !report || (summary?.valid ?? 0) === 0}
            onClick={() => { void runImport('commit') }}
          >
            {t('freight_operations.contract_routes.import.commit', 'Import {count} rate lines', { count: summary?.valid ?? rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
