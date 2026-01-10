"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { useT } from '@/lib/i18n/context'
import { AttendeeCrudForm, type AttendeeFormValues } from '@open-mercato/core/modules/booking/components/AttendeeCrudForm'

export default function BookingAttendeeCreatePage() {
  const t = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: AttendeeFormValues) => {
    const customFields = collectCustomFieldValues(values)
    const payload: Record<string, unknown> = {
      eventId: values.eventId ? String(values.eventId) : '',
      customerId: values.customerId ? String(values.customerId) : null,
      firstName: values.firstName ? String(values.firstName) : '',
      lastName: values.lastName ? String(values.lastName) : '',
      email: typeof values.email === 'string' && values.email.trim().length ? values.email.trim() : null,
      phone: typeof values.phone === 'string' && values.phone.trim().length ? values.phone.trim() : null,
      addressLine1: typeof values.addressLine1 === 'string' && values.addressLine1.trim().length ? values.addressLine1.trim() : null,
      addressLine2: typeof values.addressLine2 === 'string' && values.addressLine2.trim().length ? values.addressLine2.trim() : null,
      city: typeof values.city === 'string' && values.city.trim().length ? values.city.trim() : null,
      region: typeof values.region === 'string' && values.region.trim().length ? values.region.trim() : null,
      postalCode: typeof values.postalCode === 'string' && values.postalCode.trim().length ? values.postalCode.trim() : null,
      country: typeof values.country === 'string' && values.country.trim().length ? values.country.trim() : null,
      attendeeType: typeof values.attendeeType === 'string' && values.attendeeType.trim().length ? values.attendeeType.trim() : null,
      externalRef: typeof values.externalRef === 'string' && values.externalRef.trim().length ? values.externalRef.trim() : null,
      tags: Array.isArray(values.tags) ? values.tags : [],
      notes: typeof values.notes === 'string' && values.notes.trim().length ? values.notes.trim() : null,
      ...(Object.keys(customFields).length ? { customFields } : {}),
    }
    const { result } = await createCrud<{ id?: string }>('booking/event-attendees', payload, {
      errorMessage: t('booking.attendees.form.errors.create', 'Failed to create attendee.'),
    })
    const attendeeId = typeof result?.id === 'string' ? result.id : null
    if (attendeeId) {
      router.push(`/backend/booking/attendees/${encodeURIComponent(attendeeId)}?created=1`)
      return
    }
    router.push('/backend/booking/attendees')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <AttendeeCrudForm
          title={t('booking.attendees.form.createTitle', 'Add attendee')}
          submitLabel={t('booking.attendees.form.actions.create', 'Create')}
          backHref="/backend/booking/attendees"
          cancelHref="/backend/booking/attendees"
          initialValues={{ tags: [], customerId: null }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
