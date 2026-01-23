"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
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
  isEnabled: boolean
}

export default function EditSchedulePage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [initialData, setInitialData] = React.useState<Partial<ScheduleFormValues> | null>(null)

  React.useEffect(() => {
    async function fetchSchedule() {
      try {
        const { result } = await apiCallOrThrow<{ items: ScheduleData[] }>(
          `/api/scheduler/jobs?id=${params.id}`
        )

        const schedule = result?.items?.[0]
        if (schedule) {
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
        timezone: z.string().optional(),
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
        name: 'name',
        type: 'text',
        label: t('scheduler.form.name', 'Name'),
        required: true,
      },
      {
        id: 'description',
        name: 'description',
        type: 'textarea',
        label: t('scheduler.form.description', 'Description'),
      },
      {
        id: 'scheduleType',
        name: 'scheduleType',
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
        name: 'scheduleValue',
        type: 'text',
        label: t('scheduler.form.schedule_value', 'Schedule Value'),
        placeholder: t('scheduler.form.schedule_value.placeholder', 'e.g. 0 */6 * * * or 15m'),
        description: t('scheduler.form.schedule_value.description', 'For cron: use cron expression (e.g., "0 0 * * *"). For interval: use format like "15m", "2h", "1d" (s=seconds, m=minutes, h=hours, d=days)'),
        required: true,
      },
      {
        id: 'timezone',
        name: 'timezone',
        type: 'text',
        label: t('scheduler.form.timezone', 'Timezone'),
        placeholder: 'UTC',
      },
      {
        id: 'targetType',
        name: 'targetType',
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
        id: 'isEnabled',
        name: 'isEnabled',
        type: 'checkbox',
        label: t('scheduler.form.is_enabled', 'Enabled'),
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
        <CrudForm
          title={t('scheduler.edit.title', 'Edit Schedule')}
          backHref="/backend/config/scheduled-jobs"
          fields={fields}
          initialValues={initialData}
          submitLabel={t('scheduler.form.save', 'Save Changes')}
          cancelHref="/backend/config/scheduled-jobs"
          schema={formSchema}
          onSubmit={async (values) => {
            await updateCrud(
              'scheduler/jobs',
              { id: params.id, ...values }
            )

            flash(t('scheduler.success.updated', 'Schedule updated successfully'), 'success')
            router.push('/backend/config/scheduled-jobs')
          }}
        />
      </PageBody>
    </Page>
  )
}
