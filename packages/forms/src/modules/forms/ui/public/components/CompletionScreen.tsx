"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { RunnerActiveFormResponse, RunnerSubmission } from '../types'

export type CompletionScreenProps = {
  submission: RunnerSubmission
  schemaResponse: RunnerActiveFormResponse
  pdfDownloadEnabled?: boolean
  onDownloadPdf?: () => void
  onReturnHome?: () => void
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function CompletionScreen({
  submission,
  schemaResponse,
  pdfDownloadEnabled = false,
  onDownloadPdf,
  onReturnHome,
}: CompletionScreenProps) {
  const t = useT()
  const submittedAt = submission.submittedAt ?? submission.updatedAt ?? null
  const versionNumber = schemaResponse.formVersion.versionNumber
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-8 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-status-success text-status-success-foreground"
      >
        <Check className="h-8 w-8" />
      </span>
      <h2 className="text-2xl font-semibold text-foreground">
        {t('forms.runner.completion.title', { fallback: 'Thank you!' })}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t('forms.runner.completion.subtitle', { fallback: 'Your submission has been recorded.' })}
      </p>
      <dl className="grid grid-cols-2 gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm">
        <dt className="text-muted-foreground">
          {t('forms.runner.completion.version', {
            fallback: 'Version {version}',
            version: String(versionNumber),
          })}
        </dt>
        <dd className="text-right text-foreground">{schemaResponse.form.name}</dd>
        <dt className="text-muted-foreground">
          {t('forms.runner.completion.submitted_at', {
            fallback: 'Submitted at {time}',
            time: formatTime(submittedAt),
          })}
        </dt>
        <dd className="text-right text-foreground">{formatTime(submittedAt) || '—'}</dd>
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          onClick={onDownloadPdf}
          disabled={!pdfDownloadEnabled}
          title={
            !pdfDownloadEnabled
              ? t('forms.runner.completion.download_pdf_unavailable', {
                  fallback: 'Available after PDF snapshot feature ships.',
                })
              : undefined
          }
        >
          {t('forms.runner.completion.download_pdf', { fallback: 'Download PDF copy' })}
        </Button>
        {onReturnHome ? (
          <Button type="button" variant="outline" onClick={onReturnHome}>
            {t('forms.runner.completion.return_home', { fallback: 'Back to portal home' })}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
