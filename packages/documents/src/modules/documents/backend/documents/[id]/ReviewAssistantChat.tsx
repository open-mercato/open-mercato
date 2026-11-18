"use client"

import * as React from 'react'
import { AiChat } from '@open-mercato/ui/ai/AiChat'
import {
  defaultAiUiPartRegistry,
  type AiUiPartProps,
  type AiUiPartRegistry,
} from '@open-mercato/ui/ai/ui-part-registry'
import { MutationPreviewCard } from '@open-mercato/ui/ai/parts/MutationPreviewCard'
import { useAiPendingActionPolling } from '@open-mercato/ui/ai/parts/useAiPendingActionPolling'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { REVIEW_ASSISTANT_AGENT_ID } from '../../../lib/reviewAssistantIds'
import { handledAssistantActions, PlacementToggle, useReviewAssistant } from './ReviewAssistant'
import { settledAssistantAction, type ReviewAssistantPageContext } from './reviewAssistantModel'

const PENDING_STATUSES = new Set(['pending', 'executing'])

/**
 * Wraps the stock approval card and watches the pending action it renders. When
 * a documents finding decision this page saw pending gets confirmed, the page
 * finishes it (replaces the passage for Apply) and refreshes the review UI.
 */
export function ReviewAssistantPreviewCard(props: AiUiPartProps) {
  const assistant = useReviewAssistant()
  const pendingActionId = props.pendingActionId ?? ''
  const { action } = useAiPendingActionPolling({
    pendingActionId,
    intervalMs: 1500,
    disabled: !pendingActionId || !assistant,
  })
  const observedPending = React.useRef(false)
  const settle = assistant?.settle
  React.useEffect(() => {
    if (!action) return
    if (PENDING_STATUSES.has(action.status)) observedPending.current = true
    const settled = settledAssistantAction(action, observedPending.current, handledAssistantActions)
    if (settled && settle) settle(settled)
  }, [action, settle])
  return <MutationPreviewCard {...props} />
}

const reviewAssistantRegistry: AiUiPartRegistry = {
  register: (componentId, component) => defaultAiUiPartRegistry.register(componentId, component),
  unregister: (componentId) => defaultAiUiPartRegistry.unregister(componentId),
  resolve: (componentId) => (
    componentId === 'mutation-preview-card'
      ? (ReviewAssistantPreviewCard as unknown as ReturnType<AiUiPartRegistry['resolve']>)
      : defaultAiUiPartRegistry.resolve(componentId)
  ) as never,
  has: (componentId) => componentId === 'mutation-preview-card' || defaultAiUiPartRegistry.has(componentId),
  list: () => defaultAiUiPartRegistry.list(),
  clear: () => undefined,
}

type ReviewAssistantChatProps = {
  conversationId: string
  pageContext: ReviewAssistantPageContext
  composerPrefill: { text: string; requestId: number } | null
}

export default function ReviewAssistantChat({ conversationId, pageContext, composerPrefill }: ReviewAssistantChatProps) {
  const t = useT()
  const suggestions = React.useMemo(() => [
    { label: t('documents.reviewAssistant.suggestions.summary'), prompt: t('documents.reviewAssistant.suggestions.summaryPrompt') },
    { label: t('documents.reviewAssistant.suggestions.blocking'), prompt: t('documents.reviewAssistant.suggestions.blockingPrompt') },
  ], [t])
  return (
    <AiChat
      agent={REVIEW_ASSISTANT_AGENT_ID}
      conversationId={conversationId}
      pageContext={pageContext}
      registry={reviewAssistantRegistry}
      composerPrefill={composerPrefill ?? undefined}
      headerActions={<PlacementToggle />}
      className="h-full min-h-0"
      welcomeTitle={t('documents.reviewAssistant.welcome.title')}
      welcomeDescription={t('documents.reviewAssistant.welcome.description')}
      placeholder={t('documents.reviewAssistant.placeholder')}
      suggestions={suggestions}
    />
  )
}
