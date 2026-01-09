"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'

export default function BookingAvailabilityRuleSetCreatePage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('booking.availabilityRuleSets.form.fields.name', 'Name'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: t('booking.availabilityRuleSets.form.fields.description', 'Description'),
      type: 'richtext',
      editor: 'markdown',
    },
    {
      id: 'timezone',
      label: t('booking.availabilityRuleSets.form.fields.timezone', 'Timezone'),
      type: 'text',
      required: true,
    },
  ], [t])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    const payload = {
      name: typeof values.name === 'string' ? values.name : '',
      description: typeof values.description === 'string' && values.description.trim().length ? values.description : null,
      timezone: typeof values.timezone === 'string' && values.timezone.trim().length ? values.timezone.trim() : 'UTC',
    }
    const response = await createCrud('booking/availability-rule-sets', payload, {
      errorMessage: t('booking.availabilityRuleSets.form.errors.create', 'Failed to create schedule.'),
    })
    const id = response.result?.id
    flash(t('booking.availabilityRuleSets.form.flash.created', 'Schedule created.'), 'success')
    if (id) {
      router.push(`/backend/booking/availability-rulesets/${id}`)
    } else {
      router.push('/backend/booking/availability-rulesets')
    }
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('booking.availabilityRuleSets.form.createTitle', 'Create schedule')}
          backHref="/backend/booking/availability-rulesets"
          cancelHref="/backend/booking/availability-rulesets"
          fields={fields}
          submitLabel={t('booking.availabilityRuleSets.form.actions.create', 'Create')}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
