"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'

type FeatureCheckResponse = {
  granted?: string[]
}

const THREAD_ACTION_FEATURES = [
  'assisted_selling.threads.participate',
  'assisted_selling.messages.post',
  'assisted_selling.proposals.author',
  'cart.proposals.author',
]

/**
 * The thread page's own route guard only requires `assisted_selling.threads.view` and
 * `cart.proposals.view` — enough to read the conversation, not to act in it. Each action's
 * endpoint requires more: join/leave/assign need `assisted_selling.threads.participate`, the
 * composer needs `assisted_selling.messages.post`, and create/withdraw/re-propose need both
 * `assisted_selling.proposals.author` and `cart.proposals.author` (withdraw rejects the proposal
 * cart through `cart.proposal.reject`, which enforces `cart.proposals.author`). A principal must
 * not be offered controls whose handlers always 403.
 */
export function useThreadActionAccess() {
  const [granted, setGranted] = React.useState<string[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: THREAD_ACTION_FEATURES }),
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
    canParticipate: hasFeature(granted, 'assisted_selling.threads.participate'),
    canPostMessages: hasFeature(granted, 'assisted_selling.messages.post'),
    canCreateOrRepropose: canManageProposals,
    canWithdraw: canManageProposals,
  }
}
