"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { AvailabilityRuleSetForm, buildAvailabilityRuleSetPayload, type AvailabilityRuleSetFormValues } from '@open-mercato/core/modules/booking/components/AvailabilityRuleSetForm'

export default function BookingAvailabilityRuleSetCreatePage() {
  const translate = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: AvailabilityRuleSetFormValues) => {
    const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const payload = buildAvailabilityRuleSetPayload(values, { timezone: defaultTimezone })
    const response = await createCrud('booking/availability-rule-sets', payload, {
      errorMessage: translate('booking.availabilityRuleSets.form.errors.create', 'Failed to create schedule.'),
    })
    const id = response.result?.id
    flash(translate('booking.availabilityRuleSets.form.flash.created', 'Schedule created.'), 'success')
    if (id) {
      router.push(`/backend/booking/availability-rulesets/${id}`)
    } else {
      router.push('/backend/booking/availability-rulesets')
    }
  }, [router, translate])

  return (
    <Page>
      <PageBody>
        <AvailabilityRuleSetForm
          title={translate('booking.availabilityRuleSets.form.createTitle', 'Create schedule')}
          backHref="/backend/booking/availability-rulesets"
          cancelHref="/backend/booking/availability-rulesets"
          submitLabel={translate('booking.availabilityRuleSets.form.actions.create', 'Create')}
          initialValues={{}}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
