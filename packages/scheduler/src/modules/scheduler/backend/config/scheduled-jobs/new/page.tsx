"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  type ScheduleFormValues,
  createTargetOptionsLoader,
  loadTimezoneOptions,
  scheduledJobFormSchema,
  scheduledJobFields,
  scheduledJobGroups,
  ScheduledJobEnabledSwitch,
  buildScheduledJobPayload,
} from '../../../../lib/scheduledJobFormConfig'

export default function NewSchedulePage() {
  const t = useT()
  const router = useRouter()
  const [isEnabled, setIsEnabled] = React.useState(true)

  const { loadQueueOptions, loadCommandOptions } = React.useMemo(
    () => createTargetOptionsLoader(apiCall),
    []
  )

  const formSchema = React.useMemo(() => scheduledJobFormSchema(t), [t])

  const fields = React.useMemo(
    () => scheduledJobFields(t, { loadQueueOptions, loadCommandOptions, loadTimezoneOptions }),
    [t, loadQueueOptions, loadCommandOptions]
  )

  const groups = React.useMemo(() => scheduledJobGroups(t), [t])

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
            <ScheduledJobEnabledSwitch isEnabled={isEnabled} setIsEnabled={setIsEnabled} t={t} />
          }
          onSubmit={async (values) => {
            const payload = buildScheduledJobPayload(values, isEnabled)

            await createCrud<{ id?: string }>(
              'scheduler/jobs',
              payload
            )

            flash(t('scheduler.success.created', 'Schedule created successfully'), 'success')
            router.push('/backend/config/scheduled-jobs')
          }}
        />
      </PageBody>
    </Page>
  )
}
