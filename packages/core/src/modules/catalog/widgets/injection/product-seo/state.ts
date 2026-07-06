import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type ProductSeoValidationPayload = {
  ok: boolean
  issues: string[]
  message?: string
}

// The `onBeforeSave` validation hook (widget.ts) is a plain side-effect handler
// with no React context, so it cannot call `useT`. The widget component (which
// does have `useT`) publishes its translator here on mount; the hook reads it to
// localize the save-block message (#3299). Undefined until the widget mounts —
// callers fall back to English via `evaluateProductSeo`'s default translator.
let productSeoTranslator: TranslateFn | null = null

export function setProductSeoTranslator(t: TranslateFn | null) {
  productSeoTranslator = t
}

export function getProductSeoTranslator(): TranslateFn | undefined {
  return productSeoTranslator ?? undefined
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
