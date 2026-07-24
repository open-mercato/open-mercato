"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Activity, FlaskConical, LayoutGrid, SlidersHorizontal } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import {
  mapAgentDetail,
  mapAgentWindowMetrics,
  formatNumber,
  type AgentDetailView,
  type SkillDetailView,
  type AgentWindowMetricsView,
} from '../../../components/types'
import { SkillDrawer } from '../../../components/SkillDrawer'
import { AgentHeaderCard, ICON_DEFAULT } from './components/AgentHeaderCard'
import { AgentConfigDrawer } from './components/AgentConfigDrawer'
import { OverviewTab } from './components/OverviewTab'
import { ActivityTab } from './components/ActivityTab'
import { ConfigurationTab } from './components/ConfigurationTab'
import EvaluationTab from './components/EvaluationTab'
import { computeAgentMetrics, type Autonomy, type WorkspaceTab } from './components/workspaceShared'

type PageState = 'loading' | 'notFound' | 'forbidden' | 'error' | 'ready'
type EvalSection = 'assertions' | 'cases' | 'runs'

const TAB_IDS: WorkspaceTab[] = ['overview', 'activity', 'evaluation', 'configuration']

async function fetchItems(path: string): Promise<Array<Record<string, unknown>>> {
  const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(path, undefined, { fallback: { items: [] } })
  if (!call.ok || !Array.isArray(call.result?.items)) return []
  return call.result.items
}

export default function AgentDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const agentId = params?.id ?? ''

  const initialTab = ((): WorkspaceTab => {
    const raw = searchParams?.get('tab')
    return raw && (TAB_IDS as string[]).includes(raw) ? (raw as WorkspaceTab) : 'overview'
  })()
  const initialSection = ((): EvalSection => {
    const raw = searchParams?.get('section')
    return raw === 'assertions' || raw === 'cases' || raw === 'runs' ? raw : 'assertions'
  })()

  const [state, setState] = React.useState<PageState>('loading')
  const [agent, setAgent] = React.useState<AgentDetailView | null>(null)
  const [runs, setRuns] = React.useState<Array<Record<string, unknown>>>([])
  const [proposals, setProposals] = React.useState<Array<Record<string, unknown>>>([])
  const [activeSkill, setActiveSkill] = React.useState<SkillDetailView | null>(null)
  const [autonomy, setAutonomy] = React.useState<Autonomy>('review')
  const [configOpen, setConfigOpen] = React.useState(false)
  const [windowMetrics, setWindowMetrics] = React.useState<AgentWindowMetricsView | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)
  const [activeTab, setActiveTab] = React.useState<WorkspaceTab>(initialTab)
  const [evalSection, setEvalSection] = React.useState<EvalSection>(initialSection)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setState('loading')
      const call = await apiCall<Record<string, unknown>>(`/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}`)
      if (cancelled) return
      if (!call.ok) {
        if (call.status === 404) setState('notFound')
        else if (call.status === 403) setState('forbidden')
        else setState('error')
        return
      }
      const mapped = call.result ? mapAgentDetail(call.result) : null
      if (!mapped) {
        setState('notFound')
        return
      }
      // UI heuristic until the backend exposes a real autonomy setting.
      setAutonomy(mapped.resultKind === 'informative' ? 'auto' : 'review')
      const [runItems, proposalItems, metricsCall] = await Promise.all([
        fetchItems(`/api/agent_orchestrator/runs?agentId=${encodeURIComponent(agentId)}&pageSize=100`),
        fetchItems(`/api/agent_orchestrator/proposals?agentId=${encodeURIComponent(agentId)}&pageSize=100`),
        apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/agent_orchestrator/metrics/agents?window=7d&ids=${encodeURIComponent(agentId)}`,
          undefined,
          { fallback: { items: [] } },
        ),
      ])
      if (cancelled) return
      setAgent(mapped)
      setRuns(runItems)
      setProposals(proposalItems)
      const metricsItem =
        metricsCall.ok && Array.isArray(metricsCall.result?.items) && metricsCall.result.items[0]
          ? mapAgentWindowMetrics(metricsCall.result.items[0] as Record<string, unknown>)
          : null
      setWindowMetrics(metricsItem)
      setState('ready')
    }
    if (agentId) load()
    else setState('notFound')
    return () => {
      cancelled = true
    }
  }, [agentId, reloadKey])

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.agents.detail',
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })
  const [savingIcon, setSavingIcon] = React.useState(false)

  const updateIcon = React.useCallback(
    async (value: string) => {
      if (!agent) return
      const nextIcon = value === ICON_DEFAULT ? null : value
      if (nextIcon === (agent.icon ?? null)) return
      setSavingIcon(true)
      try {
        let saved: { icon: string | null; updatedAt: string } | null = null
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(agent.iconUpdatedAt), async () => {
              const call = await apiCallOrThrow<{ icon: string | null; updatedAt: string }>(
                `/api/agent_orchestrator/agents/${encodeURIComponent(agent.id)}/settings`,
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ icon: nextIcon, updatedAt: agent.iconUpdatedAt }),
                },
              )
              saved = call.result ?? null
            }),
          context: { retryLastMutation },
          mutationPayload: { icon: nextIcon },
        })
        setAgent((prev) =>
          prev && saved ? { ...prev, icon: saved.icon as AgentDetailView['icon'], iconUpdatedAt: saved.updatedAt } : prev,
        )
        flash(t('agent_orchestrator.agentDetail.icon.saved', 'Icon updated'), 'success')
      } catch (err) {
        if (surfaceRecordConflict(err, t)) {
          setReloadKey((key) => key + 1)
          return
        }
        flash(err instanceof Error ? err.message : t('agent_orchestrator.agentDetail.icon.error', 'Could not update icon'), 'error')
      } finally {
        setSavingIcon(false)
      }
    },
    [agent, runMutation, retryLastMutation, t],
  )

  const metrics = React.useMemo(() => computeAgentMetrics(runs, proposals), [runs, proposals])

  const selectTab = React.useCallback((tab: WorkspaceTab, section?: EvalSection) => {
    setActiveTab(tab)
    if (section) setEvalSection(section)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', tab)
      if (tab === 'evaluation' && section) url.searchParams.set('section', section)
      else url.searchParams.delete('section')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [])

  if (state === 'loading') {
    return <Page><PageBody><LoadingMessage label={t('agent_orchestrator.agentDetail.title')} /></PageBody></Page>
  }
  if (state === 'notFound' || state === 'forbidden') {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={state === 'forbidden' ? t('agent_orchestrator.agentDetail.forbidden') : t('agent_orchestrator.agentDetail.notFound')}
            description={state === 'forbidden' ? t('agent_orchestrator.agentDetail.forbiddenDescription') : t('agent_orchestrator.agentDetail.notFoundDescription')}
            backHref="/backend/agents"
            backLabel={t('agent_orchestrator.agentDetail.back')}
          />
        </PageBody>
      </Page>
    )
  }
  if (state === 'error' || !agent) {
    return <Page><PageBody><ErrorMessage label={t('agent_orchestrator.agentDetail.error')} /></PageBody></Page>
  }

  return (
    <Page>
      <PageBody className="space-y-4">
        <AgentHeaderCard
          agent={agent}
          metrics={metrics}
          windowMetrics={windowMetrics}
          autonomy={autonomy}
          savingIcon={savingIcon}
          onIconChange={updateIcon}
          onConfigure={() => setConfigOpen(true)}
        />

        <Tabs value={activeTab} onValueChange={(value) => selectTab(value as WorkspaceTab)} variant="underline">
          <TabsList>
            <TabsTrigger value="overview" leading={<LayoutGrid className="size-4" />}>
              {t('agent_orchestrator.agentDetail.tabs.overview', 'Overview')}
            </TabsTrigger>
            <TabsTrigger value="activity" leading={<Activity className="size-4" />} count={metrics.runCount > 0 ? formatNumber(metrics.runCount, locale) : undefined}>
              {t('agent_orchestrator.agentDetail.tabs.activity', 'Activity')}
            </TabsTrigger>
            <TabsTrigger value="evaluation" leading={<FlaskConical className="size-4" />}>
              {t('agent_orchestrator.agentDetail.tabs.evaluation', 'Evaluation')}
            </TabsTrigger>
            <TabsTrigger value="configuration" leading={<SlidersHorizontal className="size-4" />}>
              {t('agent_orchestrator.agentDetail.tabs.configuration', 'Configuration')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-4">
            <OverviewTab agentId={agent.id} metrics={metrics} runs={runs} active={activeTab === 'overview'} onNavigate={selectTab} />
          </TabsContent>
          <TabsContent value="activity" className="pt-4">
            <ActivityTab runs={runs} proposals={proposals} />
          </TabsContent>
          <TabsContent value="evaluation" className="pt-4">
            <EvaluationTab agentId={agent.id} agentLabel={agent.label || agent.id} active={activeTab === 'evaluation'} initialSection={evalSection} />
          </TabsContent>
          <TabsContent value="configuration" className="pt-4">
            <ConfigurationTab agent={agent} onSkillClick={setActiveSkill} />
          </TabsContent>
        </Tabs>

        <SkillDrawer open={!!activeSkill} onOpenChange={(open) => { if (!open) setActiveSkill(null) }} skill={activeSkill} />
        <AgentConfigDrawer open={configOpen} onOpenChange={setConfigOpen} agent={agent} autonomy={autonomy} />
      </PageBody>
    </Page>
  )
}
