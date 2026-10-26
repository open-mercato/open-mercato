import type { CollabResources } from './editorTypes'
import { collabContentSaveResponseSchema } from '../../../data/validators'
import { COLLAB_CONTENT_SAVE_TIMEOUT_MS } from '../../../lib/collabPersistence'

export function saveCollaborativeContent(
  resources: CollabResources,
  signal: AbortSignal,
): Promise<boolean> {
  const { provider } = resources
  if (signal.aborted || !provider.synced || provider.configuration.websocketProvider.status !== 'connected') {
    return Promise.resolve(false)
  }
  const requestId = crypto.randomUUID()
  return new Promise<boolean>((resolve) => {
    const finish = (saved: boolean) => {
      clearTimeout(timer)
      provider.off('stateless', onStateless)
      provider.off('close', onFailure)
      provider.off('disconnect', onFailure)
      provider.off('destroy', onFailure)
      signal.removeEventListener('abort', onFailure)
      resolve(saved)
    }
    const onFailure = () => finish(false)
    const onStateless = ({ payload }: { payload: string }) => {
      let value: unknown
      try { value = JSON.parse(payload) } catch { return }
      const response = collabContentSaveResponseSchema.safeParse(value)
      if (response.success && response.data.requestId === requestId) finish(response.data.saved)
    }
    const timer = setTimeout(onFailure, COLLAB_CONTENT_SAVE_TIMEOUT_MS)
    provider.on('stateless', onStateless)
    provider.on('close', onFailure)
    provider.on('disconnect', onFailure)
    provider.on('destroy', onFailure)
    signal.addEventListener('abort', onFailure, { once: true })
    try {
      provider.sendStateless(JSON.stringify({ type: 'documents.content.save', requestId }))
    } catch {
      finish(false)
    }
  })
}
