"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Bot, ExternalLink } from 'lucide-react'
import { ProposedFields, ReasoningList } from '../../../components/ProposalFacts'
import { formatConfidence } from '../../../components/types'

/**
 * The proposal draft card on a disposition task (spec §7.6).
 *
 * "A pending proposal renders as a draft card with the would-be mutation; one
 * click to the agent run trace." The workflows task page can only walk a task's
 * `formSchema` generically, so without this an operator is asked to approve a
 * key/value dump. Here the SAME `ProposedFields` renderer the caseload uses
 * shows the mutation, next to the confidence the threshold was compared
 * against and a link to the run that produced it.
 *
 * Read-only on purpose: the verdict is taken in the caseload, which owns the
 * optimistic lock, the edit payload and the mandatory reason. This card links
 * there rather than growing a second dispose path.
 */

type TaskContext = {
  taskId?: string
  formSchema?: unknown
  formData?: unknown
}

type DraftProposal = {
  id: string
  runId?: string | null
  payload?: unknown
  confidence?: number | null
  disposition?: string | null
}

type ProposalResponse = { items?: DraftProposal[] }

function readProposalId(context: TaskContext): string | null {
  for (const source of [context.formSchema, context.formData]) {
    if (!source || typeof source !== 'object') continue
    const record = source as Record<string, unknown>
    const candidate = record.proposalId ?? record.proposal_id
    if (typeof candidate === 'string' && candidate.length) return candidate
  }
  return null
}

export default function TaskProposalDraftWidget({ context }: InjectionWidgetComponentProps) {
  const t = useT()
  const router = useRouter()
  const proposalId = readProposalId((context ?? {}) as TaskContext)

  const [loading, setLoading] = React.useState(false)
  const [proposal, setProposal] = React.useState<DraftProposal | null>(null)

  React.useEffect(() => {
    if (!proposalId) {
      setProposal(null)
      return
    }
    let cancelled = false
    setLoading(true)
    apiCall<ProposalResponse>(
      `/api/agent_orchestrator/proposals?id=${encodeURIComponent(proposalId)}`,
      undefined,
      { fallback: { items: [] } },
    )
      .then((result) => {
        if (cancelled) return
        const items = result.ok && Array.isArray(result.result?.items) ? result.result.items : []
        setProposal(items.find((item) => item.id === proposalId) ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [proposalId])

  // Not an agent task, or the caller cannot read proposals (the route 403s and
  // `apiCall` falls back): render nothing rather than an empty card.
  if (!proposalId) return null
  if (loading) {
    return (
      <div className="rounded-lg border border-border p-4">
        <Spinner />
      </div>
    )
  }
  if (!proposal) return null

  return (
    <div className="rounded-lg border border-border p-4 space-y-3" data-testid="task-proposal-draft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Bot className="size-4" aria-hidden="true" />
          {t('agent_orchestrator.userTaskProposal.draftTitle')}
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {t('agent_orchestrator.userTaskProposal.draftConfidence')}: {formatConfidence(proposal.confidence ?? null)}
          </Badge>
          {proposal.runId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push(`/backend/traces/${encodeURIComponent(proposal.runId as string)}`)}
            >
              <ExternalLink className="size-3.5 mr-1" aria-hidden="true" />
              {t('agent_orchestrator.proposal.openTrace')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push(`/backend/caseload/${encodeURIComponent(proposalId)}`)}
          >
            {t('agent_orchestrator.userTaskProposal.reviewProposal')}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t('agent_orchestrator.userTaskProposal.draftDescription')}</p>

      <ProposedFields payload={proposal.payload} />
      <ReasoningList
        rationale={
          proposal.payload && typeof proposal.payload === 'object'
            ? ((proposal.payload as { rationale?: string | null }).rationale ?? null)
            : null
        }
        input={null}
        guardResults={[]}
      />
    </div>
  )
}
