"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Play } from 'lucide-react'
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
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SectionHeader, CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ProposalCard } from '../../components/ProposalCard'
import { mapAgent, type AgentView } from '../../components/types'
import { toolPanelStateFromResponse, type ToolPanelState } from '../../components/playgroundToolCalls'

type AgentsResponse = { items?: Array<Record<string, unknown>> }

type AgentResult =
  | { kind: 'informative'; data: unknown }
  | { kind: 'actionable'; proposal: { actions: unknown[]; confidence?: number; rationale?: string } }

type AgentRunResponse = AgentResult & { runId?: string | null; proposalId?: string | null }

export default function AgentPlaygroundPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const [agents, setAgents] = React.useState<AgentView[]>([])
  const [agentId, setAgentId] = React.useState<string>('')
  const [input, setInput] = React.useState<string>('{\n  \n}')
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<AgentResult | null>(null)
  const [runId, setRunId] = React.useState<string | null>(null)
  const [proposalId, setProposalId] = React.useState<string | null>(null)
  const [toolPanel, setToolPanel] = React.useState<ToolPanelState>({ mode: 'idle' })
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

  // Per-agent example input ships with the agent definition (code agents via
  // `defineAgent({ sampleInput })`, file agents via `agents/<id>/SAMPLE.json`)
  // and arrives on the agent list payload — the Playground no longer hardcodes
  // samples. The button hides when an agent declares none.
  const sampleInput = selectedAgent?.sampleInput

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
    setRunId(null)
    setProposalId(null)
    setToolPanel({ mode: 'idle' })
    try {
      const data = await readApiResultOrThrow<AgentRunResponse>(
        `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/run`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: parsed }),
        },
      )
      setResult(data)
      setRunId(typeof data.runId === 'string' ? data.runId : null)
      setProposalId(typeof data.proposalId === 'string' ? data.proposalId : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agent_orchestrator.playground.error'))
    } finally {
      setRunning(false)
    }
  }, [agentId, input, t])

  // Fetch the run's ACTUAL tool calls from the trace-detail route once the run
  // id is known. That route gates `trace.view` while this page gates
  // `agents.run`; a 403 (or any failure) degrades to the declared-tools list
  // under a "Declared tools" heading — never the false "Tools used" framing.
  React.useEffect(() => {
    if (!runId) return
    let cancelled = false
    async function loadToolCalls(id: string) {
      setToolPanel({ mode: 'loading' })
      const call = await apiCall<Record<string, unknown>>(
        `/api/agent_orchestrator/runs/${encodeURIComponent(id)}`,
        undefined,
        { fallback: {} },
      )
      if (cancelled) return
      setToolPanel(toolPanelStateFromResponse(call))
    }
    void loadToolCalls(runId)
    return () => {
      cancelled = true
    }
  }, [runId])

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
            {sampleInput !== undefined ? (
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

        <div className="flex items-center justify-end">
          <Button
            type="button"
            onClick={() => void run()}
            disabled={running || !agentId}
            className="bg-brand-violet text-brand-violet-foreground hover:bg-brand-violet/90"
          >
            {running ? <Spinner className="size-4" /> : <Play className="size-4" />}
            {running ? t('agent_orchestrator.playground.running') : t('agent_orchestrator.playground.run')}
          </Button>
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
          <ProposalCard
            adHoc={{
              agentId,
              confidence: typeof result.proposal.confidence === 'number' ? result.proposal.confidence : null,
              payload: result.proposal.actions,
              rationale: result.proposal.rationale ?? null,
            }}
          />
        ) : null}

        {result?.kind === 'informative' ? (
          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.playground.result.informative')} />
            <JsonDisplay data={result.data} />
          </section>
        ) : null}

        {result && runId ? (
          <div className="flex items-center gap-4">
            <a
              href={`/backend/traces/${encodeURIComponent(runId)}`}
              className="inline-block text-sm font-medium text-brand-violet hover:underline"
            >
              {t('agent_orchestrator.playground.result.viewTrace')}
            </a>
            {proposalId ? (
              <a
                href={`/backend/caseload/${encodeURIComponent(proposalId)}`}
                className="inline-block text-sm font-medium text-brand-violet hover:underline"
              >
                {t('agent_orchestrator.playground.result.openProposal')}
              </a>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <CollapsibleSection title={t('agent_orchestrator.playground.result.trace')} defaultCollapsed>
            <div className="space-y-3">
              {toolPanel.mode === 'real' ? (
                <section className="space-y-2">
                  <SectionHeader
                    title={t('agent_orchestrator.playground.result.toolsHeading')}
                    count={toolPanel.calls.length}
                  />
                  {toolPanel.calls.length > 0 ? (
                    <ul className="space-y-1">
                      {toolPanel.calls.map((toolCall) => (
                        <li key={toolCall.id} className="flex items-center gap-2 text-sm">
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-violet" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{toolCall.toolName}</span>
                          {toolCall.latencyMs != null ? (
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {toolCall.latencyMs}ms
                            </span>
                          ) : null}
                          <StatusBadge variant={toolCall.status === 'error' ? 'error' : 'success'}>
                            {toolCall.status ?? 'ok'}
                          </StatusBadge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('agent_orchestrator.playground.result.noToolCalls')}
                    </p>
                  )}
                </section>
              ) : toolPanel.mode === 'loading' ? (
                <section className="space-y-2">
                  <SectionHeader title={t('agent_orchestrator.playground.result.toolsHeading')} />
                  <Spinner className="size-4" />
                </section>
              ) : (
                <section className="space-y-2">
                  <SectionHeader
                    title={t('agent_orchestrator.playground.result.declaredTools')}
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
              )}
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
