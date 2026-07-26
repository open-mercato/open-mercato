"use client"

import * as React from 'react'
import { z } from 'zod'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
} from '@open-mercato/ui/primitives/drawer'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { Slider } from '@open-mercato/ui/primitives/slider'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
// TYPE-ONLY import — erased at compile time, so the scorer registry (zod schemas,
// score bodies, PII regexes) never enters the client bundle. Descriptors arrive at
// runtime from GET /eval-scorers.
import type { ScorerDescriptor, ScorerField } from '../../../../lib/eval/types'
import type { AssertionRow } from './EvaluationTab'

/** Namespaced so two scorers can expose a field of the same name. */
const CONFIG_FIELD_PREFIX = 'cfg__'
const configFieldId = (scorerKey: string, name: string) => `${CONFIG_FIELD_PREFIX}${scorerKey}__${name}`

/** Slider is handled separately as a custom field, so it is excluded here. */
const SCORER_FIELD_TYPE: Record<
  Exclude<ScorerField['kind'], 'slider'>,
  'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'tags'
> = {
  text: 'text',
  textarea: 'textarea',
  json: 'textarea',
  number: 'number',
  boolean: 'checkbox',
  select: 'select',
  'string-list': 'tags',
}

const ENTITY_ID = 'agent_orchestrator:agent_eval_assertion'

type FormValues = {
  id?: string
  key?: string
  scorerKey: string
  title: string
  description?: string
  appliesTo: string
  type: 'deterministic' | 'llm_judge'
  severity: 'gate' | 'warn'
  /** Generated config controls, namespaced `cfg__<scorerKey>__<name>`. */
  [configField: string]: unknown
  enabled: boolean
  updatedAt?: string | null
}

export type AssertionFormDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present in edit mode, null when creating a new assertion. */
  assertion: AssertionRow | null
  /** Current agent — prefills `appliesTo` in create mode. */
  agentId: string
  onSaved: () => void
}

/**
 * Slider + live readout for a bounded scorer value. The number is shown beside the
 * track because a threshold is a value an operator reasons about precisely
 * ("0.75"), not just drags towards.
 */
function ScorerSliderField({
  value,
  onChange,
  disabled,
  min,
  max,
  step,
  fallback,
}: {
  value: unknown
  onChange: (next: number) => void
  disabled?: boolean
  min: number
  max: number
  step: number
  fallback: number
}) {
  const current = typeof value === 'number' ? value : Number(value)
  const resolved = Number.isFinite(current) ? current : fallback
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0

  return (
    <div className="flex items-center gap-4">
      <Slider
        className="flex-1"
        value={[resolved]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) => onChange(next[0] ?? fallback)}
      />
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-foreground">
        {resolved.toFixed(decimals)}
      </span>
    </div>
  )
}

/**
 * Create/edit form for an eval assertion, relocated from the deleted
 * `backend/eval-assertions` list page into a per-agent drawer. Preserves the
 * dynamic per-scorer config fields, the 0..1 threshold slider, the applies-to
 * combobox (including "* — all agents"), severity, enabled, and the manual
 * optimistic-lock write path.
 */
export function AssertionFormDrawer({ open, onOpenChange, assertion, agentId, onSaved }: AssertionFormDrawerProps) {
  const t = useT()
  const isEdit = !!assertion
  const [agents, setAgents] = React.useState<CrudFieldOption[]>([])
  const [descriptors, setDescriptors] = React.useState<ScorerDescriptor[]>([])
  const [toolNames, setToolNames] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    void apiCall<{ tools?: Array<{ name?: unknown }> }>(
      '/api/ai_assistant/tools',
      undefined,
      { fallback: { tools: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const names = (Array.isArray(call.result?.tools) ? call.result.tools : [])
        .map((tool) => (typeof tool?.name === 'string' ? tool.name : ''))
        .filter(Boolean)
      setToolNames(Array.from(new Set(names)).sort())
    })
    return () => { cancelled = true }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    void apiCall<{ scorers?: ScorerDescriptor[] }>(
      '/api/agent_orchestrator/eval-scorers',
      undefined,
      { fallback: { scorers: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      setDescriptors(Array.isArray(call.result?.scorers) ? call.result.scorers : [])
    })
    return () => { cancelled = true }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    void apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/agents',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setAgents(
        items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : typeof item.agent_id === 'string' ? item.agent_id : ''
            const label = typeof item.label === 'string' && item.label ? item.label : id
            return { value: id, label }
          })
          .filter((option) => option.value !== ''),
      )
    })
    return () => { cancelled = true }
  }, [open])

  const formSchema = React.useMemo(
    () =>
      z
        .object({
          key: z.string().optional(),
          scorerKey: z.string().min(1, 'agent_orchestrator.evalAssertions.form.errors.scorerKeyRequired'),
          title: z.string().min(1, 'agent_orchestrator.evalAssertions.form.errors.titleRequired'),
          description: z.string().optional(),
          appliesTo: z.string().min(1),
          type: z.enum(['deterministic', 'llm_judge']),
          severity: z.enum(['gate', 'warn']),
          enabled: z.boolean(),
        })
        .passthrough(),
    [],
  )

  const appliesToOptions = React.useMemo<CrudFieldOption[]>(
    () => [{ value: '*', label: t('agent_orchestrator.evalAssertions.form.allAgents', 'All agents') }, ...agents],
    [agents, t],
  )

  const scorerOptions = React.useMemo<CrudFieldOption[]>(
    () =>
      descriptors.map((descriptor) => ({
        value: descriptor.scorerKey,
        label: descriptor.deprecated
          ? `${t(descriptor.labelKey, descriptor.scorerKey)} (${t('agent_orchestrator.evalAssertions.form.deprecated')})`
          : t(descriptor.labelKey, descriptor.scorerKey),
      })),
    [descriptors, t],
  )

  const configFields = React.useMemo<CrudField[]>(
    () =>
      descriptors.flatMap((descriptor) =>
        descriptor.fields.map((field): CrudField => {
          const id = configFieldId(descriptor.scorerKey, field.name)
          const base = {
            id,
            label: t(field.labelKey, field.name),
            description: field.hintKey ? t(field.hintKey, '') || undefined : undefined,
            required: 'required' in field ? field.required : undefined,
            visibleWhen: { field: 'scorerKey', equals: descriptor.scorerKey } as const,
          }

          if (field.kind === 'slider') {
            return {
              ...base,
              type: 'custom',
              component: ({ value, setValue, disabled }) => (
                <ScorerSliderField
                  value={value}
                  onChange={setValue}
                  disabled={disabled}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  fallback={field.default ?? field.min}
                />
              ),
            }
          }

          return {
            ...base,
            type: SCORER_FIELD_TYPE[field.kind],
            placeholder:
              'placeholderKey' in field && field.placeholderKey
                ? t(field.placeholderKey, '') || undefined
                : undefined,
            suggestions: 'suggest' in field && field.suggest === 'tool' ? toolNames : undefined,
            options:
              field.kind === 'select'
                ? field.options.map((option) => ({ value: option.value, label: t(option.labelKey, option.value) }))
                : undefined,
          }
        }),
      ),
    [descriptors, t, toolNames],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'title', label: t('agent_orchestrator.evalAssertions.form.title'), type: 'text', required: true },
      {
        id: 'scorerKey',
        label: t('agent_orchestrator.evalAssertions.form.scorerKey'),
        type: 'select',
        options: scorerOptions,
        description: t('agent_orchestrator.evalAssertions.form.scorerKeyHint'),
        required: true,
      },
      {
        id: 'key',
        label: t('agent_orchestrator.evalAssertions.form.key'),
        type: 'text',
        description: t('agent_orchestrator.evalAssertions.form.keyHint'),
      },
      ...configFields,
      { id: 'description', label: t('agent_orchestrator.evalAssertions.form.description'), type: 'textarea' },
      { id: 'appliesTo', label: t('agent_orchestrator.evalAssertions.form.appliesTo'), type: 'combobox', options: appliesToOptions, seedOptions: appliesToOptions, allowCustomValues: true, required: true },
      {
        id: 'severity',
        label: t('agent_orchestrator.evalAssertions.form.severity'),
        type: 'select',
        description: t('agent_orchestrator.evalAssertions.form.severityHint'),
        options: [
          { value: 'gate', label: t('agent_orchestrator.evalAssertions.severity.gate') },
          { value: 'warn', label: t('agent_orchestrator.evalAssertions.severity.warn') },
        ],
      },
      { id: 'enabled', label: t('agent_orchestrator.evalAssertions.form.enabled'), type: 'checkbox' },
    ],
    [t, appliesToOptions, scorerOptions, configFields],
  )

  function effectiveKey(values: FormValues): string {
    const explicit = typeof values.key === 'string' ? values.key.trim() : ''
    return explicit || values.scorerKey?.trim() || ''
  }

  function collectConfig(values: FormValues): Record<string, unknown> | undefined {
    const descriptor = descriptors.find((entry) => entry.scorerKey === values.scorerKey)
    if (!descriptor) return undefined
    const rendered = new Set(descriptor.fields.map((field) => field.name))
    const config: Record<string, unknown> = Object.fromEntries(
      Object.entries(assertion?.scorerKey === values.scorerKey ? assertion.config : {})
        .filter(([name]) => name !== 'scorer' && !rendered.has(name)),
    )
    for (const field of descriptor.fields) {
      const raw = values[configFieldId(descriptor.scorerKey, field.name)]
      if (raw === undefined || raw === null || raw === '') continue
      config[field.name] = field.kind === 'number' ? Number(raw) : raw
    }
    return Object.keys(config).length ? config : undefined
  }

  function buildBody(values: FormValues) {
    const descriptor = descriptors.find((entry) => entry.scorerKey === values.scorerKey)
    const type = descriptor?.kind ?? values.type
    const severity = values.severity
    const body: Record<string, unknown> = {
      key: effectiveKey(values),
      scorerKey: values.scorerKey,
      title: values.title,
      description: values.description?.trim() ? values.description.trim() : undefined,
      appliesTo: values.appliesTo,
      type,
      severity,
      enabled: values.enabled,
      config: collectConfig(values),
    }
    return body
  }

  const initialValues: Partial<FormValues> = isEdit
    ? {
        id: assertion!.id,
        key: assertion!.key,
        scorerKey: assertion!.scorerKey,
        title: assertion!.title,
        description: assertion!.description ?? undefined,
        appliesTo: assertion!.appliesTo,
        type: assertion!.type,
        severity: assertion!.severity,
        enabled: assertion!.enabled,
        updatedAt: assertion!.updatedAt,
        ...Object.fromEntries(
          Object.entries(assertion!.config)
            .filter(([name]) => name !== 'scorer')
            .map(([name, value]) => [configFieldId(assertion!.scorerKey, name), value]),
        ),
      }
    : { appliesTo: agentId || '*', type: 'deterministic', severity: 'warn', enabled: false }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="max-w-xl">
        <DrawerHeader>
          <span className="text-xs font-medium uppercase tracking-wide text-brand-violet">
            {t('agent_orchestrator.agentDetail.evaluation.section.assertions', 'Assertions')}
          </span>
          <DrawerTitle>
            {isEdit
              ? t('agent_orchestrator.evalAssertions.form.editTitle')
              : t('agent_orchestrator.evalAssertions.form.createTitle')}
          </DrawerTitle>
          <DrawerDescription>
            {t('agent_orchestrator.agentDetail.evaluation.assertions.drawerHint', 'Configure a check scored against this agent’s runs.')}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="pb-6">
          <CrudForm<FormValues>
            embedded
            // Remount on target change so the dynamic config controls re-seed.
            key={assertion?.id ?? 'create'}
            fields={fields}
            initialValues={initialValues}
            entityIds={[ENTITY_ID]}
            schema={formSchema}
            submitLabel={t('agent_orchestrator.evalAssertions.form.submit')}
            disableOptimisticLock
            onSubmit={async (values) => {
              if (!effectiveKey(values)) {
                const message = t('agent_orchestrator.evalAssertions.form.errors.keyRequired')
                throw createCrudFormError(message, { key: message })
              }
              const body = buildBody(values)
              try {
                if (isEdit) {
                  await withScopedApiRequestHeaders(
                    buildOptimisticLockHeader(assertion!.updatedAt),
                    () => updateCrud('agent_orchestrator/eval-assertions', { id: assertion!.id, ...body }),
                  )
                } else {
                  await createCrud('agent_orchestrator/eval-assertions', body)
                }
              } catch (err) {
                if (surfaceRecordConflict(err, t)) return
                throw err
              }
              flash(t('agent_orchestrator.evalAssertions.flash.saved'), 'success')
              onOpenChange(false)
              onSaved()
            }}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}

export default AssertionFormDrawer
