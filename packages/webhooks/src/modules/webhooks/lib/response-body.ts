export const WEBHOOK_RESPONSE_BODY_LIMIT_BYTES = 4096

type ReadWebhookResponseBodyOptions = {
  maxBytes: number
  signal: AbortSignal
}

const ABORTED = Symbol('aborted')

export async function readWebhookResponseBody(
  response: Response,
  options: ReadWebhookResponseBodyOptions,
): Promise<string> {
  const { maxBytes, signal } = options
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let removeAbortListener: () => void = () => undefined
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    const onAbort = () => resolve(ABORTED)
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => signal.removeEventListener('abort', onAbort)
  })

  let text = ''
  let remainingBytes = maxBytes
  try {
    while (remainingBytes > 0 && !signal.aborted) {
      let chunk: ReadableStreamReadResult<Uint8Array> | typeof ABORTED
      try {
        chunk = await Promise.race([reader.read(), aborted])
      } catch (error) {
        if (signal.aborted) return text
        throw error
      }
      if (chunk === ABORTED) return text
      if (chunk.done) return text + decoder.decode()
      const accepted = chunk.value.byteLength > remainingBytes
        ? chunk.value.subarray(0, remainingBytes)
        : chunk.value
      remainingBytes -= accepted.byteLength
      text += decoder.decode(accepted, { stream: true })
    }
    return text
  } finally {
    removeAbortListener()
    void reader.cancel(signal.aborted ? signal.reason : undefined).catch(() => undefined)
  }
}
