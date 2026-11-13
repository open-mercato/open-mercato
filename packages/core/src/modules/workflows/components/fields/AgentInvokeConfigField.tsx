'use client'

import { useEffect, useMemo, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Slider } from '@open-mercato/ui/primitives/slider'
import { Label } from '@open-mercato/ui/primitives/label'
import { RadioGroup, Radio } from '@open-mercato/ui/primitives/radio'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { AlertCircle, Bot, Loader2, Plus, Search, Trash2, Wand2, X } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { AgentSelector, type AgentListItem } from '../AgentSelector'
import type { LedgerEntry } from '../../lib/context-ledger'
import {
  agentSampleInputKeys,
  agentSampleInputRows,
  buildAgentSourcePaths,
  isKnownAgentSourcePath,
  isTemplateExpression,
  type AgentResultKind,
} from '../../lib/agent-outcome-paths'
import { VariablePickerButton } from './VariablePickerButton'
import { ledgerDropTargetProps } from './ledgerDropTarget'
import type { Mapping } from './MappingArrayEditor'

/**
 * Composite value for an INVOKE_AGENT step, edited as a single CrudForm field.
 */
export interface AgentSubjectValue {
  subjectType: string
  subjectId: string
  subjectLabel: string
}

export interface AgentInvokeConfigValue {
  agentId: string
  inputs: Mapping[]
  resultMode: 'autoApprove' | 'alwaysAsk'
  autoApproveThreshold: string
  outputs: Mapping[]
  subject: AgentSubjectValue
}

interface AgentInvokeConfigFieldProps extends CrudCustomFieldRenderProps {
  value: AgentInvokeConfigValue
  ledgerEntries?: LedgerEntry[]
}

type AgentsResponse = { items?: AgentListItem[] }

export const emptyAgentSubject: AgentSubjectValue = {
  subjectType: '',
  subjectId: '',
  subjectLabel: '',
}

/**
 * The threshold control's bounds and granularity. Unchanged from the number
 * input this field has always rendered — spelled out as constants only so the
 * slider and the input cannot drift apart. The COMPARISON against these values
 * lives in the enterprise disposition service and is not touched here.
 */
const THRESHOLD_MIN = 0
const THRESHOLD_MAX = 1
const THRESHOLD_STEP = 0.05
const DEFAULT_AUTO_APPROVE_THRESHOLD = 0.8

const emptyValue: AgentInvokeConfigValue = {
  agentId: '',
  inputs: [],
  resultMode: 'autoApprove',
  autoApproveThreshold: String(DEFAULT_AUTO_APPROVE_THRESHOLD),
  outputs: [],
  subject: emptyAgentSubject,
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
export function AgentInvokeConfigField({
  id,
  value,
  error,
  setValue,
  disabled,
  ledgerEntries,
}: AgentInvokeConfigFieldProps) {
  const t = useT()
  const config: AgentInvokeConfigValue = { ...emptyValue, ...(value || {}) }
  const inputs = Array.isArray(config.inputs) ? config.inputs : []
  const outputs = Array.isArray(config.outputs) ? config.outputs : []
  const subject: AgentSubjectValue = { ...emptyAgentSubject, ...(config.subject || {}) }
  // The stored value is the author's raw text, so a half-typed entry ("0.") is
  // an ordinary state the slider must survive; it falls back to the same 0.8
  // the field has always defaulted to rather than snapping to 0.
  const parsedThreshold = Number.parseFloat(config.autoApproveThreshold)
  const thresholdSliderValue = Number.isFinite(parsedThreshold)
    ? Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, parsedThreshold))
    : DEFAULT_AUTO_APPROVE_THRESHOLD

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

  // Typed I/O vocabulary for the picked agent. Every derivation degrades to an
  // empty list when the optional agent_orchestrator peer is absent (the agents
  // endpoint 404s), when the agent declares no OUTCOME, or when it ships no
  // sample input — the rows then stay the plain free-text editors they were.
  const sourcePaths = useMemo(
    () => buildAgentSourcePaths(selectedAgent?.resultKind as AgentResultKind | undefined, selectedAgent?.outcomeSchema),
    [selectedAgent],
  )
  const sourcePathOptions = useMemo<ComboboxOption[]>(
    () => sourcePaths.map((entry) => ({ value: entry.path, label: entry.path, description: entry.type })),
    [sourcePaths],
  )
  const sampleInputRows = useMemo(() => agentSampleInputRows(selectedAgent?.sampleInput), [selectedAgent])
  const sampleInputKeys = useMemo(() => agentSampleInputKeys(selectedAgent?.sampleInput), [selectedAgent])

  // A mapping whose source path the agent never produces silently writes
  // nothing at runtime (mapAgentResultToContext only warns). Surface it as an
  // author-time error here; runtime behavior is unchanged for BC.
  const outputSourceError = (sourcePath: string): string | null => {
    const trimmed = (sourcePath || '').trim()
    if (isTemplateExpression(trimmed)) return t('workflows.form.invokeAgent.errors.templateSource')
    if (!isKnownAgentSourcePath(sourcePaths, trimmed)) {
      return t('workflows.form.invokeAgent.errors.unknownSourcePath')
    }
    return null
  }

  // Agents declare no input schema yet — SAMPLE input keys are the closest
  // artifact, so an unexpected key is a hint, never an error.
  const inputKeyWarning = (key: string): string | null => {
    const trimmed = (key || '').trim()
    if (!trimmed || sampleInputKeys.length === 0) return null
    return sampleInputKeys.includes(trimmed) ? null : t('workflows.form.invokeAgent.warnings.unknownInputKey')
  }

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
          <div className="flex items-center gap-2">
            {sampleInputRows.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => update({ inputs: sampleInputRows })}
              >
                <Wand2 className="size-3 mr-1" />
                {t('workflows.form.invokeAgent.insertSample')}
              </Button>
            )}
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
        </div>
        <div className="space-y-2">
          {inputs.map((row, index) => {
            const keyWarning = inputKeyWarning(row.key)
            return (
              <div key={index} className="space-y-1">
                <div className="flex gap-2 items-center">
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
                    id={`${id}-input-${index}-value`}
                    type="text"
                    value={row.value}
                    onChange={(e) => update({ inputs: updateRow(inputs, index, 'value', e.target.value) })}
                    placeholder={t('workflows.form.invokeAgent.inputValuePlaceholder')}
                    className="flex-1 font-mono"
                    disabled={disabled}
                    {...ledgerDropTargetProps({
                      value: row.value,
                      onValueChange: (next) => update({ inputs: updateRow(inputs, index, 'value', next) }),
                      disabled,
                    })}
                  />
                  <VariablePickerButton
                    targetId={`${id}-input-${index}-value`}
                    value={row.value}
                    onValueChange={(next) => update({ inputs: updateRow(inputs, index, 'value', next) })}
                    ledgerEntries={ledgerEntries}
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
                {keyWarning && <p className="text-xs text-status-warning-text">{keyWarning}</p>}
              </div>
            )
          })}
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
              step={THRESHOLD_STEP}
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              value={config.autoApproveThreshold}
              onChange={(e) => update({ autoApproveThreshold: e.target.value })}
              onFocus={() => update({ resultMode: 'autoApprove' })}
              disabled={disabled || config.resultMode !== 'autoApprove'}
              className="w-24"
            />
          </label>
          {/*
            Presentation only. The slider and the number input edit the SAME
            `autoApproveThreshold` string, over the same 0-1 range and the same
            0.05 step the field has always used; the comparison, the default and
            the fail-closed branch all live in the enterprise disposition
            service and are untouched. The input stays because a slider cannot
            express an exact value, and removing it would take a capability
            away.
          */}
          <div className="flex items-center gap-3 pl-6">
            <Slider
              aria-label={t('workflows.form.invokeAgent.autoApprove')}
              value={[thresholdSliderValue]}
              onValueChange={([next]) =>
                update({
                  resultMode: 'autoApprove',
                  autoApproveThreshold: String(Number(next.toFixed(2))),
                })
              }
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              step={THRESHOLD_STEP}
              disabled={disabled || config.resultMode !== 'autoApprove'}
              className="max-w-xs"
            />
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {thresholdSliderValue.toFixed(2)}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Radio value="alwaysAsk" />
            <span>{t('workflows.form.invokeAgent.alwaysAsk')}</span>
          </label>
        </RadioGroup>
        <p className="text-xs text-muted-foreground mt-1">{t('workflows.form.invokeAgent.threshold')}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t('workflows.form.invokeAgent.thresholdFailClosed')}
        </p>
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
            {outputs.map((row, index) => {
              const sourceError = outputSourceError(row.value)
              return (
                <div key={index} className="space-y-1">
                  <div className="flex gap-2 items-center">
                    <Input
                      id={`${id}-output-${index}-key`}
                      type="text"
                      value={row.key}
                      onChange={(e) => update({ outputs: updateRow(outputs, index, 'key', e.target.value) })}
                      placeholder={t('workflows.form.invokeAgent.outputKeyPlaceholder')}
                      className="flex-1"
                      disabled={disabled}
                      {...ledgerDropTargetProps({
                        value: row.key,
                        onValueChange: (next) => update({ outputs: updateRow(outputs, index, 'key', next) }),
                        insertMode: 'bare',
                        disabled,
                      })}
                    />
                    <VariablePickerButton
                      targetId={`${id}-output-${index}-key`}
                      value={row.key}
                      onValueChange={(next) => update({ outputs: updateRow(outputs, index, 'key', next) })}
                      ledgerEntries={ledgerEntries}
                      insertMode="bare"
                      disabled={disabled}
                    />
                    <span className="text-muted-foreground">=</span>
                    <div className="flex-1">
                      {sourcePathOptions.length > 0 ? (
                        <ComboboxInput
                          value={row.value}
                          onChange={(next) => update({ outputs: updateRow(outputs, index, 'value', next) })}
                          suggestions={sourcePathOptions}
                          placeholder={t('workflows.form.invokeAgent.outputPathPlaceholder')}
                          allowCustomValues
                          disabled={disabled}
                        />
                      ) : (
                        <Input
                          type="text"
                          value={row.value}
                          onChange={(e) => update({ outputs: updateRow(outputs, index, 'value', e.target.value) })}
                          placeholder={t('workflows.form.invokeAgent.outputPathPlaceholder')}
                          className="w-full font-mono"
                          disabled={disabled}
                        />
                      )}
                    </div>
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
                  {sourceError && (
                    <p className="text-xs text-destructive" role="alert">
                      {sourceError}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {t('workflows.form.invokeAgent.outputMappingDescription')}
        </p>
      </div>

      {/* Subject — what business record this process is about */}
      <div>
        <Label className="text-sm font-medium mb-1">{t('workflows.form.invokeAgent.subject')}</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            type="text"
            value={subject.subjectType}
            onChange={(e) => update({ subject: { ...subject, subjectType: e.target.value } })}
            placeholder={t('workflows.form.invokeAgent.subjectTypePlaceholder')}
            aria-label={t('workflows.form.invokeAgent.subjectType')}
            disabled={disabled}
          />
          <div className="flex items-center gap-1">
            <Input
              id={`${id}-subject-id`}
              type="text"
              value={subject.subjectId}
              onChange={(e) => update({ subject: { ...subject, subjectId: e.target.value } })}
              placeholder={t('workflows.form.invokeAgent.subjectIdPlaceholder')}
              aria-label={t('workflows.form.invokeAgent.subjectId')}
              className="flex-1 font-mono"
              disabled={disabled}
              {...ledgerDropTargetProps({
                value: subject.subjectId,
                onValueChange: (next) => update({ subject: { ...subject, subjectId: next } }),
                disabled,
              })}
            />
            <VariablePickerButton
              targetId={`${id}-subject-id`}
              value={subject.subjectId}
              onValueChange={(next) => update({ subject: { ...subject, subjectId: next } })}
              ledgerEntries={ledgerEntries}
              disabled={disabled}
            />
          </div>
          <Input
            type="text"
            value={subject.subjectLabel}
            onChange={(e) => update({ subject: { ...subject, subjectLabel: e.target.value } })}
            placeholder={t('workflows.form.invokeAgent.subjectLabelPlaceholder')}
            aria-label={t('workflows.form.invokeAgent.subjectLabel')}
            disabled={disabled}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{t('workflows.form.invokeAgent.subjectDescription')}</p>
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
