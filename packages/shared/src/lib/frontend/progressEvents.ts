export const PROGRESS_DOM_EVENTS = {
  UPDATE: 'om:progress:update',
  COMPLETE: 'om:progress:complete',
  ERROR: 'om:progress:error',
  CANCELLED: 'om:progress:cancelled',
} as const

export type ProgressUpdateDetail = {
  jobId: string
  jobType: string
  name: string
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

export function emitProgressUpdate(detail: ProgressUpdateDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROGRESS_DOM_EVENTS.UPDATE, { detail }))
}

export function emitProgressComplete(jobId: string, jobType: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROGRESS_DOM_EVENTS.COMPLETE, { detail: { jobId, jobType } }))
}

export function emitProgressError(jobId: string, errorMessage: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROGRESS_DOM_EVENTS.ERROR, { detail: { jobId, errorMessage } }))
}

export function subscribeProgressUpdate(handler: (detail: ProgressUpdateDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => handler((event as CustomEvent<ProgressUpdateDetail>).detail)
  window.addEventListener(PROGRESS_DOM_EVENTS.UPDATE, listener)
  return () => window.removeEventListener(PROGRESS_DOM_EVENTS.UPDATE, listener)
}

export function subscribeProgressComplete(handler: (detail: { jobId: string; jobType: string }) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => handler((event as CustomEvent<{ jobId: string; jobType: string }>).detail)
  window.addEventListener(PROGRESS_DOM_EVENTS.COMPLETE, listener)
  return () => window.removeEventListener(PROGRESS_DOM_EVENTS.COMPLETE, listener)
}
