"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { downloadBlob } from '../utils'
import { requestDocument } from './document-request'
import { Loader } from './Loader'
import { Preview } from './Preview'
import {
  isSubmitShortcut,
  resolveDownloadLabelKey,
  resolvePreviewKind,
  resolvePreviewTitleKey,
  type DocumentPreviewState,
} from './preview-state'

export type PreviewPanelProps = {
  template: TemplateMeta
  record: { id: string }
  onClose: () => void
  onGenerated?: () => void
}

export function PreviewPanel({ template, record, onClose, onGenerated }: PreviewPanelProps) {
  const t = useT()
  const [preview, setPreview] = React.useState<DocumentPreviewState>({ status: 'loading' })
  const [pending, setPending] = React.useState(false)
  const [generateError, setGenerateError] = React.useState<string | null>(null)
  const versions = template.versions ?? []
  const latestVersion = template.version ?? versions[0]
  const [selectedVersion, setSelectedVersion] = React.useState<string | undefined>(undefined)
  const requestedVersion = selectedVersion && selectedVersion !== latestVersion ? selectedVersion : undefined
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'document-generators-generate',
    blockedMessage: t('document_generators.generate.error'),
  })
  const mutationContext = React.useMemo(
    () => ({ templateId: template.id, recordId: record.id, retryLastMutation }),
    [template.id, record.id, retryLastMutation],
  )
  const kind = resolvePreviewKind(template.format)
  const translateRef = React.useRef(t)
  translateRef.current = t

  React.useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    setPreview({ status: 'loading' })
    requestDocument({
      action: 'preview',
      templateId: template.id,
      recordId: record.id,
      templateVersion: requestedVersion,
      translate: translateRef.current,
      signal: controller.signal,
    })
      .then(async ({ blob }) => {
        if (controller.signal.aborted) return
        if (kind === 'markdown') {
          const text = await blob.text()
          if (!controller.signal.aborted) setPreview({ status: 'ready', kind: 'markdown', text })
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setPreview({ status: 'ready', kind: 'pdf', url: objectUrl })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPreview({
          status: 'error',
          message: error instanceof Error && error.message
            ? error.message
            : translateRef.current('document_generators.preview.error'),
        })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [template.id, record.id, kind, requestedVersion])

  const generate = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    setGenerateError(null)
    try {
      const { blob, filename } = await runMutation({
        operation: () =>
          requestDocument({ action: 'generate', templateId: template.id, recordId: record.id, templateVersion: requestedVersion, translate: t }),
        context: mutationContext,
        mutationPayload: { template_id: template.id, template_version: requestedVersion, data: { id: record.id } },
      })
      downloadBlob(blob, filename)
      onGenerated?.()
    } catch (error) {
      setGenerateError(error instanceof Error && error.message ? error.message : t('document_generators.generate.error'))
    } finally {
      setPending(false)
    }
  }, [pending, runMutation, template.id, record.id, requestedVersion, t, mutationContext, onGenerated])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isSubmitShortcut(event)) return
    event.preventDefault()
    void generate()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="xl" className="flex h-dvh max-h-dvh flex-col sm:max-w-5xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{template.label}</DialogTitle>
          {versions.length > 1 ? (
            <Select value={selectedVersion ?? latestVersion} onValueChange={(next) => setSelectedVersion(next || undefined)}>
              <SelectTrigger className="w-56" aria-label={t('document_generators.preview.version')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.map((version) => (
                  <SelectItem key={version} value={version}>
                    {version === latestVersion ? `${version} · ${t('document_generators.preview.latestVersion')}` : version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {preview.status === 'loading' ? <Loader label={t('document_generators.preview.loading')} /> : null}
          {preview.status === 'error' ? <ErrorMessage label={preview.message} /> : null}
          {preview.status === 'ready' && preview.kind === 'markdown' ? (
            <pre
              className="whitespace-pre-wrap rounded border border-border bg-muted/30 p-4 font-mono text-sm"
              aria-label={t(resolvePreviewTitleKey(template.format))}
            >
              {preview.text}
            </pre>
          ) : null}
          {preview.status === 'ready' && preview.kind === 'pdf' ? (
            <div className="flex h-full flex-col gap-2">
              <Preview url={preview.url} title={t(resolvePreviewTitleKey(template.format))} />
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline"
              >
                {t('document_generators.preview.openInNewTab')}
              </a>
            </div>
          ) : null}
        </div>
        {generateError ? <ErrorMessage label={generateError} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('document_generators.preview.close')}
          </Button>
          <Button type="button" onClick={() => void generate()} disabled={pending}>
            {pending ? <Spinner size="sm" /> : null}
            {pending ? t('document_generators.generate.pending') : t(resolveDownloadLabelKey(template.format))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
