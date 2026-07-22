'use client'

import { useEffect, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { RadioGroup, Radio } from '@open-mercato/ui/primitives/radio'
import { AlertCircle, Bot, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { AgentSelector, type AgentListItem } from '../AgentSelector'
import type { Mapping } from './MappingArrayEditor'

/**
 * Composite value for an INVOKE_AGENT step, edited as a single CrudForm field.
 */
export interface AgentInvokeConfigValue {
  agentId: string
  inputs: Mapping[]
  resultMode: 'autoApprove' | 'alwaysAsk'
  autoApproveThreshold: string
  outputs: Mapping[]
}

interface AgentInvokeConfigFieldProps extends CrudCustomFieldRenderProps {
  value: AgentInvokeConfigValue
}

type AgentsResponse = { items?: AgentListItem[] }

const emptyValue: AgentInvokeConfigValue = {
  agentId: '',
  inputs: [],
  resultMode: 'autoApprove',
  autoApproveThreshold: '0.8',
  outputs: [],
}

/**
 * AgentInvokeConfigField - Custom field for configuring an Invoke Agent step.
 *
 * Renders a searchable agent picker (AgentSelector) with a summary card for the
 * picked agent, key/value input rows, the on-result disposition (auto-approve
 * threshold vs. always ask a human), and the optional output mapping. Mirrors
 * the invokeAgent section of the legacy NodeEditDialog so the CrudForm-based
 * editor has feature parity.
 *
 * The agent registry is loaded from the optional agent_orchestrator peer; when
 * it is not installed the endpoint 404s and the picker stays empty.
 */
export function AgentInvokeConfigField({ id, value, error, setValue, disabled }: AgentInvokeConfigFieldProps) {
  const t = useT()
  const config: AgentInvokeConfigValue = { ...emptyValue, ...(value || {}) }
  const inputs = Array.isArray(config.inputs) ? config.inputs : []
  const outputs = Array.isArray(config.outputs) ? config.outputs : []

  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<AgentListItem | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)

  const agentId = config.agentId

  // Resolve the picked agent so the card can show its label/description even
  // when the step was configured elsewhere (imported JSON, another editor).
  useEffect(() => {
    if (!agentId) {
      setSelectedAgent(null)
      return
    }
    let cancelled = false
    setAgentLoading(true)
    apiCall<AgentsResponse>('/api/agent_orchestrator/agents', undefined, { fallback: { items: [] } })
      .then((res) => {
        if (cancelled) return
        const items = res.ok && Array.isArray(res.result?.items) ? res.result.items : []
        setSelectedAgent(items.find((item) => item.id === agentId) ?? null)
      })
      .finally(() => {
        if (!cancelled) setAgentLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentId])

  const update = (patch: Partial<AgentInvokeConfigValue>) => {
    setValue({ ...config, ...patch })
  }

  const updateRow = (rows: Mapping[], index: number, field: keyof Mapping, fieldValue: string) =>
    rows.map((row, i) => (i === index ? { ...row, [field]: fieldValue } : row))

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Agent picker */}
      <div className="space-y-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {t('workflows.form.invokeAgent.agent')} *
        </Label>

        {!agentId ? (
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <Bot className="size-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              {t('workflows.fieldEditors.agentSelector.noAgentSelected')}
            </p>
            <Button type="button" size="sm" onClick={() => setIsPickerOpen(true)} disabled={disabled}>
              <Search className="size-3 mr-1" />
              {t('workflows.fieldEditors.agentSelector.browseAgents')}
            </Button>
          </div>
        ) : (
          <div className="border border-border rounded-lg bg-background p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0 space-y-2">
                {agentLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{t('workflows.common.loadingDetails')}</span>
                  </div>
                ) : !selectedAgent ? (
                  <>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="size-4 text-status-warning-icon" />
                      <span className="text-sm font-semibold">{agentId}</span>
                    </div>
                    <p className="text-xs text-status-warning-text">
                      {t('workflows.fieldEditors.agentSelector.agentNotFound')}
                    </p>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{selectedAgent.label || agentId}</span>
                        {selectedAgent.runtime && (
                          <Badge variant="secondary" className="text-xs">
                            {selectedAgent.runtime}
                          </Badge>
                        )}
                        {selectedAgent.resultKind && (
                          <Badge variant="outline" className="text-xs">
                            {selectedAgent.resultKind}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{agentId}</p>
                    </div>
                    {selectedAgent.description && (
                      <p className="text-xs text-muted-foreground">{selectedAgent.description}</p>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsPickerOpen(true)}
                  disabled={disabled}
                >
                  <Search className="size-3 mr-1" />
                  {t('workflows.common.change')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ agentId: '' })}
                  disabled={disabled}
                  aria-label={t('workflows.common.clear')}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t('workflows.form.invokeAgent.agentDescription')}</p>
      </div>

      {/* Input */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-sm font-medium">{t('workflows.form.invokeAgent.input')}</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => update({ inputs: [...inputs, { key: '', value: '' }] })}
          >
            <Plus className="size-3 mr-1" />
            {t('workflows.form.addMapping')}
          </Button>
        </div>
        <div className="space-y-2">
          {inputs.map((row, index) => (
            <div key={index} className="flex gap-2 items-center">
              <Input
                type="text"
                value={row.key}
                onChange={(e) => update({ inputs: updateRow(inputs, index, 'key', e.target.value) })}
                placeholder={t('workflows.form.invokeAgent.inputKeyPlaceholder')}
                className="flex-1"
                disabled={disabled}
              />
              <span className="text-muted-foreground">=</span>
              <Input
                type="text"
                value={row.value}
                onChange={(e) => update({ inputs: updateRow(inputs, index, 'value', e.target.value) })}
                placeholder={t('workflows.form.invokeAgent.inputValuePlaceholder')}
                className="flex-1 font-mono"
                disabled={disabled}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => update({ inputs: inputs.filter((_, i) => i !== index) })}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{t('workflows.form.invokeAgent.inputDescription')}</p>
      </div>

      {/* On result */}
      <div>
        <Label className="text-sm font-medium mb-2">{t('workflows.form.invokeAgent.onResult')}</Label>
        <RadioGroup
          value={config.resultMode}
          onValueChange={(next) => update({ resultMode: next === 'alwaysAsk' ? 'alwaysAsk' : 'autoApprove' })}
          disabled={disabled}
          className="gap-3"
        >
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Radio value="autoApprove" />
            <span>{t('workflows.form.invokeAgent.autoApprove')}</span>
            <Input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={config.autoApproveThreshold}
              onChange={(e) => update({ autoApproveThreshold: e.target.value })}
              onFocus={() => update({ resultMode: 'autoApprove' })}
              disabled={disabled || config.resultMode !== 'autoApprove'}
              className="w-24"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Radio value="alwaysAsk" />
            <span>{t('workflows.form.invokeAgent.alwaysAsk')}</span>
          </label>
        </RadioGroup>
        <p className="text-xs text-muted-foreground mt-1">{t('workflows.form.invokeAgent.threshold')}</p>
      </div>

      {/* Output mapping */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-sm font-medium">
            {t('workflows.form.invokeAgent.outputMapping', { count: outputs.length })}
          </Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => update({ outputs: [...outputs, { key: '', value: '' }] })}
          >
            <Plus className="size-3 mr-1" />
            {t('workflows.form.addMapping')}
          </Button>
        </div>
        {outputs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('workflows.form.invokeAgent.noOutputMappings')}</p>
        ) : (
          <div className="space-y-2">
            {outputs.map((row, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  type="text"
                  value={row.key}
                  onChange={(e) => update({ outputs: updateRow(outputs, index, 'key', e.target.value) })}
                  placeholder={t('workflows.form.invokeAgent.outputKeyPlaceholder')}
                  className="flex-1"
                  disabled={disabled}
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  type="text"
                  value={row.value}
                  onChange={(e) => update({ outputs: updateRow(outputs, index, 'value', e.target.value) })}
                  placeholder={t('workflows.form.invokeAgent.outputPathPlaceholder')}
                  className="flex-1 font-mono"
                  disabled={disabled}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => update({ outputs: outputs.filter((_, i) => i !== index) })}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {t('workflows.form.invokeAgent.outputMappingDescription')}
        </p>
      </div>

      <AgentSelector
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelect={(pickedId, agent) => {
          setSelectedAgent(agent)
          update({ agentId: pickedId })
          setIsPickerOpen(false)
        }}
      />
    </div>
  )
}
