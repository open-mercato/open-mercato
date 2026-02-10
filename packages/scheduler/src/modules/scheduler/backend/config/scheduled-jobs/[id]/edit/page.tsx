"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { z } from 'zod'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'

type ScheduleFormValues = {
  name: string
  description?: string
  scopeType: 'system' | 'organization' | 'tenant'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone?: string
  targetType: 'queue' | 'command'
  targetQueue?: string
  targetCommand?: string
  targetPayload?: string // JSON string
  isEnabled: boolean
}

type ScheduleData = {
  id: string
  name: string
  description?: string | null
  scopeType: 'system' | 'organization' | 'tenant'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  targetType: 'queue' | 'command'
  targetQueue?: string | null
  targetCommand?: string | null
  targetPayload?: Record<string, unknown> | null
  isEnabled: boolean
}

export default function EditSchedulePage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [initialData, setInitialData] = React.useState<Partial<ScheduleFormValues> | null>(null)
  const [isEnabled, setIsEnabled] = React.useState(false)

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

  React.useEffect(() => {
    async function fetchSchedule() {
      try {
        const { result } = await apiCallOrThrow<{ items: ScheduleData[] }>(
          `/api/scheduler/jobs?id=${params.id}`
        )

        const schedule = result?.items?.[0]
        if (schedule) {
          setIsEnabled(schedule.isEnabled)
          
          // Convert targetPayload object to JSON string for the form
          let targetPayloadStr = undefined
          if (schedule.targetPayload && Object.keys(schedule.targetPayload).length > 0) {
            targetPayloadStr = JSON.stringify(schedule.targetPayload, null, 2)
          }
          
          setInitialData({
            name: schedule.name,
            description: schedule.description || undefined,
            scopeType: schedule.scopeType,
            scheduleType: schedule.scheduleType,
            scheduleValue: schedule.scheduleValue,
            timezone: schedule.timezone,
            targetType: schedule.targetType,
            targetQueue: schedule.targetQueue || undefined,
            targetCommand: schedule.targetCommand || undefined,
            targetPayload: targetPayloadStr,
            isEnabled: schedule.isEnabled,
          })
        }
      } catch (err) {
        setError(t('scheduler.error.load_failed', 'Failed to load schedule'))
      } finally {
        setLoading(false)
      }
    }

    fetchSchedule()
  }, [params.id, t])

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
        targetPayload: z.string().optional().refine(
          (val) => {
            if (!val || val.trim() === '') return true
            try {
              JSON.parse(val)
              return true
            } catch {
              return false
            }
          },
          { message: t('scheduler.form.target_payload.invalid_json', 'Must be valid JSON') }
        ),
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
                  <Input
                    id="targetQueue"
                    placeholder={t('scheduler.form.target_queue.placeholder', 'e.g. email-sender')}
                    value={targetQueue}
                    onChange={(e) => setFormValue && setFormValue('targetQueue', e.target.value)}
                  />
                </div>
              )}
              {targetType === 'command' && (
                <div>
                  <Label htmlFor="targetCommand">
                    {t('scheduler.form.target_command', 'Target Command')}
                  </Label>
                  <Input
                    id="targetCommand"
                    placeholder={t('scheduler.form.target_command.placeholder', 'e.g. sync:data')}
                    value={targetCommand}
                    onChange={(e) => setFormValue && setFormValue('targetCommand', e.target.value)}
                  />
                </div>
              )}
            </div>
          )
        },
      },
      {
        id: 'targetPayload',
        type: 'textarea',
        label: t('scheduler.form.target_payload', 'Job Arguments (JSON)'),
        placeholder: t('scheduler.form.target_payload.placeholder', '{\n  "message": "Hello",\n  "value": 42\n}'),
        description: t('scheduler.form.target_payload.description', 'Optional JSON object with arguments to pass to the command or queue job. Must be valid JSON format.'),
      },
    ],
    [t, loadTimezoneOptions]
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

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('scheduler.loading', 'Loading schedule...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !initialData) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error || t('scheduler.error.not_found', 'Schedule not found')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<ScheduleFormValues>
          title={t('scheduler.edit.title', 'Edit Schedule')}
          backHref="/backend/config/scheduled-jobs"
          fields={fields}
          groups={groups}
          initialValues={initialData}
          submitLabel={t('scheduler.form.save', 'Save Changes')}
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
            // Parse targetPayload from JSON string to object
            let targetPayload = null
            if (values.targetPayload && values.targetPayload.trim()) {
              try {
                targetPayload = JSON.parse(values.targetPayload)
              } catch (error) {
                console.error('Failed to parse targetPayload JSON:', error)
                flash(t('scheduler.error.invalidPayload', 'Invalid JSON payload'), 'error')
                return
              }
            }

            await updateCrud(
              'scheduler/jobs',
              { 
                id: params.id, 
                ...values, 
                targetPayload,
                isEnabled 
              }
            )

            flash(t('scheduler.success.updated', 'Schedule updated successfully'), 'success')
            router.push('/backend/config/scheduled-jobs')
          }}
        />
      </PageBody>
    </Page>
  )
}
