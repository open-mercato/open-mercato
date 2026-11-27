export type MetadataPatch = { name?: string; description?: string | null }
export type AutosaveState = 'idle' | 'saving' | 'error'

export function createMetadataAutosave(options: {
  save: (patch: MetadataPatch) => Promise<boolean>
  onStateChange: (state: AutosaveState) => void
  onError: (error: unknown) => void
  delay?: number
}) {
  let pending: MetadataPatch = {}
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let epoch = 0

  const hasPending = () => Object.keys(pending).length > 0

  async function flush() {
    if (running || !hasPending()) return
    const patch = pending
    const requestEpoch = epoch
    pending = {}
    running = true
    let saved = false
    try {
      saved = await options.save(patch)
    } catch (error) {
      if (requestEpoch === epoch) options.onError(error)
    } finally {
      running = false
    }
    if (requestEpoch !== epoch) {
      if (hasPending() && timer === null) void flush()
      return
    }
    if (!saved) {
      pending = { ...patch, ...pending }
      options.onStateChange('error')
      return
    }
    if (hasPending()) {
      options.onStateChange('saving')
      if (timer === null) void flush()
      return
    }
    options.onStateChange('idle')
  }

  function dispose() {
    epoch += 1
    pending = {}
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  return {
    schedule(patch: MetadataPatch) {
      if (Object.keys(patch).length === 0) return
      pending = { ...pending, ...patch }
      options.onStateChange('saving')
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void flush()
      }, options.delay ?? 1000)
    },
    reset() {
      dispose()
      options.onStateChange('idle')
    },
    dispose,
  }
}
