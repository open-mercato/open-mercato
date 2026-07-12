"use client"

import * as React from 'react'
import { FileDown, FileText } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { ActionsDropdown, type ActionItem } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ExportMenuProps = {
  documentId: string
  editor: Editor | null
}

type ExportFormat = 'docx' | 'pdf'

function filenameFromDisposition(disposition: string | null, format: ExportFormat): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded) } catch { /* use the safe fallback */ }
  }
  const quoted = disposition?.match(/filename="([^"]+)"/i)?.[1]
  return quoted || `document.${format}`
}

export type DocxPaginationSnapshot = { contentHtml: string; pageBreakMarker: string }

export function buildDocxPaginationSnapshot(editor: Editor | null): DocxPaginationSnapshot | null {
  if (!editor || editor.isDestroyed) return null
  const root = editor.view.dom.cloneNode(true) as HTMLElement
  const pageBreaks = root.querySelectorAll<HTMLElement>('[data-document-page-break]')
  if (pageBreaks.length === 0) return null
  const pageBreakMarker = `OM_DOCX_PAGE_BREAK_${crypto.randomUUID()}`
  pageBreaks.forEach((pageBreak) => {
    const marker = document.createElement('p')
    marker.textContent = pageBreakMarker
    pageBreak.replaceWith(marker)
  })
  root.querySelectorAll('.collaboration-carets__caret, .ProseMirror-yjs-selection')
    .forEach((node) => node.remove())
  return { contentHtml: root.innerHTML, pageBreakMarker }
}

export async function downloadDocumentExport(
  documentId: string,
  format: ExportFormat,
  snapshot: DocxPaginationSnapshot | null,
  errorMessage: string,
): Promise<void> {
  const hasSnapshot = format === 'docx' && snapshot !== null
  // Intentionally outside useGuardedMutation: export is read-shaped (no record is
  // mutated); the POST variant only carries the client pagination snapshot payload.
  const call = await apiCallOrThrow<Blob>(
    `/api/documents/${encodeURIComponent(documentId)}/export?format=${format}`,
    {
      method: hasSnapshot ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: {
        'x-om-forbidden-redirect': '0',
        'x-om-unauthorized-redirect': '0',
        ...(hasSnapshot ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasSnapshot ? { body: JSON.stringify(snapshot) } : {}),
    },
    { parse: (response) => response.blob(), errorMessage },
  )
  const response = call.response
  const expectedContentType = format === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf'
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== expectedContentType || !call.result) throw new Error(errorMessage)

  const blob = call.result
  const objectUrl = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filenameFromDisposition(response.headers.get('content-disposition'), format)
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function ExportMenu({ documentId, editor }: ExportMenuProps) {
  const t = useT()
  const download = React.useCallback((format: ExportFormat) => {
    const snapshot = format === 'docx' ? buildDocxPaginationSnapshot(editor) : null
    void downloadDocumentExport(documentId, format, snapshot, t('documents.export.error')).catch((error) => {
      flash(error instanceof Error ? error.message : t('documents.export.runtimeUnavailable'), 'error')
    })
  }, [documentId, editor, t])
  const items = React.useMemo<ActionItem[]>(() => [
    {
      id: 'docx',
      label: t('documents.export.docx'),
      icon: FileText,
      onSelect: () => download('docx'),
    },
    {
      id: 'pdf',
      label: t('documents.export.pdf'),
      icon: FileDown,
      onSelect: () => download('pdf'),
    },
  ], [download, t])

  return (
    <ActionsDropdown
      items={items}
      label={t('documents.actions.export')}
      ariaLabel={t('documents.actions.export')}
    />
  )
}
