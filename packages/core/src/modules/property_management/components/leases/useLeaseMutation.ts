"use client"

import * as React from 'react'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LEASE_RESOURCE_KIND } from './leaseModel'

type LeaseMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export type LeaseRequest = {
  leaseId: string
  optimisticLockUpdatedAt: string | null
  url: string
  method: 'POST' | 'DELETE'
  body?: Record<string, unknown>
  errorMessage: string
}

export function useLeaseMutation(contextId: string) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<LeaseMutationContext>({
    contextId,
    blockedMessage: t('property_management.common.blocked', 'The change was blocked.'),
  })

  const send = React.useCallback(
    async <TResult = Record<string, unknown>>(request: LeaseRequest): Promise<TResult | null> => {
      const call = await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(request.optimisticLockUpdatedAt), () =>
            apiCallOrThrow<TResult>(
              request.url,
              {
                method: request.method,
                headers: request.body ? { 'content-type': 'application/json' } : undefined,
                body: request.body ? JSON.stringify(request.body) : undefined,
              },
              { errorMessage: request.errorMessage },
            ),
          ),
        mutationPayload: request.body ?? { id: request.leaseId },
        context: { formId: contextId, resourceKind: LEASE_RESOURCE_KIND, resourceId: request.leaseId, retryLastMutation },
      })
      return call?.result ?? null
    },
    [contextId, retryLastMutation, runMutation],
  )

  return { send }
}
