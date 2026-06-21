"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ProposalCard, type DisposeKind } from '../../../components/ProposalCard'
import { AgentIoDrawer } from '../../../components/AgentIoDrawer'
import {
  mapProposal,
  mapRun,
  type ProposalView,
  type RunView,
} from '../../../components/types'

type ProposalsResponse = { items?: Array<Record<string, unknown>> }
type RunsResponse = { items?: Array<Record<string, unknown>> }

type PageState = 'loading' | 'notFound' | 'error' | 'ready'

export default function AgentProposalDetailPage({ params }: { params?: { proposalId?: string } }) {
  const t = useT()
  const router = useRouter()
  const proposalId = params?.proposalId ?? ''

  const [state, setState] = React.useState<PageState>('loading')
  const [proposal, setProposal] = React.useState<ProposalView | null>(null)
  const [run, setRun] = React.useState<RunView | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    proposalId: string
    data: ProposalView | null
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: `agent_orchestrator.proposal:${proposalId}`,
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setState('loading')
      try {
        const data = await readApiResultOrThrow<ProposalsResponse>(
          `/api/agent_orchestrator/proposals?id=${encodeURIComponent(proposalId)}`,
        )
        if (cancelled) return
        const items = Array.isArray(data.items) ? data.items : []
        const mapped = items[0] ? mapProposal(items[0] as Record<string, unknown>) : null
        if (!mapped) {
          setState('notFound')
          return
        }
        setProposal(mapped)
        // Best-effort load of the originating run for the I/O drawer.
        try {
          const runData = await readApiResultOrThrow<RunsResponse>(
            `/api/agent_orchestrator/runs?id=${encodeURIComponent(mapped.runId)}`,
          )
          if (!cancelled) {
            const runItems = Array.isArray(runData.items) ? runData.items : []
            setRun(runItems[0] ? mapRun(runItems[0] as Record<string, unknown>) : null)
          }
        } catch {
          if (!cancelled) setRun(null)
        }
        if (!cancelled) setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    }
    if (proposalId) load()
    else setState('notFound')
    return () => {
      cancelled = true
    }
  }, [proposalId, reloadToken])

  const dispose = React.useCallback(
    async (disposition: DisposeKind, payload?: unknown, reason?: string) => {
      if (!proposal) return
      setBusy(true)
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(
              buildOptimisticLockHeader(proposal.updatedAt),
              () =>
                apiCallOrThrow(
                  `/api/agent_orchestrator/proposals/${encodeURIComponent(proposalId)}/dispose`,
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ disposition, payload, reason }),
                  },
                ),
            ),
          context: { proposalId, data: proposal, retryLastMutation },
          mutationPayload: { disposition },
        })
        const successKey =
          disposition === 'approved'
            ? 'agent_orchestrator.proposal.flash.approved'
            : disposition === 'edited'
              ? 'agent_orchestrator.proposal.flash.edited'
              : 'agent_orchestrator.proposal.flash.rejected'
        flash(t(successKey), 'success')
        router.push('/backend/caseload')
      } catch (err) {
        // useGuardedMutation already surfaces 409 conflicts on the shared bar;
        // call again defensively in case a future caller suppresses it, then
        // fall back to a flash for non-conflict errors.
        if (!surfaceRecordConflict(err, t)) {
          const message = err instanceof Error ? err.message : t('agent_orchestrator.proposal.flash.error')
          flash(message, 'error')
        }
      } finally {
        setBusy(false)
      }
    },
    [proposal, proposalId, retryLastMutation, router, runMutation, t],
  )

  if (state === 'loading') {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.proposal.title')} />
        </PageBody>
      </Page>
    )
  }

  if (state === 'notFound') {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('agent_orchestrator.proposal.notFound')}
            description={t('agent_orchestrator.proposal.notFoundDescription')}
            backHref="/backend/caseload"
            backLabel={t('agent_orchestrator.proposal.backToCaseload')}
          />
        </PageBody>
      </Page>
    )
  }

  if (state === 'error' || !proposal) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={t('agent_orchestrator.proposal.error')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{t('agent_orchestrator.proposal.title')}</h1>
          <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/caseload')}>
            {t('agent_orchestrator.proposal.backToCaseload')}
          </Button>
        </div>

        <ProposalCard
          proposal={proposal}
          onInspect={() => setDrawerOpen(true)}
          actions={{
            canDispose: true,
            busy,
            onApprove: () => dispose('approved'),
            onEdit: (payload, reason) => dispose('edited', payload, reason),
            onReject: (reason) => dispose('rejected', undefined, reason),
          }}
        />
      </PageBody>

      <AgentIoDrawer open={drawerOpen} onOpenChange={setDrawerOpen} run={run} />
    </Page>
  )
}
