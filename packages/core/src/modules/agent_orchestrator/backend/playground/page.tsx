"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { SectionHeader, CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ProposalCard } from '../../components/ProposalCard'
import { mapAgent, type AgentView } from '../../components/types'

type AgentsResponse = { items?: Array<Record<string, unknown>> }

type AgentResult =
  | { kind: 'informative'; data: unknown }
  | { kind: 'actionable'; proposal: { actions: unknown[]; confidence?: number; rationale?: string } }

/**
 * Per-agent example inputs surfaced via the "Insert sample" button. Keyed by the
 * stable agent id; the demo `deals.health_check` agent accepts an inline `deal`
 * (no DB lookup, deterministic in the playground) or a `dealId`.
 */
const SAMPLE_INPUTS: Record<string, unknown> = {
  'deals.health_check': {
    deal: {
      id: 'demo-deal-1',
      name: 'Acme Corp — Enterprise plan',
      stage: 'Proposal',
      value: 48000,
      probability: 0.65,
      daysInStage: 12,
      recentActivity: 'Sent revised pricing; awaiting procurement sign-off.',
    },
  },
}

export default function AgentPlaygroundPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const [agents, setAgents] = React.useState<AgentView[]>([])
  const [agentId, setAgentId] = React.useState<string>('')
  const [input, setInput] = React.useState<string>('{\n  \n}')
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<AgentResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      const call = await apiCall<AgentsResponse>('/api/agent_orchestrator/agents', undefined, {
        fallback: { items: [] },
      })
      if (cancelled || !call.ok) return
      const items = Array.isArray(call.result?.items) ? call.result!.items : []
      const mapped = items
        .map((item) => mapAgent(item as Record<string, unknown>))
        .filter((agent): agent is AgentView => !!agent)
      setAgents(mapped)
      const requested = searchParams?.get('agent')
      if (requested && mapped.some((agent) => agent.id === requested)) {
        setAgentId(requested)
      } else if (mapped[0]) {
        setAgentId(mapped[0].id)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [searchParams])

  const selectedAgent = React.useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? null,
    [agents, agentId],
  )

  const sampleInput = React.useMemo(
    () => (agentId && agentId in SAMPLE_INPUTS ? SAMPLE_INPUTS[agentId] : undefined),
    [agentId],
  )

  const run = React.useCallback(async () => {
    if (!agentId) {
      setError(t('agent_orchestrator.playground.selectAgentFirst'))
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(input)
    } catch {
      setError(t('agent_orchestrator.playground.invalidJson'))
      return
    }
    setError(null)
    setRunning(true)
    setResult(null)
    try {
      const data = await readApiResultOrThrow<AgentResult>(
        `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/run`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: parsed }),
        },
      )
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agent_orchestrator.playground.error'))
    } finally {
      setRunning(false)
    }
  }, [agentId, input, t])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void run()
      }
    },
    [run],
  )

  return (
    <Page>
      <PageBody className="max-w-3xl space-y-5" onKeyDown={handleKeyDown}>
        <div>
          <h1 className="text-lg font-semibold">{t('agent_orchestrator.playground.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('agent_orchestrator.playground.subtitle')}</p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="ao-pg-agent">
            {t('agent_orchestrator.playground.agentLabel')}
          </label>
          <Select value={agentId} onValueChange={(value) => setAgentId(value ?? '')}>
            <SelectTrigger id="ao-pg-agent" className="focus-visible:ring-brand-violet">
              <SelectValue placeholder={t('agent_orchestrator.playground.agentPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedAgent?.description ? (
            <p className="text-xs text-muted-foreground">{selectedAgent.description}</p>
          ) : null}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium" htmlFor="ao-pg-input">
              {t('agent_orchestrator.playground.inputLabel')}
            </label>
            {sampleInput ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setInput(JSON.stringify(sampleInput, null, 2))}
              >
                {t('agent_orchestrator.playground.insertSample')}
              </Button>
            ) : null}
          </div>
          <Textarea
            id="ao-pg-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('agent_orchestrator.playground.inputPlaceholder')}
            rows={8}
            className="font-mono"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={() => void run()}
            disabled={running || !agentId}
            className="bg-brand-violet text-white hover:bg-brand-violet/90"
          >
            {running ? t('agent_orchestrator.playground.running') : t('agent_orchestrator.playground.run')}
          </Button>
          {running ? <Spinner className="text-brand-violet" /> : null}
        </div>

        {error ? (
          <Alert status="error" style="light">
            {error}
          </Alert>
        ) : null}

        {/* Result */}
        {!result && !running && !error ? (
          <EmptyState
            title={t('agent_orchestrator.playground.noRun')}
            description={t('agent_orchestrator.playground.noRunDescription')}
          />
        ) : null}

        {result?.kind === 'actionable' ? (
          <div className="space-y-2">
            <ProposalCard
              adHoc={{
                agentId,
                confidence: typeof result.proposal.confidence === 'number' ? result.proposal.confidence : null,
                payload: result.proposal.actions,
                rationale: result.proposal.rationale ?? null,
              }}
            />
            <a
              href="/backend/agent_orchestrator/caseload"
              className="inline-block text-sm font-medium text-brand-violet hover:underline"
            >
              {t('agent_orchestrator.playground.result.openCaseload')}
            </a>
          </div>
        ) : null}

        {result?.kind === 'informative' ? (
          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.playground.result.informative')} />
            <JsonDisplay data={result.data} />
          </section>
        ) : null}

        {result ? (
          <CollapsibleSection title={t('agent_orchestrator.playground.result.trace')} defaultCollapsed>
            <div className="space-y-3">
              <section className="space-y-2">
                <SectionHeader
                  title={t('agent_orchestrator.playground.result.toolsHeading')}
                  count={selectedAgent?.tools.length ?? 0}
                />
                {selectedAgent && selectedAgent.tools.length > 0 ? (
                  <ul className="space-y-1">
                    {selectedAgent.tools.map((tool) => (
                      <li key={tool} className="flex items-center gap-2 text-sm">
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-violet" />
                        <span className="font-mono text-xs">{tool}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('agent_orchestrator.playground.result.noTools')}
                  </p>
                )}
              </section>
              <section className="space-y-2">
                <SectionHeader title={t('agent_orchestrator.playground.result.rawOutput')} />
                <JsonDisplay data={result} />
              </section>
            </div>
          </CollapsibleSection>
        ) : null}
      </PageBody>
    </Page>
  )
}
