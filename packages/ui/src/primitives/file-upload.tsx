"use client"

import * as React from 'react'
import { CloudUpload } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from './button'
import { useFileSelection, type FileSelectionProps } from '../hooks/useFileSelection'

export type FileUploadAreaProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onDrop' | 'onDragEnter' | 'onDragLeave' | 'onDragOver'> & FileSelectionProps & {
  heading?: React.ReactNode
  description?: React.ReactNode
  browseLabel?: string
}

export function FileUploadArea({ className, accept = 'image/jpeg,image/png,application/pdf,video/mp4', multiple = true, maxSizeBytes = 50 * 1024 * 1024, disabled, onFilesSelected, onFilesRejected, heading, description, browseLabel, ...props }: FileUploadAreaProps) {
  const t = useT()
  const id = React.useId()
  const dragDepth = React.useRef(0)
  const [dragActive, setDragActive] = React.useState(false)
  const { inputRef, selectFiles, errors } = useFileSelection({ accept, multiple, maxSizeBytes, disabled, onFilesSelected, onFilesRejected })
  return (
    <div className={cn('w-100 max-w-full', className)} {...props}>
      <div
        data-slot="file-upload-area"
        data-drag-active={dragActive && !disabled}
        role="group"
        aria-labelledby={`${id}-heading`}
        aria-describedby={`${id}-description`}
        aria-disabled={disabled || undefined}
        className={cn('flex flex-col items-center gap-5 rounded-upload bg-background p-8 text-center outline-1 -outline-offset-1 outline-dashed outline-border transition-colors', disabled ? 'opacity-50' : 'hover:bg-muted', dragActive && !disabled && 'bg-muted')}
        onDragEnter={event => {
          event.preventDefault()
          if (disabled || !Array.from(event.dataTransfer.types).includes('Files')) return
          dragDepth.current += 1
          setDragActive(true)
        }}
        onDragOver={event => {
          event.preventDefault()
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
        }}
        onDragLeave={event => {
          event.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragActive(false)
        }}
        onDrop={event => {
          event.preventDefault()
          dragDepth.current = 0
          setDragActive(false)
          selectFiles(Array.from(event.dataTransfer.files))
        }}
      >
        <CloudUpload aria-hidden="true" className="size-6 text-muted-foreground" />
        <div className="flex flex-col gap-1.5">
          <p id={`${id}-heading`} className="text-sm font-medium leading-5 text-foreground">{heading ?? t('ui.fileUpload.choose', 'Choose a file or drag & drop it here.')}</p>
          <p id={`${id}-description`} className="text-xs leading-4 text-muted-foreground">{description ?? t('ui.fileUpload.description', 'JPEG, PNG, PDF, and MP4 formats, up to 50 MB.')}</p>
        </div>
        <Button variant="outline" size="sm" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>{browseLabel ?? t('ui.fileUpload.browse', 'Browse File')}</Button>
        <input ref={inputRef} type="file" className="hidden" tabIndex={-1} accept={accept} multiple={multiple} disabled={disabled} aria-label={browseLabel ?? t('ui.fileUpload.browse', 'Browse File')} onChange={event => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          selectFiles(files)
        }} />
      </div>
      {errors.length > 0 ? <ul role="alert" className="mt-2 space-y-1 text-xs text-status-error-text">{errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul> : null}
    </div>
  )
}
