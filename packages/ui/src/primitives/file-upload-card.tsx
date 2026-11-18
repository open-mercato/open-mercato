"use client"

import * as React from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, Trash2, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from './icon-button'
import { LinkButton } from './link-button'
import { Progress } from './progress'
import { FileFormatIcon, type FileFormatTone } from './file-format-icon'

export type FileUploadStatus = 'uploading' | 'success' | 'error'
export type FileUploadCardProps = React.HTMLAttributes<HTMLDivElement> & {
  fileName: string
  sizeLabel: React.ReactNode
  status: FileUploadStatus
  progress?: number
  format?: string
  tone?: FileFormatTone
  showStatus?: boolean
  disabled?: boolean
  onRemove?: () => void
  onRetry?: () => void
}

export function FileUploadCard({ className, fileName, sizeLabel, status, progress = 0, format, tone, showStatus = true, disabled, onRemove, onRetry, ...props }: FileUploadCardProps) {
  const t = useT()
  const StatusIcon = status === 'success' ? CircleCheck : status === 'error' ? CircleAlert : LoaderCircle
  const statusLabel = status === 'success' ? t('ui.fileUpload.completed', 'Completed') : status === 'error' ? t('ui.fileUpload.failed', 'Failed') : t('ui.fileUpload.uploading', 'Uploading…')
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0
  return (
    <div data-slot="file-upload-card" data-status={status} className={cn('flex w-100 max-w-full flex-col gap-4 rounded-upload bg-background p-4 pl-3.5 ring-1 ring-inset', status === 'error' ? 'ring-status-error-icon' : 'ring-border', className)} {...props}>
      <div className="flex items-start gap-3">
        <FileFormatIcon format={format ?? fileName.split('.').at(-1)?.toUpperCase() ?? ''} tone={tone} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-sm font-medium leading-5 text-foreground">{fileName}</p>
          <div className="flex min-h-4 flex-wrap items-center gap-1.5 text-xs leading-4 text-muted-foreground">
            <span>{sizeLabel}</span>
            {showStatus ? <><span aria-hidden="true">∙</span><span className="inline-flex items-center gap-1" role="status"><StatusIcon aria-hidden="true" className={cn('size-4', status === 'uploading' ? 'animate-spin' : 'text-background', status === 'success' && 'fill-status-success-icon', status === 'error' && 'fill-status-error-icon')} />{statusLabel}</span></> : null}
          </div>
          {status === 'error' && onRetry ? <LinkButton variant="error" underline="always" className="mt-1 self-start" disabled={disabled} onClick={onRetry}>{t('ui.fileUpload.retry', 'Try Again')}</LinkButton> : null}
        </div>
        {onRemove ? <IconButton variant="ghost" size="xs" className={cn('-mt-0.5 -mr-0.5', status === 'error' ? 'text-status-error-icon' : 'text-muted-foreground')} aria-label={status === 'uploading' ? t('ui.fileUpload.cancel', 'Cancel upload') : t('ui.fileUpload.remove', 'Remove file')} disabled={disabled} onClick={onRemove}>{status === 'uploading' ? <X className="size-5" /> : <Trash2 className="size-5" />}</IconButton> : null}
      </div>
      {status === 'uploading' ? <Progress value={safeProgress} className="h-1.5" aria-label={t('ui.fileUpload.progress', '{name} upload progress', { name: fileName })} /> : null}
    </div>
  )
}
