"use client"

import * as React from 'react'
import {
  uploadAttachmentsForChat,
  type UploadAttachmentsForChatOptions,
  type UploadAttachmentsForChatResult,
  type UploadFailureReason,
} from './upload-adapter'

/**
 * React hook wrapping {@link uploadAttachmentsForChat} with per-file state so
 * the {@link AiChat} composer can render progress chips, error badges, and a
 * Clear action without each consumer re-implementing the machinery.
 *
 * The hook is DS-neutral: it exposes only state and {@link UploadFailureReason}
 * codes. Consumers translate user-facing strings through `useT()` at render
 * time — no hard-coded copy in the hook.
 */

export interface UseAiChatUploadOptions extends UploadAttachmentsForChatOptions {
  /** Identical to the adapter options; forwarded verbatim. */
}

export type AiChatUploadFileStatus = 'queued' | 'uploading' | 'done' | 'error'

export interface AiChatUploadFileState {
  fileName: string
  size: number
  progress: number
  status: AiChatUploadFileStatus
  attachmentId?: string
  reason?: UploadFailureReason
  error?: string
}

export interface UseAiChatUploadState {
  files: AiChatUploadFileState[]
  overallProgress: number
  busy: boolean
  upload: (files: File[]) => Promise<UploadAttachmentsForChatResult>
  reset: () => void
}

const EMPTY_STATE: AiChatUploadFileState[] = []

function computeOverallProgress(entries: AiChatUploadFileState[]): number {
  if (entries.length === 0) return 0
  const total = entries.reduce((sum, entry) => sum + entry.progress, 0)
  const average = total / entries.length
  if (!Number.isFinite(average)) return 0
  if (average < 0) return 0
  if (average > 1) return 1
  return average
}

export function useAiChatUpload(
  options: UseAiChatUploadOptions = {},
): UseAiChatUploadState {
  const [files, setFiles] = React.useState<AiChatUploadFileState[]>(EMPTY_STATE)
  const [busy, setBusy] = React.useState(false)
  const optionsRef = React.useRef(options)
  React.useEffect(() => {
    optionsRef.current = options
  }, [options])

  const overallProgress = React.useMemo(() => computeOverallProgress(files), [files])

  const reset = React.useCallback(() => {
    setFiles(EMPTY_STATE)
    setBusy(false)
  }, [])

  const upload = React.useCallback(
    async (incoming: File[]): Promise<UploadAttachmentsForChatResult> => {
      if (!incoming || incoming.length === 0) {
        return { items: [], failed: [] }
      }
      const initialEntries: AiChatUploadFileState[] = incoming.map((file) => ({
        fileName: file.name,
        size: file.size,
        progress: 0,
        status: 'uploading',
      }))
      setFiles(initialEntries)
      setBusy(true)

      const callerOptions = optionsRef.current
      const callerProgress = callerOptions.onProgress
      const result = await uploadAttachmentsForChat(incoming, {
        ...callerOptions,
        onProgress: (fileIndex, progress) => {
          const ratio =
            progress.total > 0
              ? Math.max(0, Math.min(1, progress.loaded / progress.total))
              : 0
          setFiles((current) => {
            if (fileIndex < 0 || fileIndex >= current.length) return current
            const next = current.slice()
            const entry = next[fileIndex]
            if (!entry) return current
            next[fileIndex] = { ...entry, progress: ratio }
            return next
          })
          if (callerProgress) {
            try {
              callerProgress(fileIndex, progress)
            } catch {
              // Consumer-supplied callbacks must never abort state updates.
            }
          }
        },
      }).catch((err) => {
        // uploadAttachmentsForChat only rejects on programming errors; coerce
        // to a failure envelope so the hook state never throws at consumers.
        const message = err instanceof Error ? err.message : 'Upload batch failed.'
        return {
          items: [],
          failed: incoming.map((file) => ({
            fileName: file.name,
            reason: 'network' as UploadFailureReason,
            message,
          })),
        } as UploadAttachmentsForChatResult
      })

      setFiles((current) => {
        const failedByName = new Map<string, typeof result.failed[number]>()
        for (const failure of result.failed) {
          if (!failedByName.has(failure.fileName)) {
            failedByName.set(failure.fileName, failure)
          }
        }
        return current.map((entry, index) => {
          const success = result.items.find(
            (item, itemIndex) => itemIndex === index && item.fileName === entry.fileName,
          )
          if (success) {
            return {
              ...entry,
              progress: 1,
              status: 'done' as AiChatUploadFileStatus,
              attachmentId: success.attachmentId,
            }
          }
          const failure = failedByName.get(entry.fileName)
          if (failure) {
            failedByName.delete(entry.fileName)
            return {
              ...entry,
              status: 'error' as AiChatUploadFileStatus,
              reason: failure.reason,
              error: failure.message,
            }
          }
          // Defensive: a worker exited without producing either outcome.
          return {
            ...entry,
            status: 'error' as AiChatUploadFileStatus,
            reason: 'network' as UploadFailureReason,
          }
        })
      })

      setBusy(false)
      return result
    },
    [],
  )

  return {
    files,
    overallProgress,
    busy,
    upload,
    reset,
  }
}
