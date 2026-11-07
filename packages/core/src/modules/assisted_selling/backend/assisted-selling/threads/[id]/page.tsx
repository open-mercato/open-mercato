"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, withScopedApiRequestHeaders, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEventCoalesced } from '@open-mercato/ui/backend/injection/useAppEventCoalesced'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ProposalBuilderDialog } from './ProposalBuilderDialog'

const THREAD_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  open: 'info',
  closed: 'neutral',
}

const PROPOSAL_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  published: 'info',
  accepted: 'success',
  rejected: 'error',
  withdrawn: 'neutral',
  expired: 'neutral',
  superseded: 'neutral',
}

type ParticipantRow = {
  id: string
  actorType: 'buyer' | 'rep' | 'ai_agent'
  actorId: string | null
  displayName: string
  joinedAt: string | null
  leftAt: string | null
}

type MessageRow = {
  id: string
  participantId: string
  body: string
  bodyFormat: string
  proposalId: string | null
  sentAt: string | null
}

type ProposalLineRow = {
  id: string
  productId: string
  variantId: string | null
  sku: string | null
  name: string
  quantity: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  priceKindId: string | null
  priceRowId: string | null
  lineTotals: Record<string, unknown>
}

type ProposalRow = {
  id: string
  status: string
  authoredByActorType: string
  authoredByActorId: string
  publishedAt: string | null
  expiresAt: string | null
  resolvedAt: string | null
  supersededByProposalId: string | null
  currencyCode: string | null
  lines: ProposalLineRow[]
}

type ThreadDetail = {
  id: string
  storeId: string
  buyerCartId: string
  customerId: string | null
  customerUserId: string | null
  status: string
  assignedActorId: string | null
  liveProposalCount: number
  updatedAt: string | null
}

type ThreadDetailResponse = {
  thread: ThreadDetail
  participants: ParticipantRow[]
  messages: MessageRow[]
  proposals: ProposalRow[]
}

export default function AssistedSellingThreadPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const threadId = params?.id ?? ''

  const [data, setData] = React.useState<ThreadDetailResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [composerBody, setComposerBody] = React.useState('')
  const [builderOpen, setBuilderOpen] = React.useState(false)

  const labels = React.useMemo(
    () => ({
      pageTitle: t('assisted_selling.admin.thread.pageTitle', 'Selling conversation'),
      back: t('assisted_selling.admin.thread.actions.back', 'Back to conversations'),
      join: t('assisted_selling.admin.thread.actions.join', 'Join'),
      leave: t('assisted_selling.admin.thread.actions.leave', 'Leave'),
      assignToMe: t('assisted_selling.admin.thread.actions.assignToMe', 'Assign to me'),
      newProposal: t('assisted_selling.admin.thread.actions.newProposal', 'New proposal'),
      withdraw: t('assisted_selling.admin.thread.actions.withdraw', 'Withdraw'),
      repropose: t('assisted_selling.admin.thread.actions.repropose', 'Re-propose'),
      send: t('assisted_selling.admin.thread.actions.send', 'Send'),
      composerPlaceholder: t('assisted_selling.admin.thread.composer.placeholder', 'Write a message...'),
      sections: {
        participants: t('assisted_selling.admin.thread.sections.participants', 'Participants'),
        timeline: t('assisted_selling.admin.thread.sections.timeline', 'Conversation'),
      },
      statuses: {
        open: t('assisted_selling.admin.statuses.open', 'Open'),
        closed: t('assisted_selling.admin.statuses.closed', 'Closed'),
      },
      proposalStatuses: {
        published: t('assisted_selling.admin.proposalStatuses.published', 'Awaiting the buyer'),
        accepted: t('assisted_selling.admin.proposalStatuses.accepted', 'Accepted'),
        rejected: t('assisted_selling.admin.proposalStatuses.rejected', 'Rejected'),
        withdrawn: t('assisted_selling.admin.proposalStatuses.withdrawn', 'Withdrawn'),
        expired: t('assisted_selling.admin.proposalStatuses.expired', 'Expired'),
        superseded: t('assisted_selling.admin.proposalStatuses.superseded', 'Superseded'),
      },
      participantActorTypes: {
        buyer: t('assisted_selling.admin.thread.participants.buyer', 'Buyer'),
        rep: t('assisted_selling.admin.thread.participants.rep', 'Rep'),
        ai_agent: t('assisted_selling.admin.thread.participants.aiAgent', 'AI agent'),
      },
      proposalPriceLabel: t('assisted_selling.admin.thread.proposal.priceLabel', "Buyer's price"),
      proposalProvenance: t('assisted_selling.admin.thread.proposal.provenance', 'Price row {priceRowId}'),
      errors: {
        load: t('assisted_selling.admin.thread.errors.load', 'Failed to load the selling conversation.'),
        join: t('assisted_selling.admin.thread.errors.join', 'Failed to join this conversation.'),
        leave: t('assisted_selling.admin.thread.errors.leave', 'Failed to leave this conversation.'),
        assign: t('assisted_selling.admin.thread.errors.assign', 'Failed to assign this conversation.'),
        send: t('assisted_selling.admin.thread.errors.send', 'Failed to send this message.'),
        withdraw: t('assisted_selling.admin.thread.errors.withdraw', 'Failed to withdraw this proposal.'),
        repropose: t('assisted_selling.admin.thread.errors.repropose', 'Failed to re-propose.'),
      },
      flash: {
        joined: t('assisted_selling.admin.thread.flash.joined', 'You joined this conversation.'),
        left: t('assisted_selling.admin.thread.flash.left', 'You left this conversation.'),
        assigned: t('assisted_selling.admin.thread.flash.assigned', 'Conversation assigned to you.'),
        sent: t('assisted_selling.admin.thread.flash.sent', 'Message sent.'),
        withdrawn: t('assisted_selling.admin.thread.flash.withdrawn', 'Proposal withdrawn.'),
        reproposed: t('assisted_selling.admin.thread.flash.reproposed', 'New proposal authored.'),
      },
    }),
    [t],
  )

  const loadThread = React.useCallback(async () => {
    if (!threadId) return
    setIsLoading(true)
    setError(null)
    try {
      const call = await apiCall<ThreadDetailResponse>(`/api/assisted_selling/threads/${threadId}`)
      if (!call.ok || !call.result) throw new Error(labels.errors.load)
      setData(call.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.errors.load)
    } finally {
      setIsLoading(false)
    }
  }, [threadId, labels.errors.load])

  React.useEffect(() => {
    void loadThread()
  }, [loadThread, reloadToken])

  // §6.8/§7.1: the thread page updates on any thread/participant/message/proposal event for
  // THIS conversation without polling — `clientBroadcast: true` plus the shared DOM Event
  // Bridge hook, never a custom poll loop.
  useAppEventCoalesced(
    'assisted_selling.*',
    (event) => {
      const payload = event.payload as { threadId?: unknown }
      if (payload.threadId === threadId) setReloadToken((token) => token + 1)
    },
    [threadId],
  )

  const mutationContextId = `assisted-selling-thread:${threadId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const handleJoin = React.useCallback(async () => {
    try {
      await runMutation({
        operation: () => apiCall(`/api/assisted_selling/threads/${threadId}/join`, { method: 'POST', body: JSON.stringify({}) }),
        context: { formId: mutationContextId, resourceKind: 'assisted_selling.thread', resourceId: threadId, retryLastMutation },
        mutationPayload: {},
      })
      flash(labels.flash.joined, 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      flash(labels.errors.join, 'error')
    }
  }, [labels.errors.join, labels.flash.joined, mutationContextId, retryLastMutation, runMutation, t, threadId])

  const handleLeave = React.useCallback(async () => {
    try {
      await runMutation({
        operation: () => apiCall(`/api/assisted_selling/threads/${threadId}/leave`, { method: 'POST', body: JSON.stringify({}) }),
        context: { formId: mutationContextId, resourceKind: 'assisted_selling.thread', resourceId: threadId, retryLastMutation },
        mutationPayload: {},
      })
      flash(labels.flash.left, 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      flash(labels.errors.leave, 'error')
    }
  }, [labels.errors.leave, labels.flash.left, mutationContextId, retryLastMutation, runMutation, t, threadId])

  const handleAssignToMe = React.useCallback(async () => {
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(data?.thread.updatedAt), () =>
            apiCall(`/api/assisted_selling/threads/${threadId}/assign`, { method: 'POST', body: JSON.stringify({}) }),
          ),
        context: { formId: mutationContextId, resourceKind: 'assisted_selling.thread', resourceId: threadId, retryLastMutation },
        mutationPayload: {},
      })
      flash(labels.flash.assigned, 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        setReloadToken((token) => token + 1)
        return
      }
      flash(labels.errors.assign, 'error')
    }
  }, [data?.thread.updatedAt, labels.errors.assign, labels.flash.assigned, mutationContextId, retryLastMutation, runMutation, t, threadId])

  const handleSendMessage = React.useCallback(async () => {
    const body = composerBody.trim()
    if (!body) return
    try {
      await runMutation({
        operation: () =>
          readApiResultOrThrow(
            `/api/assisted_selling/threads/${threadId}/messages`,
            { method: 'POST', body: JSON.stringify({ body }) },
            { errorMessage: labels.errors.send },
          ),
        context: { formId: mutationContextId, resourceKind: 'assisted_selling.message', resourceId: threadId, retryLastMutation },
        mutationPayload: {},
      })
      setComposerBody('')
      flash(labels.flash.sent, 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      flash(labels.errors.send, 'error')
    }
  }, [composerBody, labels.errors.send, labels.flash.sent, mutationContextId, retryLastMutation, runMutation, t, threadId])

  const handleComposerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSendMessage()
      }
    },
    [handleSendMessage],
  )

  const handleWithdraw = React.useCallback(
    async (proposal: ProposalRow) => {
      try {
        await runMutation({
          operation: () =>
            readApiResultOrThrow(
              `/api/assisted_selling/proposals/${proposal.id}/withdraw`,
              { method: 'POST', body: JSON.stringify({}) },
              { errorMessage: labels.errors.withdraw },
            ),
          context: { formId: mutationContextId, resourceKind: 'assisted_selling.proposal', resourceId: proposal.id, retryLastMutation },
          mutationPayload: {},
        })
        flash(labels.flash.withdrawn, 'success')
        setReloadToken((token) => token + 1)
      } catch (err) {
        if (surfaceRecordConflict(err, t)) {
          setReloadToken((token) => token + 1)
          return
        }
        flash(labels.errors.withdraw, 'error')
      }
    },
    [labels.errors.withdraw, labels.flash.withdrawn, mutationContextId, retryLastMutation, runMutation, t],
  )

  const handleRepropose = React.useCallback(
    async (proposal: ProposalRow) => {
      try {
        await runMutation({
          operation: () =>
            readApiResultOrThrow(
              `/api/assisted_selling/proposals/${proposal.id}/reauthor`,
              { method: 'POST', body: JSON.stringify({ idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}` }) },
              { errorMessage: labels.errors.repropose },
            ),
          context: { formId: mutationContextId, resourceKind: 'assisted_selling.proposal', resourceId: proposal.id, retryLastMutation },
          mutationPayload: {},
        })
        flash(labels.flash.reproposed, 'success')
        setReloadToken((token) => token + 1)
      } catch (err) {
        if (surfaceRecordConflict(err, t)) return
        flash(labels.errors.repropose, 'error')
      }
    },
    [labels.errors.repropose, labels.flash.reproposed, mutationContextId, retryLastMutation, runMutation, t],
  )

  if (isLoading && !data) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('assisted_selling.admin.thread.loading', 'Loading conversation...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? labels.errors.load} />
        </PageBody>
      </Page>
    )
  }

  const { thread, participants, messages, proposals } = data
  const participantsById = new Map(participants.map((participant) => [participant.id, participant]))
  const proposalsById = new Map(proposals.map((proposal) => [proposal.id, proposal]))

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/backend/assisted-selling"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden /> {labels.back}
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-medium">{labels.pageTitle}</h1>
              <StatusBadge variant={THREAD_STATUS_VARIANTS[thread.status] ?? 'neutral'} dot>
                {labels.statuses[thread.status as keyof typeof labels.statuses] ?? thread.status}
              </StatusBadge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void handleJoin()}>
              {labels.join}
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleLeave()}>
              {labels.leave}
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleAssignToMe()}>
              {labels.assignToMe}
            </Button>
            <Button type="button" onClick={() => setBuilderOpen(true)}>
              {labels.newProposal}
            </Button>
          </div>
        </div>

        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">{labels.sections.participants}</h2>
          <ul className="flex flex-wrap gap-2">
            {participants.map((participant) => (
              <li key={participant.id} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{participant.displayName}</span>
                {' — '}
                {labels.participantActorTypes[participant.actorType] ?? participant.actorType}
                {participant.leftAt ? ` (${t('assisted_selling.admin.thread.participants.left', 'left')})` : ''}
              </li>
            ))}
          </ul>
        </div>

        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">{labels.sections.timeline}</h2>
          <div className="flex flex-col gap-3">
            {messages.map((message) => {
              const author = participantsById.get(message.participantId)
              const proposal = message.proposalId ? proposalsById.get(message.proposalId) : null
              return (
                <div key={message.id} className="rounded-md border border-border p-3">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{author?.displayName ?? message.participantId}</span>
                    <span>{message.sentAt ? formatDateTime(message.sentAt) ?? '' : ''}</span>
                  </div>
                  {message.body ? <p className="whitespace-pre-wrap text-sm text-foreground">{message.body}</p> : null}
                  {proposal ? (
                    <div className="mt-2 rounded-md border border-border bg-muted p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <StatusBadge variant={PROPOSAL_STATUS_VARIANTS[proposal.status] ?? 'neutral'} dot>
                          {labels.proposalStatuses[proposal.status as keyof typeof labels.proposalStatuses] ?? proposal.status}
                        </StatusBadge>
                        <div className="flex gap-2">
                          {proposal.status === 'published' ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => void handleWithdraw(proposal)}>
                              {labels.withdraw}
                            </Button>
                          ) : null}
                          {['expired', 'rejected', 'withdrawn', 'superseded'].includes(proposal.status) ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => void handleRepropose(proposal)}>
                              {labels.repropose}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {proposal.lines.map((line) => (
                            <tr key={line.id} className="border-b border-border last:border-0">
                              <td className="px-2 py-1 text-foreground">{line.name}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{line.quantity}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-foreground">
                                <span title={labels.proposalPriceLabel}>
                                  {formatCurrency(
                                    line.unitPriceGross != null ? Number(line.unitPriceGross) : null,
                                    proposal.currencyCode ?? 'USD',
                                  ) ?? '—'}
                                </span>
                                {line.priceRowId ? (
                                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                                    {t('assisted_selling.admin.thread.proposal.provenance', 'Price row {priceRowId}', {
                                      priceRowId: line.priceRowId.slice(0, 8),
                                    })}
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-md border border-border p-3">
          <Textarea
            value={composerBody}
            onChange={(event) => setComposerBody(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={labels.composerPlaceholder}
            rows={3}
            aria-label={labels.composerPlaceholder}
          />
          <div className="mt-2 flex justify-end">
            <Button type="button" onClick={() => void handleSendMessage()} disabled={!composerBody.trim()}>
              {labels.send}
            </Button>
          </div>
        </div>
      </PageBody>

      <ProposalBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        threadId={threadId}
        onSuccess={() => setReloadToken((token) => token + 1)}
      />
    </Page>
  )
}
