"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  type ScheduleFormValues,
  createTargetOptionsLoader,
  loadTimezoneOptions,
  scheduledJobFormSchema,
  scheduledJobFields,
  scheduledJobGroups,
  ScheduledJobEnabledSwitch,
  buildScheduledJobPayload,
} from '../../../../../lib/scheduledJobFormConfig'

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

  const { loadQueueOptions, loadCommandOptions } = React.useMemo(
    () => createTargetOptionsLoader(apiCall),
    []
  )

  React.useEffect(() => {
    async function fetchSchedule() {
      try {
        const { result } = await apiCallOrThrow<{ items: ScheduleData[] }>(
          `/api/scheduler/jobs?id=${params.id}`
        )

        const schedule = result?.items?.[0]
        if (schedule) {
          setIsEnabled(schedule.isEnabled)

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
            targetPayload: (schedule.targetPayload && Object.keys(schedule.targetPayload).length > 0)
              ? schedule.targetPayload
              : undefined,
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

  const formSchema = React.useMemo(() => scheduledJobFormSchema(t), [t])

  const fields = React.useMemo(
    () => scheduledJobFields(t, { loadQueueOptions, loadCommandOptions, loadTimezoneOptions }),
    [t, loadQueueOptions, loadCommandOptions]
  )

  const groups = React.useMemo(() => scheduledJobGroups(t), [t])

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
            <ScheduledJobEnabledSwitch isEnabled={isEnabled} setIsEnabled={setIsEnabled} t={t} />
          }
          onSubmit={async (values) => {
            const payload = buildScheduledJobPayload(values, isEnabled)

            await updateCrud(
              'scheduler/jobs',
              { id: params.id, ...payload }
            )

            flash(t('scheduler.success.updated', 'Schedule updated successfully'), 'success')
            router.push('/backend/config/scheduled-jobs')
          }}
        />
      </PageBody>
    </Page>
  )
}
