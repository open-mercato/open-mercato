"use client"

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { RadioGroup, Radio } from '@open-mercato/ui/primitives/radio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapAgent, type AgentView } from './types'

type AgentsResponse = { items?: Array<Record<string, unknown>> }

/**
 * The `onResult` config frozen by area 02. Either auto-approve above a
 * confidence threshold, or always route to a human.
 */
export type InvokeAgentOnResult =
  | { autoApproveThreshold: number }
  | { alwaysAsk: true }

export type InvokeAgentNodeConfigValue = {
  agentId: string
  input: string
  onResult: InvokeAgentOnResult
}

export type InvokeAgentNodeConfigProps = {
  value: InvokeAgentNodeConfigValue
  onChange: (value: InvokeAgentNodeConfigValue) => void
}

/**
 * Controlled 3-field config panel for an `INVOKE_AGENT` node. Stateless about
 * persistence — area 02's visual editor owns reading/writing the node config.
 * Brand-violet header + focus rings flag this as an AI step (ds-rules: brand
 * violet only on AI touchpoints).
 */
export function InvokeAgentNodeConfig({ value, onChange }: InvokeAgentNodeConfigProps) {
  const t = useT()
  const [agents, setAgents] = React.useState<AgentView[]>([])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      const call = await apiCall<AgentsResponse>('/api/agent_orchestrator/agents', undefined, {
        fallback: { items: [] },
      })
      if (cancelled || !call.ok) return
      const items = Array.isArray(call.result?.items) ? call.result!.items : []
      setAgents(
        items
          .map((item) => mapAgent(item as Record<string, unknown>))
          .filter((agent): agent is AgentView => !!agent),
      )
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const mode: 'auto' | 'ask' = 'autoApproveThreshold' in value.onResult ? 'auto' : 'ask'
  const threshold = 'autoApproveThreshold' in value.onResult ? value.onResult.autoApproveThreshold : 0.8

  const setMode = (next: 'auto' | 'ask') => {
    if (next === 'auto') {
      onChange({ ...value, onResult: { autoApproveThreshold: threshold } })
    } else {
      onChange({ ...value, onResult: { alwaysAsk: true } })
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-brand-violet/10 px-3 py-2 text-sm font-medium text-brand-violet">
        {t('agent_orchestrator.proposal.proposes', undefined, { agent: 'Invoke Agent' })}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="ao-node-agent">
          {t('agent_orchestrator.playground.agentLabel')}
        </label>
        <Select value={value.agentId} onValueChange={(next) => onChange({ ...value, agentId: next ?? '' })}>
          <SelectTrigger id="ao-node-agent" className="focus-visible:ring-brand-violet">
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
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="ao-node-input">
          {t('agent_orchestrator.playground.inputLabel')}
        </label>
        <Textarea
          id="ao-node-input"
          value={value.input}
          onChange={(event) => onChange({ ...value, input: event.target.value })}
          rows={4}
          className="font-mono focus-visible:ring-brand-violet"
        />
      </div>

      <RadioGroup
        value={mode}
        onValueChange={(next) => setMode(next === 'auto' ? 'auto' : 'ask')}
        className="space-y-2"
      >
        <label className="flex items-center gap-2 text-sm">
          <Radio value="auto" />
          <span>{t('agent_orchestrator.proposal.verdict.approve')}</span>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={String(threshold)}
            disabled={mode !== 'auto'}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              if (Number.isFinite(parsed)) {
                onChange({ ...value, onResult: { autoApproveThreshold: parsed } })
              }
            }}
            className="w-24 focus-visible:ring-brand-violet"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Radio value="ask" />
          <span>{t('agent_orchestrator.proposal.verdict.ask')}</span>
        </label>
      </RadioGroup>
    </div>
  )
}

export default InvokeAgentNodeConfig
