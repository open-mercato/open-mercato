import { execFile } from 'child_process'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

type ExtractParams = {
  filePath: string
  mimeType?: string | null
}

function isImage(mimeType?: string | null, filePath?: string | null): boolean {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized.startsWith('image/')) return true
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff'].includes(ext)
  }
  return false
}

const CONVERTIBLE_MIME_PREFIXES = ['text/']
const CONVERTIBLE_MIME_SET = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-word',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/vnd.ms-outlook',
])

const CONVERTIBLE_EXTENSIONS = new Set<string>(['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.msg'])

function isConvertibleMimeType(mimeType?: string | null, filePath?: string | null): boolean {
  const normalized = (mimeType || '').toLowerCase()
  if (CONVERTIBLE_MIME_SET.has(normalized)) return true
  if (CONVERTIBLE_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true
  if (normalized.includes('outlook')) return true
  const ext = filePath ? path.extname(filePath).toLowerCase() : ''
  if (CONVERTIBLE_EXTENSIONS.has(ext)) return true
  return false
}

export async function extractAttachmentContent(params: ExtractParams): Promise<string | null> {
  const { filePath, mimeType } = params
  if (!filePath) return null
  if (isImage(mimeType, filePath)) return null
  if (!isConvertibleMimeType(mimeType, filePath)) return null
  try {
    const result = await execFileAsync('markitdown', [filePath])
    const stdout = typeof result === 'string' || Buffer.isBuffer(result) ? result : result?.stdout
    const text = typeof stdout === 'string' ? stdout : stdout?.toString() ?? ''
    const trimmed = text.trim()
    if (!trimmed) return null
    return text
  } catch (error) {
    console.error('[attachments] failed to extract content via markitdown', error)
    return null
  }
}
