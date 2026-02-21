"use client"

export const GLOBAL_MUTATION_INJECTION_SPOT_ID = 'backend-mutation:global'
export const BACKEND_MUTATION_ERROR_EVENT = 'om:backend-mutation-error'

export type BackendMutationErrorEventDetail = {
  contextId?: string
  formId?: string
  error?: unknown
}

export function dispatchBackendMutationError(detail: BackendMutationErrorEventDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(BACKEND_MUTATION_ERROR_EVENT, {
      detail,
    }),
  )
}

