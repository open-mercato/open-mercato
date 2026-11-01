import { failedUploadsStorageKey } from './portalSupport'

/**
 * Files that failed to upload while filing a ticket. The names survive a reload in
 * `sessionStorage`; the `File` objects themselves can only live in memory, so a retry
 * is possible for files picked in this browser session and a re-attach otherwise.
 */
const retryableFilesByTicket = new Map<string, Map<string, File>>()

export function rememberFailedUploads(ticketId: string, files: readonly File[]): void {
  if (!files.length) return
  const current = retryableFilesByTicket.get(ticketId) ?? new Map<string, File>()
  for (const file of files) current.set(file.name, file)
  retryableFilesByTicket.set(ticketId, current)
  writeFailedUploadNames(ticketId, [...new Set([...readFailedUploadNames(ticketId), ...files.map((file) => file.name)])])
}

export function getRetryableUpload(ticketId: string, fileName: string): File | null {
  return retryableFilesByTicket.get(ticketId)?.get(fileName) ?? null
}

export function forgetFailedUpload(ticketId: string, fileName: string): string[] {
  const files = retryableFilesByTicket.get(ticketId)
  files?.delete(fileName)
  if (files && files.size === 0) retryableFilesByTicket.delete(ticketId)
  const remaining = readFailedUploadNames(ticketId).filter((name) => name !== fileName)
  writeFailedUploadNames(ticketId, remaining)
  return remaining
}

export function readFailedUploadNames(ticketId: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(failedUploadsStorageKey(ticketId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function writeFailedUploadNames(ticketId: string, names: readonly string[]): void {
  try {
    if (names.length) window.sessionStorage.setItem(failedUploadsStorageKey(ticketId), JSON.stringify(names))
    else window.sessionStorage.removeItem(failedUploadsStorageKey(ticketId))
  } catch {
    return
  }
}
