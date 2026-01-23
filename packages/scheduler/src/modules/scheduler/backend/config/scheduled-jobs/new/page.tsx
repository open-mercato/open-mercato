"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Label } from '@open-mercato/ui/primitives/label'
import { z } from 'zod'
import { Input } from '@open-mercato/ui/primitives/input'

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
  isEnabled: boolean
}

export default function NewSchedulePage() {
  const t = useT()
  const router = useRouter()
  const [isEnabled, setIsEnabled] = React.useState(true)

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
        fields: ['targetType', 'targetFields'],
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
          contentHeader={
            <div className="flex items-center justify-end gap-2 mb-4">
              <Label htmlFor="enabled-switch" className="text-sm font-medium">
                {t('scheduler.form.is_enabled', 'Enabled')}
              </Label>
              <Switch
                id="enabled-switch"
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
              />
            </div>
          }
          onSubmit={async (values) => {
            await createCrud<{ id?: string }>(
              'scheduler/jobs',
              { ...values, isEnabled }
            )

            flash(t('scheduler.success.created', 'Schedule created successfully'), 'success')
            router.push('/backend/config/scheduled-jobs')
          }}
        />
      </PageBody>
    </Page>
  )
}
