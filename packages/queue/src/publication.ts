import type { EnqueueOptions } from './types'

export function validateEnqueueOptions(options?: EnqueueOptions): void {
  if (options?.jobId !== undefined && (
    typeof options.jobId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(options.jobId) || /^\d+$/.test(options.jobId)
  )) {
    throw new Error('[internal] Queue jobId must contain letters, digits, underscores or hyphens and must not be an integer')
  }
  if (options?.timeoutMs !== undefined && (
    !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647
  )) {
    throw new Error('[internal] Queue timeoutMs must be a positive safe timer duration')
  }
}

export async function publishWithTimeout<Result>(operation: () => Promise<Result>, timeoutMs?: number): Promise<Result> {
  if (timeoutMs === undefined) return operation()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('[internal] Queue publication timed out; outcome is uncertain')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
