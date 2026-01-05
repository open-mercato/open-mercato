export type ProductSeoValidationPayload = {
  ok: boolean
  issues: string[]
  message?: string
}

type Listener = (payload: ProductSeoValidationPayload) => void

const listeners = new Set<Listener>()

export function publishProductSeoValidation(payload: ProductSeoValidationPayload) {
  listeners.forEach((listener) => {
    try {
      listener(payload)
    } catch (err) {
      console.error('[product-seo] Failed to notify listener', err)
    }
  })
}

export function subscribeProductSeoValidation(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
