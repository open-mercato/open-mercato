"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Label } from '@open-mercato/ui/primitives/label'
import { z } from 'zod'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'

type ScheduleFormValues = {
  name: string
  description?: string
  scopeType: 'system' | 'organization' | 'tenant'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  targetType: 'queue' | 'command'
  targetQueue?: string
  targetCommand?: string
  targetPayload?: Record<string, unknown>
  isEnabled: boolean
}

type TargetOptions = {
  queues: ComboboxOption[]
  commands: ComboboxOption[]
}

function PayloadJsonEditor({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  return (
    <JsonBuilder
      value={value || {}}
      onChange={setValue}
      disabled={disabled}
    />
  )
}

export default function NewSchedulePage() {
  const t = useT()
  const router = useRouter()
  const [isEnabled, setIsEnabled] = React.useState(true)
  const targetOptionsRef = React.useRef<TargetOptions | null>(null)

  const loadTargetOptions = React.useCallback(async (): Promise<TargetOptions> => {
    if (targetOptionsRef.current) return targetOptionsRef.current
    try {
      const { result } = await apiCall<TargetOptions>('/api/scheduler/targets')
      const options = result ?? { queues: [], commands: [] }
      targetOptionsRef.current = options
      return options
    } catch {
      return { queues: [], commands: [] }
    }
  }, [])

  const loadQueueOptions = React.useCallback(async (query?: string): Promise<ComboboxOption[]> => {
    const options = await loadTargetOptions()
    if (!query) return options.queues
    const lower = query.toLowerCase()
    return options.queues.filter((q) => q.label.toLowerCase().includes(lower))
  }, [loadTargetOptions])

  const loadCommandOptions = React.useCallback(async (query?: string): Promise<ComboboxOption[]> => {
    const options = await loadTargetOptions()
    if (!query) return options.commands
    const lower = query.toLowerCase()
    return options.commands.filter((c) => c.label.toLowerCase().includes(lower))
  }, [loadTargetOptions])

  // Load timezone options - filtering on query for better performance
  const loadTimezoneOptions = React.useCallback(async (query?: string) => {
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
  }, [])

  const formSchema = React.useMemo(
    () =>
      z.object({
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
      }),
    [t]
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
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
        loadOptions: loadTimezoneOptions,
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
                <div>
                  <Label htmlFor="targetQueue">
                    {t('scheduler.form.target_queue', 'Target Queue')}
                  </Label>
                  <ComboboxInput
                    value={targetQueue}
                    onChange={(next) => setFormValue && setFormValue('targetQueue', next)}
                    placeholder={t('scheduler.form.target_queue.placeholder', 'Search queues...')}
                    loadSuggestions={loadQueueOptions}
                    allowCustomValues={true}
                  />
                </div>
              )}
              {targetType === 'command' && (
                <div>
                  <Label htmlFor="targetCommand">
                    {t('scheduler.form.target_command', 'Target Command')}
                  </Label>
                  <ComboboxInput
                    value={targetCommand}
                    onChange={(next) => setFormValue && setFormValue('targetCommand', next)}
                    placeholder={t('scheduler.form.target_command.placeholder', 'Search commands...')}
                    loadSuggestions={loadCommandOptions}
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
    ],
    [t, loadTimezoneOptions, loadQueueOptions, loadCommandOptions]
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
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
    ],
    [t]
  )

  const initialValues = React.useMemo<Partial<ScheduleFormValues>>(
    () => ({
      scopeType: 'tenant',
      scheduleType: 'cron',
      targetType: 'queue',
      isEnabled: true,
      timezone: 'UTC',
    }),
    []
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<ScheduleFormValues>
          title={t('scheduler.create.title', 'Create Schedule')}
          backHref="/backend/config/scheduled-jobs"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('scheduler.form.submit', 'Create Schedule')}
          cancelHref="/backend/config/scheduled-jobs"
          schema={formSchema}
          extraActions={
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
          }
          onSubmit={async (values) => {
            const targetPayload = values.targetPayload && Object.keys(values.targetPayload).length > 0
              ? values.targetPayload
              : null

            await createCrud<{ id?: string }>(
              'scheduler/jobs',
              { 
                ...values, 
                targetPayload,
                isEnabled 
              }
            )

            flash(t('scheduler.success.created', 'Schedule created successfully'), 'success')
            router.push('/backend/config/scheduled-jobs')
          }}
        />
      </PageBody>
    </Page>
  )
}
