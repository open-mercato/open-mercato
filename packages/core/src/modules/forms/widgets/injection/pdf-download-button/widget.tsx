"use client"

/**
 * Phase 2b — PdfDownloadButton injection widget.
 *
 * Mounts into the submission drawer's `submission-drawer:header-actions` spot.
 * Downloads the immutable signed PDF snapshot via
 * `GET /api/forms/submissions/:submissionId/pdf`. The route lazily generates
 * the snapshot on first request for a submitted form, so the button generally
 * works post-submit. It is disabled (with a tooltip) for non-submitted
 * submissions, where no snapshot can exist yet.
 *
 * Read-only fetch (no state mutation), so `useGuardedMutation` is not required;
 * uses `apiCall` (never raw fetch) and reads the streamed bytes from the shared
 * response object. Feature-gated behind `forms.view` to match the route.
 */

import * as React from 'react'
import { Download } from 'lucide-react'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FormsDrawerWidgetContext } from '../context'

type PdfDownloadButtonProps = {
  context: FormsDrawerWidgetContext
}

function parseFilename(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const match = /filename="?([^"]+)"?/i.exec(disposition)
  return match?.[1] ?? fallback
}

export function PdfDownloadButtonWidget({ context }: PdfDownloadButtonProps) {
  const t = useT()
  const submissionId = typeof context?.submissionId === 'string' ? context.submissionId : null
  const isSubmitted = context?.status === 'submitted'
  const [downloading, setDownloading] = React.useState(false)

  const handleDownload = React.useCallback(async () => {
    if (!submissionId) return
    setDownloading(true)
    try {
      const resp = await apiCall(`/api/forms/submissions/${encodeURIComponent(submissionId)}/pdf`)
      if (!resp.ok) {
        flash(t('forms.compliance.pdf.unavailable', { fallback: 'PDF snapshot is being generated.' }), 'error')
        return
      }
      const blob = await resp.response.blob()
      const filename = parseFilename(
        resp.response.headers.get('content-disposition'),
        `submission-${submissionId}.pdf`,
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      flash(t('forms.compliance.pdf.unavailable', { fallback: 'PDF snapshot is being generated.' }), 'error')
    } finally {
      setDownloading(false)
    }
  }, [submissionId, t])

  if (!submissionId) return null

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!isSubmitted || downloading}
      onClick={handleDownload}
      data-forms-pdf-download=""
    >
      <Download className="mr-1 h-4 w-4" aria-hidden="true" />
      {t('forms.compliance.pdf.download', { fallback: 'Download PDF' })}
    </Button>
  )

  if (isSubmitted) return button

  return (
    <SimpleTooltip content={t('forms.compliance.pdf.unavailable', { fallback: 'PDF snapshot is being generated.' })}>
      <span data-forms-pdf-download-disabled="">{button}</span>
    </SimpleTooltip>
  )
}

const widget: InjectionWidgetModule<FormsDrawerWidgetContext> = {
  metadata: {
    id: 'forms.injection.pdf-download-button',
    title: 'Forms Submission PDF Download',
    description:
      'Downloads the signed PDF snapshot for a submitted submission from the drawer header; disabled with a tooltip until the form is submitted.',
    features: ['forms.view'],
    priority: 100,
    enabled: true,
  },
  Widget: PdfDownloadButtonWidget,
}

export default widget
