"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Pencil,
  AlertTriangle,
  CheckCheck,
  Loader2,
  ExternalLink,
  RefreshCw,
  Package,
  Users,
  FileText,
  MessageSquare,
  Truck,
  UserPlus,
  Link2,
  Activity,
} from 'lucide-react'
import type { ThreadMessage, ExtractedParticipant, InboxActionType, InboxDiscrepancyType } from '../../../../data/entities'

type ProposalDetail = {
  id: string
  summary: string
  confidence: string
  status: string
  participants: ExtractedParticipant[]
  possiblyIncomplete: boolean
  llmModel?: string
  createdAt: string
}

type ActionDetail = {
  id: string
  proposalId: string
  sortOrder: number
  actionType: InboxActionType
  description: string
  payload: Record<string, unknown>
  status: string
  confidence: string
  requiredFeature?: string
  createdEntityId?: string
  createdEntityType?: string
  executionError?: string
  executedAt?: string
}

type DiscrepancyDetail = {
  id: string
  type: InboxDiscrepancyType
  severity: string
  description: string
  expectedValue?: string
  foundValue?: string
  resolved: boolean
  actionId?: string
}

type EmailDetail = {
  id: string
  subject: string
  forwardedByAddress: string
  forwardedByName?: string
  cleanedText?: string
  threadMessages?: ThreadMessage[]
  status: string
  processingError?: string
  receivedAt: string
}

const ACTION_TYPE_ICONS: Record<string, React.ElementType> = {
  create_order: Package,
  create_quote: FileText,
  update_order: Package,
  update_shipment: Truck,
  create_contact: UserPlus,
  link_contact: Link2,
  log_activity: Activity,
  draft_reply: MessageSquare,
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  create_order: 'Create Sales Order',
  create_quote: 'Create Quote',
  update_order: 'Update Order',
  update_shipment: 'Update Shipment',
  create_contact: 'Create Contact',
  link_contact: 'Link Contact',
  log_activity: 'Log Activity',
  draft_reply: 'Draft Reply',
}

function ConfidenceBadge({ value }: { value: string }) {
  const num = parseFloat(value)
  const pct = Math.round(num * 100)
  const color = num >= 0.8 ? 'text-green-600' : num >= 0.6 ? 'text-yellow-600' : 'text-red-600'
  const bgColor = num >= 0.8 ? 'bg-green-200' : num >= 0.6 ? 'bg-yellow-200' : 'bg-red-200'
  const width = Math.round(num * 100)
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-medium ${color}`}>{pct}%</span>
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${bgColor} rounded-full`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function EmailThreadViewer({ email }: { email: EmailDetail | null }) {
  if (!email) return null

  const messages = email.threadMessages || []

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm">Email Thread</h3>
      {messages.length > 0 ? (
        messages.map((msg, index) => (
          <div key={index} className="border rounded-lg p-3 md:p-4 bg-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {msg.from?.name || msg.from?.email || 'Unknown'}
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
        <p className="text-sm text-muted-foreground">No email content available</p>
      )}
    </div>
  )
}

function ActionCard({
  action,
  discrepancies,
  onAccept,
  onReject,
  onRetry,
}: {
  action: ActionDetail
  discrepancies: DiscrepancyDetail[]
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onRetry: (id: string) => void
}) {
  const t = useT()
  const Icon = ACTION_TYPE_ICONS[action.actionType] || Package
  const label = ACTION_TYPE_LABELS[action.actionType] || action.actionType

  const actionDiscrepancies = discrepancies.filter((d) => d.actionId === action.id && !d.resolved)

  if (action.status === 'executed') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-green-50 dark:bg-green-950/20">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <p className="text-sm text-muted-foreground">{action.description}</p>
        {action.createdEntityId && (
          <div className="mt-2">
            <span className="text-xs text-green-600">
              Created {action.createdEntityType} · {action.executedAt && new Date(action.executedAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (action.status === 'rejected') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-muted/50 opacity-60">
        <div className="flex items-center gap-2 mb-2">
          <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium line-through">{label}</span>
          <span className="text-xs text-muted-foreground">Rejected</span>
        </div>
        <p className="text-sm text-muted-foreground">{action.description}</p>
      </div>
    )
  }

  if (action.status === 'failed') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-red-50 dark:bg-red-950/20">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-red-600">{t('inbox_ops.extraction_failed', 'Failed')}</span>
        </div>
        <p className="text-sm text-muted-foreground">{action.description}</p>
        {action.executionError && (
          <p className="text-xs text-red-600 mt-1">{action.executionError}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onRetry(action.id)}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.retry', 'Retry')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onReject(action.id)}
          >
            <XCircle className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.reject', 'Reject')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="border rounded-lg p-3 md:p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-5 w-5 text-primary flex-shrink-0" />
        <span className="text-sm font-medium">{label}</span>
        <ConfidenceBadge value={action.confidence} />
      </div>
      <p className="text-sm text-foreground/80 mb-3">{action.description}</p>

      {actionDiscrepancies.length > 0 && (
        <div className="mb-3 space-y-1">
          {actionDiscrepancies.map((d) => (
            <div key={d.id} className={`flex items-start gap-2 text-xs rounded px-2 py-1 ${
              d.severity === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-950/20' : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20'
            }`}>
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>{d.description}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-11 md:h-9"
          onClick={() => onAccept(action.id)}
        >
          <CheckCircle className="h-4 w-4 mr-1" />
          {t('inbox_ops.action.accept', 'Accept')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-9"
          onClick={() => onReject(action.id)}
        >
          <XCircle className="h-4 w-4 mr-1" />
          {t('inbox_ops.action.reject', 'Reject')}
        </Button>
      </div>
    </div>
  )
}

export default function ProposalDetailPage() {
  const t = useT()
  const router = useRouter()
  const params = useParams()
  const proposalId = params?.id as string

  const [proposal, setProposal] = React.useState<ProposalDetail | null>(null)
  const [actions, setActions] = React.useState<ActionDetail[]>([])
  const [discrepancies, setDiscrepancies] = React.useState<DiscrepancyDetail[]>([])
  const [email, setEmail] = React.useState<EmailDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isProcessing, setIsProcessing] = React.useState(false)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const loadData = React.useCallback(async () => {
    if (!proposalId) return
    setIsLoading(true)
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
    }
    setIsLoading(false)
  }, [proposalId])

  React.useEffect(() => { loadData() }, [loadData])

  const handleAcceptAction = React.useCallback(async (actionId: string) => {
    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean; error?: string }>(
      `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}/accept`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash('Action executed', 'success')
      await loadData()
    } else {
      flash(result?.result?.error || 'Failed to execute action', 'error')
    }
    setIsProcessing(false)
  }, [proposalId, loadData])

  const handleRejectAction = React.useCallback(async (actionId: string) => {
    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean }>(
      `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}/reject`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash('Action rejected', 'success')
      await loadData()
    } else {
      flash('Failed to reject action', 'error')
    }
    setIsProcessing(false)
  }, [proposalId, loadData])

  const handleAcceptAll = React.useCallback(async () => {
    const pendingCount = actions.filter((a) => a.status === 'pending').length
    const confirmed = await confirm({
      title: t('inbox_ops.action.accept_all', 'Accept All'),
      text: t('inbox_ops.action.accept_all_confirm', `Execute ${pendingCount} pending actions?`).replace('{count}', String(pendingCount)),
    })
    if (!confirmed) return

    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean; succeeded: number; failed: number }>(
      `/api/inbox_ops/proposals/${proposalId}/accept-all`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash(`${result.result.succeeded} actions executed${result.result.failed > 0 ? `, ${result.result.failed} failed` : ''}`, 'success')
      await loadData()
    } else {
      flash('Failed to accept all actions', 'error')
    }
    setIsProcessing(false)
  }, [proposalId, actions, confirm, t, loadData])

  const handleRejectAll = React.useCallback(async () => {
    const confirmed = await confirm({
      title: 'Reject Proposal',
      text: 'Reject all pending actions in this proposal?',
    })
    if (!confirmed) return

    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean }>(
      `/api/inbox_ops/proposals/${proposalId}/reject`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash('Proposal rejected', 'success')
      await loadData()
    }
    setIsProcessing(false)
  }, [proposalId, confirm, loadData])

  const handleRetryExtraction = React.useCallback(async () => {
    if (!email) return
    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean }>(
      `/api/inbox_ops/emails/${email.id}/reprocess`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash('Reprocessing started', 'success')
      await loadData()
    }
    setIsProcessing(false)
  }, [email, loadData])

  if (isLoading) return <LoadingMessage label="Loading proposal..." />

  const pendingActions = actions.filter((a) => a.status === 'pending')
  const emailIsProcessing = email?.status === 'processing'
  const emailFailed = email?.status === 'failed'

  return (
    <Page>
      {ConfirmDialogElement}

      <div className="flex items-center justify-between px-3 py-3 md:px-6 md:py-4 border-b">
        <div className="flex items-center gap-3">
          <Link href="/backend/inbox-ops">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">{email?.subject || 'Proposal'}</h1>
            <p className="text-xs text-muted-foreground">
              {email?.forwardedByName || email?.forwardedByAddress} · {email?.receivedAt && new Date(email.receivedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pendingActions.length > 1 && (
            <Button size="sm" className="h-11 md:h-9" onClick={handleAcceptAll} disabled={isProcessing}>
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
                <Button size="sm" variant="outline" onClick={handleRetryExtraction} disabled={isProcessing}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {t('inbox_ops.action.retry', 'Retry')}
                </Button>
              </div>
            ) : proposal ? (
              <>
                {/* Summary */}
                <div className="border rounded-lg p-3 md:p-4">
                  <h3 className="font-semibold text-sm mb-2">{t('inbox_ops.summary', 'Summary')}</h3>
                  <p className="text-sm text-foreground/80 mb-3">{proposal.summary}</p>

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

                {/* Actions */}
                <div>
                  <h3 className="font-semibold text-sm mb-2">{t('inbox_ops.actions', 'Proposed Actions')}</h3>
                  {actions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('inbox_ops.no_actions', 'No actionable items detected in this thread')}</p>
                  ) : (
                    <div className="space-y-3">
                      {actions.map((action) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          discrepancies={discrepancies}
                          onAccept={handleAcceptAction}
                          onReject={handleRejectAction}
                          onRetry={handleAcceptAction}
                        />
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
