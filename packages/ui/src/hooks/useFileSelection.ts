"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { selectUploadFiles, type FileRejection, type FileSelectionOptions } from '../utils/fileUpload'

export type FileSelectionProps = FileSelectionOptions & {
  disabled?: boolean
  onFilesSelected: (files: File[]) => void
  onFilesRejected?: (files: FileRejection[]) => void
}

export function useFileSelection({ disabled, onFilesSelected, onFilesRejected, ...options }: FileSelectionProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [rejected, setRejected] = React.useState<FileRejection[]>([])
  const t = useT()
  function selectFiles(files: readonly File[]) {
    if (disabled) return
    const selection = selectUploadFiles(files, options)
    setRejected(selection.rejected)
    if (selection.accepted.length) onFilesSelected(selection.accepted)
    if (selection.rejected.length) onFilesRejected?.(selection.rejected)
  }
  const errors = rejected.map(({ file, reason }) => {
    if (reason === 'type') return t('ui.fileUpload.rejectedType', '{name}: file type is not supported.', { name: file.name })
    if (reason === 'size') return t('ui.fileUpload.rejectedSize', '{name} exceeds the allowed file size.', { name: file.name })
    return t('ui.fileUpload.rejectedCount', '{name} was skipped. Choose one file.', { name: file.name })
  })
  return { inputRef, selectFiles, errors, clearErrors: () => setRejected([]) }
}
