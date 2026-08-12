'use client'

import * as React from 'react'
import { Download } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { downloadBlob } from '../utils/downloadBlob'
import { getFilenameFromResponse } from '../utils/getFilenameFromResponse'
import { resolveErrorMessage } from '../utils/resolveErrorMessage'

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
  }, [open, template.format, template.id, t])

  const handleDownload = async () => {
    setDownloading(true)
    const { ok, result, response } = await apiCall('/api/document-generators/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: template.id,
        data: record,
      }),
    }, {
      parse: (res) => res.blob(),
    })
    setDownloading(false)
    if (!ok || !result) {
      setError(await resolveErrorMessage(response, t))
      return
    }
    const filename = getFilenameFromResponse(response, `${template.id}.${template.format === 'md' ? 'md' : 'pdf'}`)
    const url = URL.createObjectURL(result)
    downloadBlob(url, filename)
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-screen w-screen max-w-none sm:h-screen sm:max-w-none sm:rounded-none flex-col gap-0 p-0 translate-x-0 translate-y-0 sm:translate-x-0 sm:translate-y-0 sm:inset-0 sm:top-0 sm:left-0">
        <DialogHeader className="border-b px-4 py-4">
          <DialogTitle>{t('document_generators.preview.title', 'Document preview')}</DialogTitle>
          <DialogDescription>{template.label}</DialogDescription>
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
            <Button onClick={handleDownload} disabled={loading || downloading} className="w-full">
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
