"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from './avatar'
import { Button } from './button'
import { useFileSelection } from '../hooks/useFileSelection'
import type { FileRejection } from '../utils/fileUpload'
import { readImageDimensions } from '../utils/imageDimensions'
import { imageUploadPlaceholders } from '../assets/image-upload-placeholders'

export type ImageFileRejection = FileRejection | { file: File; reason: 'dimensions' | 'image' }

export type ImageUploadProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  src?: string | null
  alt?: string
  kind?: 'avatar' | 'company'
  alignment?: 'vertical' | 'horizontal'
  heading?: React.ReactNode
  description?: React.ReactNode
  maxSizeBytes?: number
  minWidth?: number
  minHeight?: number
  disabled?: boolean
  onChange: (file: File | null) => void
  onFilesRejected?: (files: ImageFileRejection[]) => void
}

export function ImageUpload({ className, src, alt, kind = 'avatar', alignment = 'vertical', heading, description, maxSizeBytes, minWidth = 400, minHeight = 400, disabled, onChange, onFilesRejected, ...props }: ImageUploadProps) {
  const t = useT()
  const accept = 'image/png,image/jpeg'
  const generation = React.useRef(0)
  const [imageError, setImageError] = React.useState<string | null>(null)
  const [validating, setValidating] = React.useState(false)
  React.useEffect(() => {
    setValidating(false)
    return () => { generation.current += 1 }
  }, [disabled, accept, minWidth, minHeight, maxSizeBytes])
  const { inputRef, selectFiles, errors, clearErrors } = useFileSelection({
    accept, multiple: false, maxSizeBytes, disabled,
    onFilesSelected: async files => {
      const file = files[0]
      const request = ++generation.current
      setValidating(true)
      let dimensions: { width: number; height: number }
      try {
        dimensions = await readImageDimensions(file)
      } catch {
        if (request !== generation.current) return
        setValidating(false)
        setImageError(t('ui.fileUpload.invalidImage', '{name} could not be read as an image.', { name: file.name }))
        onFilesRejected?.([{ file, reason: 'image' }])
        return
      }
      if (request !== generation.current) return
      setValidating(false)
      if (dimensions.width < minWidth || dimensions.height < minHeight) {
        setImageError(t('ui.fileUpload.imageTooSmall', '{name} must be at least {width}×{height}px.', { name: file.name, width: minWidth, height: minHeight }))
        onFilesRejected?.([{ file, reason: 'dimensions' }])
      } else onChange(file)
    },
    onFilesRejected,
  })
  const allErrors = imageError ? [...errors, imageError] : errors
  const horizontal = alignment === 'horizontal'
  const label = alt ?? t('ui.fileUpload.imageAlt', 'Uploaded image')
  return (
    <div className={cn('max-w-full', className)} {...props}>
      <div data-slot="image-upload" data-kind={kind} data-alignment={alignment} data-state={src ? 'uploaded' : 'empty'} aria-busy={validating} className={cn('inline-flex max-w-full gap-5', horizontal ? 'items-center' : 'items-start')}>
        <Avatar src={src || imageUploadPlaceholders[kind][alignment]} label={label} ariaLabel={label} size={horizontal ? 56 : 64} variant="monochrome" />
        <div className="flex min-w-0 flex-col gap-3">
          {!horizontal ? <div className="flex flex-col gap-1"><p className="text-base font-medium leading-6 text-foreground">{heading ?? t('ui.fileUpload.imageTitle', 'Upload Image')}</p><p className="text-sm leading-5 text-muted-foreground">{description ?? t('ui.fileUpload.imageDescription', 'Min {width}×{height}px, PNG or JPEG', { width: minWidth, height: minHeight })}</p></div> : null}
          <div className="flex flex-wrap gap-3">
            {src ? <Button variant="destructive-outline" size="sm" type="button" disabled={disabled} onClick={() => { generation.current += 1; setValidating(false); setImageError(null); clearErrors(); onChange(null) }}>{t('ui.fileUpload.removeImage', 'Remove')}</Button> : null}
            <Button variant="outline" size="sm" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>{src ? t('ui.fileUpload.changeImage', 'Change') : t('ui.fileUpload.uploadImage', 'Upload')}</Button>
          </div>
        </div>
        <input ref={inputRef} type="file" className="hidden" tabIndex={-1} accept={accept} disabled={disabled} aria-label={src ? t('ui.fileUpload.changeImage', 'Change') : t('ui.fileUpload.uploadImage', 'Upload')} onChange={event => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          generation.current += 1
          setImageError(null)
          setValidating(false)
          selectFiles(files)
        }} />
      </div>
      {allErrors.length > 0 ? <ul role="alert" className="mt-2 space-y-1 text-xs text-status-error-text">{allErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul> : null}
    </div>
  )
}
