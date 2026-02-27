"use client"

import { BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID } from './spotIds'

export const LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID = 'backend-mutation:global'
export const GLOBAL_MUTATION_INJECTION_SPOT_ID = BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID
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
