"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Play, Plug, RotateCw, ShieldAlert, SquareCode } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { SectionHeader, CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ProposalCard } from '../../components/ProposalCard'
import { mapAgent, type AgentView } from '../../components/types'
import { toolPanelStateFromResponse, type ToolPanelState } from '../../components/playgroundToolCalls'
import { runErrorStateFromBody } from '../../components/playgroundRunError'
import { Chip, TYPE_ICON, RUNTIME_ICON, resolveAgentIcon } from '../../components/agentChips'

type AgentsResponse = { items?: Array<Record<string, unknown>> }

type AgentResult =
  | { kind: 'informative'; data: unknown }
  | { kind: 'actionable'; proposal: { actions: unknown[]; confidence?: number; rationale?: string } }

type AgentRunResponse = AgentResult & { runId?: string | null; proposalId?: string | null }

// Connectivity states derived from the ai_assistant health endpoint — the same
// source the AI assistant settings page reads (OpenCode container + its MCP
// server bindings). `hidden` covers callers without `ai_assistant.view`.
type ConnState = 'ok' | 'warn' | 'down' | 'unknown'

type ConnectionsState =
  | { mode: 'loading' }
  | { mode: 'hidden' }
  | {
      mode: 'ready'
      opencode: ConnState
      opencodeVersion: string | null
      mcp: ConnState
      mcpServers: Array<{ name: string; status: string }>
    }

type HealthResponse = {
  status?: 'ok' | 'error'
  opencode?: { healthy?: boolean; version?: string }
  mcp?: Record<string, { status?: string; error?: string }>
}

const CONN_VARIANT: Record<ConnState, StatusBadgeVariant> = {
  ok: 'success',
  warn: 'warning',
  down: 'error',
  unknown: 'neutral',
}

function connectionsFromHealth(result: HealthResponse | null): Omit<Extract<ConnectionsState, { mode: 'ready' }>, 'mode'> {
  const opencodeHealthy = result?.opencode?.healthy === true
  const mcpEntries = Object.entries(result?.mcp ?? {}).map(([name, value]) => ({
    name,
    status: typeof value?.status === 'string' ? value.status : 'unknown',
  }))
  const mcp: ConnState = mcpEntries.some((entry) => entry.status === 'connected')
    ? 'ok'
    : mcpEntries.some((entry) => entry.status === 'connecting')
      ? 'warn'
      : mcpEntries.length > 0
        ? 'down'
        : 'unknown'
  return {
    opencode: opencodeHealthy ? 'ok' : 'down',
    opencodeVersion: typeof result?.opencode?.version === 'string' ? result.opencode.version : null,
    mcp,
    mcpServers: mcpEntries,
  }
}

function ConnectionBadges() {
  const t = useT()
  const [state, setState] = React.useState<ConnectionsState>({ mode: 'loading' })

  const load = React.useCallback(async () => {
    const call = await apiCall<HealthResponse>('/api/ai_assistant/health', undefined, { fallback: null })
    if (!call.ok) {
      // 401/403 → the caller cannot read health at all; hide instead of guessing.
      if (call.status === 401 || call.status === 403) {
        setState({ mode: 'hidden' })
        return
      }
      setState({ mode: 'ready', opencode: 'down', opencodeVersion: null, mcp: 'unknown', mcpServers: [] })
      return
    }
    setState({ mode: 'ready', ...connectionsFromHealth(call.result) })
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  if (state.mode === 'hidden') return null
  if (state.mode === 'loading') {
    return (
      <div className="flex items-center gap-1.5">
        <StatusBadge variant="neutral" dot>
          {t('agent_orchestrator.playground.connections.checking', 'Checking…')}
        </StatusBadge>
      </div>
    )
  }

  const stateLabel = (value: ConnState) =>
    value === 'ok'
      ? t('agent_orchestrator.playground.connections.connected', 'Connected')
      : value === 'warn'
        ? t('agent_orchestrator.playground.connections.connecting', 'Connecting…')
        : value === 'down'
          ? t('agent_orchestrator.playground.connections.disconnected', 'Not connected')
          : t('agent_orchestrator.playground.connections.unknown', 'Status unknown')

  const opencodeTooltip =
    state.opencode === 'ok' && state.opencodeVersion
      ? `${stateLabel(state.opencode)} · ${t('agent_orchestrator.playground.connections.version', 'Version {version}', { version: state.opencodeVersion })}`
      : stateLabel(state.opencode)
  const mcpTooltip =
    state.mcpServers.length > 0
      ? state.mcpServers.map((server) => `${server.name}: ${server.status}`).join(' · ')
      : stateLabel(state.mcp)

  return (
    <div className="flex items-center gap-1.5">
      <SimpleTooltip content={opencodeTooltip}>
        <span>
          <StatusBadge variant={CONN_VARIANT[state.opencode]} dot className="gap-1.5">
            <SquareCode className="size-3.5 shrink-0" aria-hidden />
            {t('agent_orchestrator.playground.connections.opencode', 'OpenCode')}
          </StatusBadge>
        </span>
      </SimpleTooltip>
      <SimpleTooltip content={mcpTooltip}>
        <span>
          <StatusBadge variant={CONN_VARIANT[state.mcp]} dot className="gap-1.5">
            <Plug className="size-3.5 shrink-0" aria-hidden />
            {t('agent_orchestrator.playground.connections.mcp', 'MCP')}
          </StatusBadge>
        </span>
      </SimpleTooltip>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="size-7 p-0"
        aria-label={t('agent_orchestrator.playground.connections.refresh', 'Re-check connections')}
        onClick={() => {
          setState({ mode: 'loading' })
          void load()
        }}
      >
        <RotateCw className="size-3.5" />
      </Button>
    </div>
  )
}

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
  const [guardrailBlock, setGuardrailBlock] = React.useState<{ guardrailKind: string; phase: string } | null>(null)

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
    setGuardrailBlock(null)
    setRunning(true)
    setResult(null)
    setRunId(null)
    setProposalId(null)
    setToolPanel({ mode: 'idle' })
    try {
      const call = await apiCall<AgentRunResponse>(
        `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/run`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: parsed }),
        },
        { fallback: null },
      )
      if (!call.ok || !call.result) {
        // A guardrail block is a policy verdict with a typed reason — surface
        // it as its own alert, never the generic run-failed message (§3.6).
        const errorState = runErrorStateFromBody(call.result)
        if (errorState.kind === 'guardrail') {
          setGuardrailBlock({ guardrailKind: errorState.guardrailKind, phase: errorState.phase })
        } else {
          setError(errorState.message ?? t('agent_orchestrator.playground.error'))
        }
        return
      }
      const data = call.result
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

  const hasOutcome = Boolean(result || running || error || guardrailBlock)

  return (
    <Page>
      <PageBody className="space-y-5" onKeyDown={handleKeyDown}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.playground.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('agent_orchestrator.playground.subtitle')}</p>
          </div>
          <ConnectionBadges />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {/* Compose panel */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">
                {t('agent_orchestrator.playground.composeTitle', 'Run an agent')}
              </span>
              {selectedAgent ? (
                <span className="flex items-center gap-1.5">
                  <Chip icon={RUNTIME_ICON[selectedAgent.runtime]}>
                    {t(`agent_orchestrator.agents.list.runtime.${selectedAgent.runtime}`)}
                  </Chip>
                  <Chip icon={TYPE_ICON[selectedAgent.resultKind]}>
                    {t(`agent_orchestrator.agents.list.resultKind.${selectedAgent.resultKind}`)}
                  </Chip>
                </span>
              ) : null}
            </div>
            <div className="space-y-4 p-4">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="ao-pg-agent">
                  {t('agent_orchestrator.playground.agentLabel')}
                </label>
                <Select
                  value={agentId}
                  onValueChange={(value) => {
                    const nextId = value ?? ''
                    setAgentId(nextId)
                    // Agent inputs are agent-specific: switching clears the previous
                    // agent's JSON and re-offers the new agent's declared sample.
                    const nextSample = agents.find((agent) => agent.id === nextId)?.sampleInput
                    setInput(nextSample !== undefined ? JSON.stringify(nextSample, null, 2) : '{\n  \n}')
                  }}
                >
                  <SelectTrigger id="ao-pg-agent" className="focus-visible:ring-brand-violet">
                    <SelectValue placeholder={t('agent_orchestrator.playground.agentPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => {
                      const Glyph = resolveAgentIcon(agent.icon, agent.resultKind)
                      return (
                        <SelectItem key={agent.id} value={agent.id}>
                          {Glyph ? <Glyph className="size-4 text-muted-foreground" /> : null}
                          {agent.label}
                        </SelectItem>
                      )
                    })}
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
                  rows={12}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {t('agent_orchestrator.playground.runHint', 'Cmd/Ctrl + Enter runs the agent')}
              </span>
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
          </div>

          {/* Result panel */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">
                {t('agent_orchestrator.playground.resultTitle', 'Result')}
              </span>
              {result && runId ? (
                <span className="flex items-center gap-3">
                  <a
                    href={`/backend/traces/${encodeURIComponent(runId)}`}
                    className="text-xs font-medium text-brand-violet hover:underline"
                  >
                    {t('agent_orchestrator.playground.result.viewTrace')}
                  </a>
                  {proposalId ? (
                    <a
                      href={`/backend/caseload/${encodeURIComponent(proposalId)}`}
                      className="text-xs font-medium text-brand-violet hover:underline"
                    >
                      {t('agent_orchestrator.playground.result.openProposal')}
                    </a>
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="space-y-4 p-4">
              {error ? (
                <Alert status="error" style="light">
                  {error}
                </Alert>
              ) : null}

              {guardrailBlock ? (
                <Alert status="error" style="light">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      {t('agent_orchestrator.playground.guardrailBlocked', undefined, {
                        kind: guardrailBlock.guardrailKind,
                        phase: guardrailBlock.phase,
                      })}
                    </span>
                  </div>
                </Alert>
              ) : null}

              {running ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Spinner className="size-5" />
                  <p className="text-sm text-muted-foreground">{t('agent_orchestrator.playground.running')}</p>
                </div>
              ) : null}

              {!hasOutcome ? (
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
                            {t('agent_orchestrator.playground.result.noDeclaredTools')}
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
            </div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
