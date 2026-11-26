"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useMarketingMutation } from '../../../components/useMarketingMutation'

type ImportResult = {
  suppressed: number
  alreadySuppressed: number
  unmatched: number
  unmatchedSample: string[]
  skipped: number
  truncated: boolean
}

/**
 * A once-per-migration action, on its own page rather than the settings screen.
 *
 * `page.meta.ts` gates it on `marketing_automation.consent.manage` alone — the same grant
 * `POST /api/marketing_automation/consent/import` requires — so whoever can answer "take this person off
 * every list" can reach the control without also needing `campaigns.manage`, and without the settings
 * screen's own GET (gated on `campaigns.view`) standing in the way.
 */
export default function SuppressionImportPage() {
  const t = useT()
  const runMutation = useMarketingMutation('consent')
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [importReason, setImportReason] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const [importResult, setImportResult] = React.useState<ImportResult | null>(null)

  /**
   * Reads the file in the browser and posts its text, rather than uploading it.
   *
   * The reason travels in the same payload that way, which matters because the reason is recorded on every row it
   * suppresses — a multipart upload with the reason in a separate field is two things that can disagree.
   */
  const importSuppressionList = async (file: File) => {
    const reason = importReason.trim()
    if (!reason) {
      flash(t('marketing_automation.settings.suppressionNeedsReason', 'Say where this list came from first — it is recorded on every customer it unsubscribes.'), 'error')
      return
    }
    /**
     * Asked between choosing the file and applying it, because a file chooser is one mis-click and this
     * import has no undo: every address it matches is unsubscribed, and nothing in the module can put
     * somebody back on a list they were taken off. The file's name is in the question so a wrong pick is
     * visible at the moment it still costs nothing.
     */
    const confirmed = await confirm({
      text: t(
        'marketing_automation.settings.confirmSuppressionImport',
        'Unsubscribe everybody in {file}? This cannot be undone — nothing here can put somebody back on a list.',
      ).replace('{file}', file.name),
      variant: 'destructive',
    })
    if (!confirmed) return

    setImporting(true)
    setImportResult(null)
    try {
      const csv = await file.text()
      const response = await runMutation(
        () => apiCallOrThrow<ImportResult>('/api/marketing_automation/consent/import', {
          method: 'POST',
          body: JSON.stringify({ csv, reason }),
          headers: { 'content-type': 'application/json' },
        }),
      )
      setImportResult(response.result ?? null)
    } catch {
      flash(t('marketing_automation.settings.suppressionFailed', 'Could not import that file.'), 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="max-w-2xl space-y-2">
          <SectionHeader title={t('marketing_automation.settings.suppression', 'Suppression list')} />
          <div className="text-xs text-muted-foreground">
            {t(
              'marketing_automation.settings.suppressionHint',
              'A CSV of email addresses from the tool you are leaving. Every address that matches a customer here is recorded as unsubscribed, with your reason on it. It can only take people OFF the list: a CSV is not consent, so there is no way to import anybody as subscribed.',
            )}
          </div>
          <Label htmlFor="suppression-reason">
            {t('marketing_automation.settings.suppressionReason', 'Where this list came from')}
          </Label>
          <Input
            id="suppression-reason"
            value={importReason}
            placeholder={t('marketing_automation.settings.suppressionReasonPlaceholder', 'Unsubscribes exported from our previous tool')}
            onChange={(event) => setImportReason(event.target.value)}
          />
          <Input
            id="suppression-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            disabled={importing}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              // The input is reset so choosing the same file twice runs twice — a retry after fixing the reason.
              event.target.value = ''
              if (file) void importSuppressionList(file)
            }}
          />
          {importing ? <Spinner /> : null}
          {importResult ? (
            <div className="text-xs text-muted-foreground">
              {t(
                'marketing_automation.settings.suppressionResult',
                'Suppressed {suppressed}. {already} were already unsubscribed. {unmatched} addresses matched no customer here, and {skipped} rows held no address.',
              )
                .replace('{suppressed}', String(importResult.suppressed))
                .replace('{already}', String(importResult.alreadySuppressed))
                .replace('{unmatched}', String(importResult.unmatched))
                .replace('{skipped}', String(importResult.skipped))}
              {importResult.truncated
                ? ` ${t('marketing_automation.settings.suppressionTruncated', 'The file was longer than one import applies — upload the rest separately.')}`
                : ''}
              {/* A sample, so a typo is distinguishable from somebody who was never a customer here. */}
              {importResult.unmatchedSample.length > 0 ? (
                <div className="mt-1 font-mono">{importResult.unmatchedSample.join(', ')}</div>
              ) : null}
            </div>
          ) : null}
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
