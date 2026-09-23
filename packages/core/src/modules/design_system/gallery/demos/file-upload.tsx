import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'
import { FileUploadCard, type FileUploadStatus } from '@open-mercato/ui/primitives/file-upload-card'
import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'
import { formatAttachmentFileSize } from '@open-mercato/ui/backend/detail/AttachmentVisualPreview'
import { uploadExampleImages } from '../assets/upload-images'

type QueueFile = { id: number; file: File; progress: number }

export function FileUploadAreaDemo({ disabled = false }: { disabled?: boolean }) {
  const t = useT()
  const nextId = React.useRef(0)
  const [files, setFiles] = React.useState<QueueFile[]>([])
  const uploading = files.some(file => file.progress < 100)
  React.useEffect(() => {
    if (!uploading) return
    const timer = window.setInterval(() => setFiles(current => current.map(file => ({ ...file, progress: Math.min(100, file.progress + 20) }))), 350)
    return () => window.clearInterval(timer)
  }, [uploading])
  return (
    <div className="flex w-100 max-w-full flex-col gap-3">
      <FileUploadArea disabled={disabled} onFilesSelected={selected => setFiles(current => [...current, ...selected.map(file => ({ id: nextId.current++, file, progress: 0 }))])} />
      {files.length > 0 ? <p role="status" className="text-xs text-muted-foreground">{t('design_system.gallery.samples.upload.selected', '{count} files selected', { count: files.length })}</p> : null}
      {files.map(item => <FileUploadCard key={item.id} fileName={item.file.name} sizeLabel={formatAttachmentFileSize(item.file.size)} status={item.progress === 100 ? 'success' : 'uploading'} progress={item.progress} onRemove={() => setFiles(current => current.filter(file => file.id !== item.id))} />)}
    </div>
  )
}

export function FileUploadCardDemo({ initialStatus, disabled = false }: { initialStatus: FileUploadStatus; disabled?: boolean }) {
  const t = useT()
  const [removed, setRemoved] = React.useState(false)
  const [status, setStatus] = React.useState(initialStatus)
  const [progress, setProgress] = React.useState(0)
  const [retrying, setRetrying] = React.useState(false)
  React.useEffect(() => {
    if (!retrying || removed) return
    const timer = window.setInterval(() => setProgress(current => Math.min(100, current + 25)), 250)
    return () => window.clearInterval(timer)
  }, [retrying, removed])
  React.useEffect(() => {
    if (progress < 100) return
    setStatus('success')
    setRetrying(false)
  }, [progress])
  if (removed) return <Button variant="outline" size="sm" onClick={() => { setRemoved(false); setRetrying(false); setProgress(0); setStatus(initialStatus) }}>{t('design_system.gallery.samples.upload.reset', 'Reset example')}</Button>
  return <FileUploadCard fileName="my-cv.pdf" sizeLabel={t(status === 'success' ? 'design_system.gallery.samples.upload.completeSize' : 'design_system.gallery.samples.upload.size')} status={status} progress={progress} disabled={disabled} onRemove={() => setRemoved(true)} onRetry={() => { setProgress(0); setStatus('uploading'); setRetrying(true) }} />
}

export function ImageUploadDemo({ kind, uploaded, alignment, disabled = false }: { kind: 'avatar' | 'company'; uploaded: boolean; alignment: 'vertical' | 'horizontal'; disabled?: boolean }) {
  const t = useT()
  const [source, setSource] = React.useState<string | null>(uploaded ? uploadExampleImages[kind] : null)
  const objectUrl = React.useRef<string | null>(null)
  React.useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }, [])
  return <ImageUpload src={source} alt={t(`design_system.gallery.samples.upload.${kind}`)} kind={kind} alignment={alignment} disabled={disabled} onChange={file => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = file ? URL.createObjectURL(file) : null
    setSource(objectUrl.current)
  }} />
}
