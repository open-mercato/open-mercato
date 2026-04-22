import * as React from 'react'
import { z } from 'zod'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import type { CrudField, CrudFormGroup, CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleFormValues = {
  name: string
  description?: string
  scopeType: 'system' | 'organization' | 'tenant'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone?: string
  targetType: 'queue' | 'command'
  targetQueue?: string
  targetCommand?: string
  targetPayload?: Record<string, unknown>
  isEnabled: boolean
}

export type TargetOptions = {
  queues: ComboboxOption[]
  commands: ComboboxOption[]
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function PayloadJsonEditor({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  return (
    <JsonBuilder
      value={value || {}}
      onChange={setValue}
      disabled={disabled}
    />
  )
}

export function ScheduledJobEnabledSwitch({
  isEnabled,
  setIsEnabled,
  t,
}: {
  isEnabled: boolean
  setIsEnabled: (value: boolean) => void
  t: (key: string, fallback: string) => string
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="enabled-switch" className="text-sm font-medium cursor-pointer">
        {isEnabled ? t('scheduler.form.enabled', 'Enabled') : t('scheduler.form.disabled', 'Disabled')}
      </Label>
      <Switch
        id="enabled-switch"
        checked={isEnabled}
        onCheckedChange={setIsEnabled}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Option loaders
// ---------------------------------------------------------------------------

export function createTargetOptionsLoader(
  apiCallFn: <T>(url: string, init?: RequestInit, options?: Record<string, unknown>) => Promise<{ result: T | null }>
) {
  const targetOptionsRef = { current: null as TargetOptions | null }

  async function loadTargetOptions(): Promise<TargetOptions> {
    if (targetOptionsRef.current) return targetOptionsRef.current
    try {
      const { result } = await apiCallFn<TargetOptions>('/api/scheduler/targets')
      const options = result ?? { queues: [], commands: [] }
      targetOptionsRef.current = options
      return options
    } catch {
      return { queues: [], commands: [] }
    }
  }

  async function loadQueueOptions(query?: string): Promise<ComboboxOption[]> {
    const options = await loadTargetOptions()
    if (!query) return options.queues
    const lower = query.toLowerCase()
    return options.queues.filter((q) => q.label.toLowerCase().includes(lower))
  }

  async function loadCommandOptions(query?: string): Promise<ComboboxOption[]> {
    const options = await loadTargetOptions()
    if (!query) return options.commands
    const lower = query.toLowerCase()
    return options.commands.filter((c) => c.label.toLowerCase().includes(lower))
  }

  return { loadTargetOptions, loadQueueOptions, loadCommandOptions, targetOptionsRef }
}

export async function loadTimezoneOptions(query?: string): Promise<ComboboxOption[]> {
  try {
    const allTz = Intl.supportedValuesOf('timeZone')
    const filtered = query
      ? allTz.filter((tz) => tz.toLowerCase().includes(query.toLowerCase()))
      : allTz
    return filtered.slice(0, 100).map((tz) => ({
      value: tz,
      label: tz,
    }))
  } catch {
    return [{ value: 'UTC', label: 'UTC' }]
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function scheduledJobFormSchema(t: (key: string, fallback: string) => string) {
  return z.object({
    name: z.string().min(1, t('scheduler.form.name.required', 'Name is required')),
    description: z.string().optional(),
    scopeType: z.enum(['system', 'organization', 'tenant']),
    scheduleType: z.enum(['cron', 'interval']),
    scheduleValue: z.string().min(1, t('scheduler.form.schedule.required', 'Schedule is required')),
    timezone: z.string(),
    targetType: z.enum(['queue', 'command']),
    targetQueue: z.string().optional(),
    targetCommand: z.string().optional(),
    targetPayload: z.record(z.string(), z.unknown()).optional(),
    isEnabled: z.boolean(),
  })
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export function scheduledJobFields(
  t: (key: string, fallback: string) => string,
  loaders: {
    loadQueueOptions: (query?: string) => Promise<ComboboxOption[]>
    loadCommandOptions: (query?: string) => Promise<ComboboxOption[]>
    loadTimezoneOptions: (query?: string) => Promise<ComboboxOption[]>
  }
): CrudField[] {
  return [
    {
      id: 'name',
      type: 'text',
      label: t('scheduler.form.name', 'Name'),
      required: true,
    },
    {
      id: 'description',
      type: 'textarea',
      label: t('scheduler.form.description', 'Description'),
    },
    {
      id: 'scopeType',
      type: 'select',
      label: t('scheduler.form.scope_type', 'Scope'),
      required: true,
      options: [
        { value: 'system', label: t('scheduler.scope.system', 'System') },
        { value: 'organization', label: t('scheduler.scope.organization', 'Organization') },
        { value: 'tenant', label: t('scheduler.scope.tenant', 'Tenant') },
      ],
    },
    {
      id: 'scheduleType',
      type: 'select',
      label: t('scheduler.form.schedule_type', 'Schedule Type'),
      required: true,
      options: [
        { value: 'cron', label: t('scheduler.type.cron', 'Cron Expression') },
        { value: 'interval', label: t('scheduler.type.interval', 'Simple Interval') },
      ],
    },
    {
      id: 'scheduleValue',
      type: 'text',
      label: t('scheduler.form.schedule_value', 'Schedule Value'),
      placeholder: t('scheduler.form.schedule_value.placeholder', 'e.g. 0 */6 * * * or 15m'),
      description: t('scheduler.form.schedule_value.description', 'For cron: use cron expression (e.g., "0 0 * * *"). For interval: use format like "15m", "2h", "1d" (s=seconds, m=minutes, h=hours, d=days)'),
      required: true,
    },
    {
      id: 'timezone',
      type: 'combobox',
      label: t('scheduler.form.timezone', 'Timezone'),
      placeholder: t('scheduler.form.timezone.placeholder', 'Search timezone...'),
      required: true,
      loadOptions: loaders.loadTimezoneOptions,
      allowCustomValues: false,
    },
    {
      id: 'targetType',
      type: 'select',
      label: t('scheduler.form.target_type', 'Target Type'),
      required: true,
      options: [
        { value: 'queue', label: t('scheduler.target.queue', 'Queue') },
        { value: 'command', label: t('scheduler.target.command', 'Command') },
      ],
    },
    {
      id: 'targetFields',
      type: 'custom',
      label: '',
      component: ({ values, setFormValue }) => {
        const targetType = values?.targetType as string | undefined
        const targetQueue = (values?.targetQueue as string) || ''
        const targetCommand = (values?.targetCommand as string) || ''

        return (
          <div className="space-y-4">
            {targetType === 'queue' && (
              <div className="space-y-1">
                <Label htmlFor="targetQueue">
                  {t('scheduler.form.target_queue', 'Target Queue')}
                </Label>
                <ComboboxInput
                  value={targetQueue}
                  onChange={(next) => setFormValue && setFormValue('targetQueue', next)}
                  placeholder={t('scheduler.form.target_queue.placeholder', 'Search queues...')}
                  loadSuggestions={loaders.loadQueueOptions}
                  allowCustomValues={true}
                />
              </div>
            )}
            {targetType === 'command' && (
              <div className="space-y-1">
                <Label htmlFor="targetCommand">
                  {t('scheduler.form.target_command', 'Target Command')}
                </Label>
                <ComboboxInput
                  value={targetCommand}
                  onChange={(next) => setFormValue && setFormValue('targetCommand', next)}
                  placeholder={t('scheduler.form.target_command.placeholder', 'Search commands...')}
                  loadSuggestions={loaders.loadCommandOptions}
                  allowCustomValues={false}
                />
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: 'targetPayload',
      type: 'custom',
      label: t('scheduler.form.target_payload', 'Job Arguments (JSON)'),
      description: t('scheduler.form.target_payload.description', 'Optional JSON payload. Fields tenantId and organizationId are injected automatically at execution time.'),
      component: (props) => <PayloadJsonEditor {...props} />,
    },
  ]
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function scheduledJobGroups(t: (key: string, fallback: string) => string): CrudFormGroup[] {
  return [
    {
      id: 'basic',
      title: t('scheduler.form.group.basic', 'Basic Information'),
      fields: ['name', 'description', 'scopeType'],
    },
    {
      id: 'schedule',
      title: t('scheduler.form.group.schedule', 'Schedule Configuration'),
      fields: ['scheduleType', 'scheduleValue', 'timezone'],
    },
    {
      id: 'target',
      title: t('scheduler.form.group.target', 'Target Configuration'),
      fields: ['targetType', 'targetFields', 'targetPayload'],
    },
  ]
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

export function buildScheduledJobPayload(
  values: ScheduleFormValues,
  isEnabled: boolean
): Record<string, unknown> {
  const targetPayload = values.targetPayload && Object.keys(values.targetPayload).length > 0
    ? values.targetPayload
    : null

  return {
    ...values,
    targetPayload,
    isEnabled,
  }
}
