"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'

type FeatureCheckResponse = {
  granted?: string[]
}

/**
 * The thread page's own route guard only requires `assisted_selling.threads.view` and
 * `cart.proposals.view` — enough to see the conversation, not enough to author/withdraw a
 * proposal. The create/withdraw/re-propose endpoints additionally require both
 * `assisted_selling.proposals.author` and `cart.proposals.author` (withdraw rejects the proposal
 * cart through `cart.proposal.reject`, which enforces `cart.proposals.author`), so a viewer
 * without both grants must not be offered controls whose handlers always 403.
 */
export function useProposalAuthorAccess() {
  const [granted, setGranted] = React.useState<string[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            features: ['assisted_selling.proposals.author', 'cart.proposals.author'],
          }),
        })

        if (!cancelled) {
          setGranted(Array.isArray(call.result?.granted) ? call.result.granted : [])
        }
      } catch {
        if (!cancelled) setGranted([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const canAuthor = hasFeature(granted, 'assisted_selling.proposals.author')
  const canCartAuthor = hasFeature(granted, 'cart.proposals.author')
  const canManageProposals = canAuthor && canCartAuthor

  return {
    isLoading,
    granted,
    canAuthor,
    canCartAuthor,
    canCreateOrRepropose: canManageProposals,
    canWithdraw: canManageProposals,
  }
}
