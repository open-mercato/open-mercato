"use client"

import * as React from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getDocumentEditorExtensions } from '../../../lib/editorConfig'
import type { TemplatePreviewResult } from './templateUi'

function PreviewSurface({ html, fallbackLabel }: { html: string; fallbackLabel: string }) {
  const editor = useEditor({
    extensions: getDocumentEditorExtensions({ entityRefFallbackLabel: fallbackLabel }),
    content: html,
    editable: false,
    editorProps: { attributes: { class: 'min-h-48 text-base leading-7 text-foreground focus-visible:outline-none' } },
  }, [fallbackLabel])
  React.useEffect(() => { editor?.commands.setContent(html) }, [editor, html])
  return <EditorContent editor={editor} className="max-w-none rounded-md border border-border bg-card p-4" />
}

export function TemplatePreview({ preview, isLoading }: { preview: TemplatePreviewResult | null; isLoading: boolean }) {
  const t = useT()
  if (isLoading) return <LoadingMessage label={t('documents.templates.preview.loading')} />
  if (!preview) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        {t('documents.templates.preview.empty')}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {preview.unresolvedTokens.length > 0 ? (
        <Alert status="warning">
          <AlertTitle>{t('documents.templates.preview.unresolvedTitle')}</AlertTitle>
          <AlertDescription>{t('documents.templates.preview.unresolvedBody', { tokens: preview.unresolvedTokens.join(', ') })}</AlertDescription>
        </Alert>
      ) : null}
      <PreviewSurface html={preview.contentHtml} fallbackLabel={t('documents.editor.entityRef.fallbackLabel')} />
    </div>
  )
}
