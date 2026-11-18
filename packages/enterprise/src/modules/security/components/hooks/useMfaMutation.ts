'use client'

import * as React from 'react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useSudoChallenge } from './useSudoChallenge'

export function useMfaMutation() {
  const { requireSudo } = useSudoChallenge()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'security-mfa-self-management',
  })
  return React.useCallback(async <T,>(url: string, init: RequestInit): Promise<T> => {
    return runMutation({
      context: { retryLastMutation },
      operation: async () => {
        const response = await apiCall<T & { error?: string }>(url, init)
        if (response.status === 403 && response.result?.error === 'sudo_required') {
          const token = await requireSudo('security.mfa.self.manage')
          if (token) {
            const headers = new Headers(init.headers)
            headers.set('x-sudo-token', token)
            return readApiResultOrThrow<T>(url, { ...init, headers })
          }
        }
        if (!response.ok) await raiseCrudError(response.response)
        if (response.result == null) throw new Error('[internal] Missing MFA mutation response')
        return response.result
      },
    })
  }, [requireSudo, retryLastMutation, runMutation])
}
