"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  CheckCheck,
  Loader2,
  ExternalLink,
  RefreshCw,
  Users,
  Languages,
} from 'lucide-react'
import type { ProposalTranslationEntry } from '../../../../data/entities'
import type { ProposalDetail, ActionDetail, DiscrepancyDetail, EmailDetail } from '../../../../components/proposals/types'
import { ActionCard, ConfidenceBadge, useActionTypeLabels, useDiscrepancyDescriptions } from '../../../../components/proposals/ActionCard'
import { hasContactNameIssue } from '../../../../lib/contactValidation'
import { EditActionDialog } from '../../../../components/proposals/EditActionDialog'

function EmailThreadViewer({ email }: { email: EmailDetail | null }) {
  const t = useT()
  if (!email) return null

  const messages = email.threadMessages || []

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm">{t('inbox_ops.email_thread', 'Email Thread')}</h3>
      {messages.length > 0 ? (
        messages.map((msg, index) => (
          <div key={index} className="border rounded-lg p-3 md:p-4 bg-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {msg.from?.name || msg.from?.email || t('inbox_ops.sender_unknown', 'Unknown')}
                </div>
                <div className="text-xs text-muted-foreground truncate">{msg.from?.email}</div>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {msg.date ? new Date(msg.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
            <div className="text-sm whitespace-pre-wrap text-foreground/80">{msg.body}</div>
          </div>
        ))
      ) : email.cleanedText ? (
        <div className="border rounded-lg p-3 md:p-4 bg-card">
          <div className="text-sm whitespace-pre-wrap text-foreground/80">{email.cleanedText}</div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('inbox_ops.no_email_content', 'No email content available')}</p>
      )}
    </div>
  )
}

export default function ProposalDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const proposalId = params?.id

  const [proposal, setProposal] = React.useState<ProposalDetail | null>(null)
  const [actions, setActions] = React.useState<ActionDetail[]>([])
  const [discrepancies, setDiscrepancies] = React.useState<DiscrepancyDetail[]>([])
  const [email, setEmail] = React.useState<EmailDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isProcessing, setIsProcessing] = React.useState(false)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'inbox-ops-proposal-detail',
  })
  const actionTypeLabels = useActionTypeLabels()
  const resolveDiscrepancyDescription = useDiscrepancyDescriptions()
  const [editingAction, setEditingAction] = React.useState<ActionDetail | null>(null)
  const [sendingReplyId, setSendingReplyId] = React.useState<string | null>(null)

  const [translation, setTranslation] = React.useState<ProposalTranslationEntry | null>(null)
  const [isTranslating, setIsTranslating] = React.useState(false)
  const [showTranslation, setShowTranslation] = React.useState(false)

  const handleEditAction = React.useCallback((action: ActionDetail) => {
    if (action.actionType === 'create_order' || action.actionType === 'create_quote') {
      const kind = action.actionType === 'create_order' ? 'order' : 'quote'
      try {
        sessionStorage.setItem(
          'inbox_ops.orderDraft',
          JSON.stringify({
            actionId: action.id,
            proposalId: action.proposalId,
            payload: action.payload,
          }),
        )
      } catch { /* sessionStorage unavailable */ }
      router.push(`/backend/sales/documents/create?kind=${kind}&fromInboxAction=${encodeURIComponent(action.id)}`)
      return
    }
    if (action.actionType === 'create_product') {
      try {
        sessionStorage.setItem(
          'inbox_ops.productDraft',
          JSON.stringify({
            actionId: action.id,
            proposalId: action.proposalId,
            payload: action.payload,
          }),
        )
      } catch { /* sessionStorage unavailable */ }
      router.push(`/backend/catalog/products/create?fromInboxAction=${encodeURIComponent(action.id)}`)
      return
    }
    setEditingAction(action)
  }, [router])

  const handleTranslate = React.useCallback(async () => {
    if (!proposalId) return
    setIsTranslating(true)
    const result = await runMutation({
      operation: () => apiCall<{ translation: ProposalTranslationEntry; cached: boolean }>(
        `/api/inbox_ops/proposals/${proposalId}/translate`,
        { method: 'POST', body: JSON.stringify({ targetLocale: locale }) },
      ),
      context: {},
    })
    if (result?.ok && result.result?.translation) {
      setTranslation(result.result.translation)
      setShowTranslation(true)
    } else {
      const detail = (result?.result as Record<string, unknown> | null)?.error
      flash(detail ? `${t('inbox_ops.translate.failed', 'Translation failed')}: ${detail}` : t('inbox_ops.translate.failed', 'Translation failed'), 'error')
    }
    setIsTranslating(false)
  }, [proposalId, locale, t, runMutation])

  const loadData = React.useCallback(async () => {
    if (!proposalId) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await apiCall<{
        proposal: ProposalDetail
        actions: ActionDetail[]
        discrepancies: DiscrepancyDetail[]
        email: EmailDetail
      }>(`/api/inbox_ops/proposals/${proposalId}`)
      if (result?.ok && result.result) {
        setProposal(result.result.proposal)
        setActions(result.result.actions || [])
        setDiscrepancies(result.result.discrepancies || [])
        setEmail(result.result.email)
      } else {
        setError(t('inbox_ops.flash.load_failed', 'Failed to load proposal'))
      }
    } catch {
      setError(t('inbox_ops.flash.load_failed', 'Failed to load proposal'))
    }
    setIsLoading(false)
  }, [proposalId, t])

  React.useEffect(() => { loadData() }, [loadData])

  const handleAcceptAction = React.useCallback(async (actionId: string) => {
    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; error?: string }>(
        `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}/accept`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.action_executed', 'Action executed'), 'success')
      await loadData()
    } else {
      flash(result?.result?.error || t('inbox_ops.flash.action_execute_failed', 'Failed to execute action'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, loadData, t, runMutation])

  const handleRejectAction = React.useCallback(async (actionId: string) => {
    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean }>(
        `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}/reject`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.action_rejected', 'Action rejected'), 'success')
      await loadData()
    } else {
      flash(t('inbox_ops.flash.action_reject_failed', 'Failed to reject action'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, loadData, runMutation])

  const handleAcceptAll = React.useCallback(async () => {
    const pendingActions = actions.filter((a) => a.status === 'pending')
    const pendingCount = pendingActions.length
    const nameIssueCount = pendingActions.filter((a) => hasContactNameIssue(a)).length

    const confirmText = nameIssueCount > 0
      ? t('inbox_ops.action.accept_all_confirm_with_skip', 'Execute {count} pending actions? {skipCount} contact actions will be skipped due to missing names.')
        .replace('{count}', String(pendingCount))
        .replace('{skipCount}', String(nameIssueCount))
      : t('inbox_ops.action.accept_all_confirm', 'Execute {count} pending actions?').replace('{count}', String(pendingCount))

    const confirmed = await confirm({
      title: t('inbox_ops.action.accept_all', 'Accept All'),
      text: confirmText,
    })
    if (!confirmed) return

    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; succeeded: number; failed: number }>(
        `/api/inbox_ops/proposals/${proposalId}/accept-all`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      const msg = result.result.failed > 0
        ? t('inbox_ops.flash.accept_all_partial', '{succeeded} actions executed, {failed} failed')
          .replace('{succeeded}', String(result.result.succeeded))
          .replace('{failed}', String(result.result.failed))
        : t('inbox_ops.flash.accept_all_success', '{succeeded} actions executed')
          .replace('{succeeded}', String(result.result.succeeded))
      flash(msg, 'success')
      await loadData()
    } else {
      flash(t('inbox_ops.flash.accept_all_failed', 'Failed to accept all actions'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, actions, confirm, t, loadData, runMutation])

  const handleRejectAll = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('inbox_ops.action.reject_all', 'Reject Proposal'),
      text: t('inbox_ops.action.reject_all_confirm', 'Reject all pending actions in this proposal?'),
    })
    if (!confirmed) return

    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean }>(
        `/api/inbox_ops/proposals/${proposalId}/reject`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.action.proposal_rejected', 'Proposal rejected'), 'success')
      await loadData()
    }
    setIsProcessing(false)
  }, [proposalId, confirm, t, loadData, runMutation])

  const handleRetryExtraction = React.useCallback(async () => {
    if (!email) return
    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean }>(
        `/api/inbox_ops/emails/${email.id}/reprocess`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.reprocessing_started', 'Reprocessing started'), 'success')
      await loadData()
    }
    setIsProcessing(false)
  }, [email, loadData, runMutation])

  const handleSendReply = React.useCallback(async (actionId: string) => {
    setSendingReplyId(actionId)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; error?: string }>(
        `/api/inbox_ops/proposals/${proposalId}/replies/${actionId}/send`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.reply.sent_success', 'Reply sent successfully'), 'success')
      await loadData()
    } else {
      flash(result?.result?.error || t('inbox_ops.flash.send_reply_failed', 'Failed to send reply'), 'error')
    }
    setSendingReplyId(null)
  }, [proposalId, t, loadData, runMutation])

  if (isLoading) return <LoadingMessage label={t('inbox_ops.loading_proposal', 'Loading proposal...')} />
  if (error) return <ErrorMessage label={error} />

  const pendingActions = actions.filter((a) => a.status === 'pending')
  const emailIsProcessing = email?.status === 'processing'
  const emailFailed = email?.status === 'failed'

  return (
    <Page>
      {ConfirmDialogElement}
      {editingAction && (
        <EditActionDialog
          action={editingAction}
          actionTypeLabels={actionTypeLabels}
          onClose={() => setEditingAction(null)}
          onSaved={loadData}
        />
      )}

      <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b bg-background">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <Link href="/backend/inbox-ops">
            <Button type="button" variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-base md:text-lg font-semibold truncate">{email?.subject || t('inbox_ops.proposal', 'Proposal')}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {email?.forwardedByName || email?.forwardedByAddress} · {email?.receivedAt && new Date(email.receivedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pendingActions.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={handleRejectAll}
              disabled={isProcessing}
            >
              <XCircle className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">{t('inbox_ops.action.reject_all', 'Reject Proposal')}</span>
            </Button>
          )}
          {pendingActions.length > 1 && (
            <Button type="button" size="sm" className="h-11 md:h-9" onClick={handleAcceptAll} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCheck className="h-4 w-4 mr-1" />}
              <span className="hidden md:inline">{t('inbox_ops.action.accept_all', 'Accept All')}</span>
            </Button>
          )}
        </div>
      </div>

      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {/* Left panel: Email Thread */}
          <div>
            <EmailThreadViewer email={email} />
          </div>

          {/* Right panel: Summary + Actions */}
          <div className="space-y-4">
            {emailIsProcessing ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                <p className="text-sm text-muted-foreground">{t('inbox_ops.extraction_loading', 'AI is analyzing this thread...')}</p>
              </div>
            ) : emailFailed ? (
              <div className="border rounded-lg p-4 bg-red-50 dark:bg-red-950/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  <span className="text-sm font-medium text-red-700">{t('inbox_ops.extraction_failed', 'Extraction failed')}</span>
                </div>
                {email?.processingError && (
                  <p className="text-xs text-red-600 mb-3">{email.processingError}</p>
                )}
                <Button type="button" size="sm" variant="outline" onClick={handleRetryExtraction} disabled={isProcessing}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {t('inbox_ops.action.retry', 'Retry')}
                </Button>
              </div>
            ) : proposal ? (
              <>
                {/* Summary */}
                <div className="border rounded-lg p-3 md:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm">{t('inbox_ops.summary', 'Summary')}</h3>
                    {(proposal.workingLanguage || 'en') !== locale && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={showTranslation ? () => setShowTranslation(false) : handleTranslate}
                        disabled={isTranslating}
                      >
                        {isTranslating ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Languages className="h-3 w-3 mr-1" />
                        )}
                        {showTranslation
                          ? t('inbox_ops.translate.show_original', 'Show original')
                          : t('inbox_ops.translate.translate', 'Translate')}
                      </Button>
                    )}
                  </div>
                  <p className="text-sm text-foreground/80 mb-3">
                    {showTranslation && translation ? translation.summary : proposal.summary}
                  </p>

                  <div className="flex items-center gap-4 mb-3">
                    <div>
                      <span className="text-xs text-muted-foreground">{t('inbox_ops.confidence', 'Confidence')}</span>
                      <ConfidenceBadge value={proposal.confidence} />
                    </div>
                  </div>

                  {proposal.possiblyIncomplete && (
                    <div className="flex items-center gap-2 text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-950/20 rounded px-2 py-1 mb-3">
                      <AlertTriangle className="h-3 w-3" />
                      {t('inbox_ops.possibly_incomplete', 'This thread appears to be a partial forward')}
                    </div>
                  )}

                  {/* Participants */}
                  {proposal.participants.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">{t('inbox_ops.participants', 'Participants')}</h4>
                      <div className="space-y-1">
                        {proposal.participants.map((p, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <Users className="h-3 w-3 text-muted-foreground" />
                            <span>{p.name}</span>
                            <span className="text-xs text-muted-foreground">({p.role})</span>
                            {p.matchedContactId && <CheckCircle className="h-3 w-3 text-green-500" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Discrepancies not tied to a specific action */}
                {(() => {
                  const actionIds = new Set(actions.map((a) => a.id))
                  const general = discrepancies.filter((d) => !d.resolved && (!d.actionId || !actionIds.has(d.actionId)))
                  if (general.length === 0) return null
                  return (
                    <div className="border rounded-lg p-3 md:p-4 bg-yellow-50 dark:bg-yellow-950/20">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <h3 className="font-semibold text-sm text-yellow-800 dark:text-yellow-300">{t('inbox_ops.discrepancies', 'Issues Detected')}</h3>
                      </div>
                      <div className="space-y-1.5">
                        {general.map((d) => (
                          <div key={d.id} className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
                            d.severity === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-950/30' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30'
                          }`}>
                            <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <div>
                              <span>{resolveDiscrepancyDescription(d.description, d.foundValue)}</span>
                              {(d.expectedValue || d.foundValue) && (
                                <div className="mt-0.5 text-[11px] opacity-80">
                                  {d.expectedValue && <span>{t('inbox_ops.discrepancy.expected', 'Expected')}: {d.expectedValue}</span>}
                                  {d.expectedValue && d.foundValue && <span> · </span>}
                                  {d.foundValue && <span>{t('inbox_ops.discrepancy.found', 'Found')}: {d.foundValue}</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* Actions */}
                <div>
                  <h3 className="font-semibold text-sm mb-2">{t('inbox_ops.actions', 'Proposed Actions')}</h3>
                  {actions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('inbox_ops.no_actions', 'No actionable items detected in this thread')}</p>
                  ) : (
                    <div className="space-y-3">
                      {actions.map((action) => (
                        <div key={action.id}>
                          <ActionCard
                            action={action}
                            discrepancies={discrepancies}
                            actionTypeLabels={actionTypeLabels}
                            onAccept={handleAcceptAction}
                            onReject={handleRejectAction}
                            onRetry={handleAcceptAction}
                            onEdit={handleEditAction}
                            translatedDescription={showTranslation ? translation?.actions[action.id] : undefined}
                            resolveDiscrepancyDescription={resolveDiscrepancyDescription}
                          />
                          {action.actionType === 'draft_reply' && (action.status === 'executed' || action.status === 'accepted') && (
                            <div className="mt-2 pl-7">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-11 md:h-9"
                                disabled={sendingReplyId === action.id}
                                onClick={() => handleSendReply(action.id)}
                              >
                                {sendingReplyId === action.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                ) : (
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                )}
                                {sendingReplyId === action.id
                                  ? t('inbox_ops.reply.sending', 'Sending...')
                                  : t('inbox_ops.reply.send', 'Send Reply')}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
