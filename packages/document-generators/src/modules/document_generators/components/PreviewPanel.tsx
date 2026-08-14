'use client'

import * as React from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { Preview } from './Preview'
import { Loader } from './Loader'
import {
  downloadBlob,
  getFilenameFromResponse,
  resolveErrorMessage,
  revokeObjectUrlAfterNavigation,
} from '../utils'

interface PreviewPanelProps {
  open: boolean
  onClose: () => void
  record: unknown
  template: TemplateMeta
}

export function PreviewPanel({ open, onClose, record, template }: PreviewPanelProps) {
  const t = useT()
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null)
  const [markdown, setMarkdown] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [downloading, setDownloading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'document-generators.generate',
    blockedMessage: t('document_generators.preview.error', 'Failed to generate document.'),
  })

  React.useEffect(() => {
    if (!open) return

    setLoading(true)
    setBlobUrl(null)
    setMarkdown(null)
    setError(null)

    let objectUrl: string | undefined
    let cancelled = false
    const isMarkdown = template.format === 'md'

    const run = async () => {
      const { ok, result, response } = await apiCall<Blob | string>('/api/document-generators/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: template.id, data: record }),
      }, {
        parse: (res) => isMarkdown ? res.text() : res.blob(),
      })

      if (cancelled) return
      if (!ok || !result) {
        setError(await resolveErrorMessage(response, t))
        return
      }
      if (typeof result === 'string') {
        setMarkdown(result)
      } else {
        objectUrl = URL.createObjectURL(result)
        setBlobUrl(objectUrl)
      }
    }

    run().catch(() => {
      if (!cancelled) setError(t('document_generators.preview.error', 'Failed to generate document.'))
    }).finally(() => { if (!cancelled) setLoading(false) })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [open, record, template.format, template.id, t])

  const handleDownload = React.useCallback(async () => {
    if (loading || downloading) return

    setDownloading(true)
    setError(null)
    const payload = {
      template_id: template.id,
      data: record,
    }

    try {
      const { result, response } = await runMutation({
        operation: async () => {
          const call = await apiCall<Blob>('/api/document-generators/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }, {
            parse: (res) => res.blob(),
          })
          if (!call.ok || !call.result) {
            throw new Error(await resolveErrorMessage(call.response, t))
          }
          return { result: call.result, response: call.response }
        },
        context: {
          resourceKind: template.resourceKind,
          templateId: template.id,
          retryLastMutation,
        },
        mutationPayload: payload,
      })
      const filename = getFilenameFromResponse(
        response,
        `${template.id}.${template.format === 'md' ? 'md' : 'pdf'}`,
      )
      const url = URL.createObjectURL(result)
      downloadBlob(url, filename)
      revokeObjectUrlAfterNavigation(url)
    } catch (downloadError) {
      setError(
        downloadError instanceof Error && downloadError.message
          ? downloadError.message
          : t('document_generators.preview.error', 'Failed to generate document.'),
      )
    } finally {
      setDownloading(false)
    }
  }, [downloading, loading, record, retryLastMutation, runMutation, t, template.format, template.id, template.resourceKind])

  const handleDialogKeyDown = useDialogKeyHandler({
    onConfirm: () => { void handleDownload() },
    disabled: loading || downloading,
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="flex h-screen w-screen max-w-none sm:h-screen sm:max-w-none sm:rounded-none flex-col gap-0 p-0 translate-x-0 translate-y-0 sm:translate-x-0 sm:translate-y-0 sm:inset-0 sm:top-0 sm:left-0"
        onKeyDown={handleDialogKeyDown}
      >
        <DialogHeader className="border-b px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <DialogTitle>{t('document_generators.preview.title', 'Document preview')}</DialogTitle>
              <DialogDescription>{template.label}</DialogDescription>
            </div>
            {blobUrl ? (
              <Button asChild variant="outline" size="sm" className="mr-8 shrink-0">
                <a href={blobUrl} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  {t('document_generators.preview.openInNewTab', 'Open in new tab')}
                </a>
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden bg-muted/30">
            {loading && (
              <div className="flex h-full items-center justify-center">
                <Loader />
              </div>
            )}
            {error && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            {blobUrl && (
              <Preview
                url={blobUrl}
                title={t('document_generators.preview.frameTitle', 'PDF document preview')}
              />
            )}
            {markdown !== null && (
              <pre
                aria-label={t('document_generators.preview.markdownTitle', 'Markdown document preview')}
                className="h-full overflow-auto whitespace-pre-wrap p-6 font-mono text-sm"
              >
                {markdown}
              </pre>
            )}
          </div>
          <div className="border-t bg-background px-6 py-4">
            <Button type="button" onClick={() => { void handleDownload() }} disabled={loading || downloading} className="w-full">
              <Download className="mr-2 h-4 w-4" />
              {downloading
                ? t('document_generators.generate.generating', 'Generating...')
                : template.format === 'md'
                  ? t('document_generators.generate.buttonMarkdown', 'Download Markdown')
                  : t('document_generators.generate.button', 'Download PDF')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
