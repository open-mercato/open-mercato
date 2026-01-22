"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AvailabilityRuleSetForm, buildAvailabilityRuleSetPayload, type AvailabilityRuleSetFormValues } from '@open-mercato/core/modules/planner/components/AvailabilityRuleSetForm'

export default function PlannerAvailabilityRuleSetCreatePage() {
  const translate = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: AvailabilityRuleSetFormValues) => {
    const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const payload = buildAvailabilityRuleSetPayload(values, { timezone: defaultTimezone })
    const response = await createCrud('planner/availability-rule-sets', payload, {
      errorMessage: translate('planner.availabilityRuleSets.form.errors.create', 'Failed to create schedule.'),
    })
    const id = response.result?.id
    flash(translate('planner.availabilityRuleSets.form.flash.created', 'Schedule created.'), 'success')
    if (id) {
      router.push(`/backend/planner/availability-rulesets/${id}`)
    } else {
      router.push('/backend/planner/availability-rulesets')
    }
  }, [router, translate])

  return (
    <Page>
      <PageBody>
        <AvailabilityRuleSetForm
          title={translate('planner.availabilityRuleSets.form.createTitle', 'Create schedule')}
          backHref="/backend/planner/availability-rulesets"
          cancelHref="/backend/planner/availability-rulesets"
          submitLabel={translate('planner.availabilityRuleSets.form.actions.create', 'Create')}
          initialValues={{}}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
