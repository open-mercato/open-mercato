"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { useT } from '@/lib/i18n/context'
import { AttendeeCrudForm, type AttendeeFormValues } from '@open-mercato/core/modules/booking/components/AttendeeCrudForm'

type AttendeeRecord = {
  id: string
  eventId?: string | null
  event_id?: string | null
  customerId?: string | null
  customer_id?: string | null
  firstName?: string | null
  first_name?: string | null
  lastName?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  addressLine1?: string | null
  address_line1?: string | null
  addressLine2?: string | null
  address_line2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  postal_code?: string | null
  country?: string | null
  attendeeType?: string | null
  attendee_type?: string | null
  externalRef?: string | null
  external_ref?: string | null
  tags?: string[]
  notes?: string | null
  eventTitle?: string | null
  eventStartsAt?: string | null
  eventEndsAt?: string | null
  customerDisplayName?: string | null
  customerKind?: string | null
  customFields?: Record<string, unknown> | null
} & Record<string, unknown>

type AttendeeResponse = {
  items?: AttendeeRecord[]
}

export default function BookingAttendeeDetailPage({ params }: { params?: { id?: string } }) {
  const attendeeId = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [initialValues, setInitialValues] = React.useState<AttendeeFormValues | null>(null)
  const [eventOptions, setEventOptions] = React.useState<LookupSelectItem[]>([])
  const [customerOptions, setCustomerOptions] = React.useState<LookupSelectItem[]>([])
  const flashShownRef = React.useRef(false)

  React.useEffect(() => {
    if (!attendeeId) return
    const attendeeIdValue = attendeeId
    let cancelled = false
    async function loadAttendee() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: attendeeIdValue })
        const payload = await readApiResultOrThrow<AttendeeResponse>(
          `/api/booking/event-attendees?${params.toString()}`,
          undefined,
          { errorMessage: t('booking.attendees.form.errors.load', 'Failed to load attendee.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('booking.attendees.form.errors.notFound', 'Attendee not found.'))
        const customFields = extractCustomFieldEntries(record)
        if (cancelled) return
        const eventId = record.eventId ?? record.event_id ?? null
        if (eventId && record.eventTitle) {
          setEventOptions([{
            id: eventId,
            title: record.eventTitle,
            subtitle: formatEventRange(record.eventStartsAt ?? null, record.eventEndsAt ?? null),
          }])
        }
        const customerId = record.customerId ?? record.customer_id ?? null
        if (customerId && record.customerDisplayName) {
          setCustomerOptions([{
            id: customerId,
            title: record.customerDisplayName,
            rightLabel: record.customerKind ?? null,
          }])
        }
        setInitialValues({
          id: record.id,
          eventId,
          customerId,
          firstName: record.firstName ?? record.first_name ?? '',
          lastName: record.lastName ?? record.last_name ?? '',
          email: record.email ?? null,
          phone: record.phone ?? null,
          addressLine1: record.addressLine1 ?? record.address_line1 ?? null,
          addressLine2: record.addressLine2 ?? record.address_line2 ?? null,
          city: record.city ?? null,
          region: record.region ?? null,
          postalCode: record.postalCode ?? record.postal_code ?? null,
          country: record.country ?? null,
          attendeeType: record.attendeeType ?? record.attendee_type ?? null,
          externalRef: record.externalRef ?? record.external_ref ?? null,
          tags: Array.isArray(record.tags) ? record.tags : [],
          notes: record.notes ?? null,
          ...customFields,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : t('booking.attendees.form.errors.load', 'Failed to load attendee.')
        flash(message, 'error')
      }
    }
    loadAttendee()
    return () => { cancelled = true }
  }, [attendeeId, t])

  React.useEffect(() => {
    if (!searchParams) return
    const created = searchParams.get('created') === '1'
    if (created && !flashShownRef.current) {
      flashShownRef.current = true
      flash(t('booking.attendees.form.flash.created', 'Attendee created.'), 'success')
    }
  }, [searchParams, t])

  const handleSubmit = React.useCallback(async (values: AttendeeFormValues) => {
    if (!attendeeId) return
    const customFields = collectCustomFieldValues(values)
    const payload: Record<string, unknown> = {
      id: attendeeId,
      eventId: values.eventId ? String(values.eventId) : null,
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
    await updateCrud('booking/event-attendees', payload, {
      errorMessage: t('booking.attendees.form.errors.update', 'Failed to update attendee.'),
    })
    flash(t('booking.attendees.form.flash.updated', 'Attendee updated.'), 'success')
  }, [attendeeId, t])

  const handleDelete = React.useCallback(async () => {
    if (!attendeeId) return
    await deleteCrud('booking/event-attendees', attendeeId, {
      errorMessage: t('booking.attendees.form.errors.delete', 'Failed to delete attendee.'),
    })
    flash(t('booking.attendees.form.flash.deleted', 'Attendee deleted.'), 'success')
    router.push('/backend/booking/attendees')
  }, [attendeeId, router, t])

  return (
    <Page>
      <PageBody>
        <AttendeeCrudForm
          title={t('booking.attendees.form.editTitle', 'Edit attendee')}
          submitLabel={t('booking.attendees.form.actions.save', 'Save')}
          backHref="/backend/booking/attendees"
          cancelHref="/backend/booking/attendees"
          initialValues={initialValues ?? undefined}
          initialEventOptions={eventOptions}
          initialCustomerOptions={customerOptions}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          deleteVisible
          isLoading={!initialValues}
          loadingMessage={t('booking.attendees.form.loading', 'Loading attendee...')}
        />
      </PageBody>
    </Page>
  )
}

function formatEventRange(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return `${formatter.format(startDate)} → ${formatter.format(endDate)}`
}
