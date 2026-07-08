"use client"

import * as React from 'react'
import { FileDown, FileText } from 'lucide-react'
import { ActionsDropdown, type ActionItem } from '@open-mercato/ui/backend/forms'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ExportMenuProps = {
  documentId: string
}

type ExportFormat = 'docx' | 'pdf'

function triggerDownload(documentId: string, format: ExportFormat): void {
  const link = document.createElement('a')
  link.href = `/api/documents/${encodeURIComponent(documentId)}/export?format=${format}`
  link.download = ''
  document.body.append(link)
  link.click()
  link.remove()
}

export function ExportMenu({ documentId }: ExportMenuProps) {
  const t = useT()
  const items = React.useMemo<ActionItem[]>(() => [
    {
      id: 'docx',
      label: t('documents.export.docx'),
      icon: FileText,
      onSelect: () => triggerDownload(documentId, 'docx'),
    },
    {
      id: 'pdf',
      label: t('documents.export.pdf'),
      icon: FileDown,
      onSelect: () => triggerDownload(documentId, 'pdf'),
    },
  ], [documentId, t])

  return (
    <ActionsDropdown
      items={items}
      label={t('documents.actions.export')}
      ariaLabel={t('documents.actions.export')}
    />
  )
}
