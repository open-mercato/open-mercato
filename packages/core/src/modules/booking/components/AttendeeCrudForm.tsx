"use client"

import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { E } from '#generated/entities.ids.generated'

type AttendeeFormValues = {
  id?: string
  eventId?: string | null
  customerId?: string | null
  firstName?: string
  lastName?: string
  email?: string | null
  phone?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  attendeeType?: string | null
  externalRef?: string | null
  tags?: string[]
  notes?: string | null
}

type EventOption = {
  id?: string
  title?: string
  startsAt?: string
  endsAt?: string
}

type EventOptionsResponse = {
  items?: EventOption[]
}

type CustomerOptionRow = {
  id?: string
  displayName?: string | null
  display_name?: string | null
  primaryEmail?: string | null
  primary_email?: string | null
  primaryPhone?: string | null
  primary_phone?: string | null
}

type CustomerOptionsResponse = {
  items?: CustomerOptionRow[]
}

type AttendeeCrudFormProps = {
  title: string
  submitLabel: string
  initialValues?: Partial<AttendeeFormValues>
  onSubmit: (values: AttendeeFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
  cancelHref?: string
  backHref?: string
  deleteVisible?: boolean
  initialEventOptions?: LookupSelectItem[]
  initialCustomerOptions?: LookupSelectItem[]
}

function formatEventRange(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return `${formatter.format(startDate)} → ${formatter.format(endDate)}`
}

function mergeLookupOptions(existing: LookupSelectItem[], incoming: LookupSelectItem[]): LookupSelectItem[] {
  const map = new Map(existing.map((opt) => [opt.id, opt]))
  incoming.forEach((opt) => map.set(opt.id, opt))
  return Array.from(map.values())
}

export function AttendeeCrudForm({
  title,
  submitLabel,
  initialValues,
  onSubmit,
  onDelete,
  isLoading,
  loadingMessage,
  cancelHref,
  backHref,
  deleteVisible,
  initialEventOptions,
  initialCustomerOptions,
}: AttendeeCrudFormProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [eventOptions, setEventOptions] = React.useState<LookupSelectItem[]>(initialEventOptions ?? [])
  const [customerOptions, setCustomerOptions] = React.useState<LookupSelectItem[]>(initialCustomerOptions ?? [])
  const [converting, setConverting] = React.useState(false)

  React.useEffect(() => {
    if (initialEventOptions?.length) {
      setEventOptions((prev) => mergeLookupOptions(prev, initialEventOptions))
    }
  }, [initialEventOptions])

  React.useEffect(() => {
    if (initialCustomerOptions?.length) {
      setCustomerOptions((prev) => mergeLookupOptions(prev, initialCustomerOptions))
    }
  }, [initialCustomerOptions])

  const fetchEventOptions = React.useCallback(async (query?: string): Promise<LookupSelectItem[]> => {
    const params = new URLSearchParams({ pageSize: '50' })
    if (query && query.trim().length) params.set('search', query.trim())
    const call = await apiCall<EventOptionsResponse>(`/api/booking/event-options?${params.toString()}`)
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    const options = items
      .map((event): LookupSelectItem | null => {
        const id = typeof event.id === 'string' ? event.id : null
        const title = typeof event.title === 'string' ? event.title : null
        if (!id || !title) return null
        return {
          id,
          title,
          subtitle: formatEventRange(event.startsAt ?? null, event.endsAt ?? null),
        }
      })
      .filter((option): option is LookupSelectItem => option !== null)
    setEventOptions((prev) => mergeLookupOptions(prev, options))
    return options
  }, [])

  const mapCustomerRows = React.useCallback((items: CustomerOptionRow[], kindLabel: string) => (
    items
      .map((entry): LookupSelectItem | null => {
        const id = typeof entry.id === 'string' ? entry.id : null
        const displayName = typeof entry.displayName === 'string'
          ? entry.displayName
          : typeof entry.display_name === 'string'
            ? entry.display_name
            : null
        if (!id || !displayName) return null
        const email = typeof entry.primaryEmail === 'string'
          ? entry.primaryEmail
          : typeof entry.primary_email === 'string'
            ? entry.primary_email
            : null
        const phone = typeof entry.primaryPhone === 'string'
          ? entry.primaryPhone
          : typeof entry.primary_phone === 'string'
            ? entry.primary_phone
            : null
        const subtitle = email || phone || null
        return {
          id,
          title: displayName,
          subtitle,
          rightLabel: kindLabel,
        }
      })
      .filter((option): option is LookupSelectItem => option !== null)
  ), [])

  const fetchCustomerOptions = React.useCallback(async (query?: string): Promise<LookupSelectItem[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '50' })
    if (query && query.trim().length) params.set('search', query.trim())
    const [peopleCall, companyCall] = await Promise.all([
      apiCall<CustomerOptionsResponse>(`/api/customers/people?${params.toString()}`),
      apiCall<CustomerOptionsResponse>(`/api/customers/companies?${params.toString()}`),
    ])
    const people = Array.isArray(peopleCall.result?.items) ? peopleCall.result.items : []
    const companies = Array.isArray(companyCall.result?.items) ? companyCall.result.items : []
    const options = [
      ...mapCustomerRows(people, t('booking.attendees.customer.kind.person', 'Person')),
      ...mapCustomerRows(companies, t('booking.attendees.customer.kind.company', 'Company')),
    ]
    setCustomerOptions((prev) => mergeLookupOptions(prev, options))
    return options
  }, [mapCustomerRows, t])

  React.useEffect(() => {
    setEventOptions([])
    setCustomerOptions([])
  }, [scopeVersion])

  const handleConvertCustomer = React.useCallback(async (
    values: Record<string, unknown> | undefined,
    setFormValue?: (id: string, value: unknown) => void,
  ) => {
    if (!values) return
    const firstName = typeof values.firstName === 'string' ? values.firstName.trim() : ''
    const lastName = typeof values.lastName === 'string' ? values.lastName.trim() : ''
    if (!firstName || !lastName) {
      flash(t('booking.attendees.form.errors.convertMissing', 'First and last name are required to create a customer.'), 'error')
      return
    }
    const displayName = `${firstName} ${lastName}`.trim()
    const payload: Record<string, unknown> = {
      firstName,
      lastName,
      displayName,
    }
    const email = typeof values.email === 'string' ? values.email.trim() : ''
    if (email) payload.primaryEmail = email
    const phone = typeof values.phone === 'string' ? values.phone.trim() : ''
    if (phone) payload.primaryPhone = phone

    try {
      setConverting(true)
      const { result } = await createCrud<{ id?: string; personId?: string }>('customers/people', payload, {
        errorMessage: t('booking.attendees.form.errors.convertFailed', 'Failed to create customer.'),
      })
      const customerId = typeof result?.personId === 'string'
        ? result.personId
        : typeof result?.id === 'string'
          ? result.id
          : null
      if (!customerId) return
      setCustomerOptions((prev) => mergeLookupOptions(prev, [{
        id: customerId,
        title: displayName,
        subtitle: email || phone || null,
        rightLabel: t('booking.attendees.customer.kind.person', 'Person'),
      }]))
      setFormValue?.('customerId', customerId)
      flash(t('booking.attendees.form.fields.customer.converted', 'Customer created and linked.'), 'success')
    } finally {
      setConverting(false)
    }
  }, [t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'eventId',
      label: t('booking.attendees.form.fields.event', 'Booking'),
      type: 'custom',
      required: true,
      component: ({ value, setValue }) => (
        <LookupSelect
          value={typeof value === 'string' ? value : null}
          onChange={(next) => setValue(next)}
          options={eventOptions}
          fetchOptions={fetchEventOptions}
          placeholder={t('booking.attendees.form.fields.event.placeholder', 'Select a booking')}
          searchPlaceholder={t('booking.attendees.form.fields.event.search', 'Search bookings')}
          emptyLabel={t('booking.attendees.form.fields.event.empty', 'No bookings found')}
          selectedHintLabel={(id) => t('booking.attendees.form.fields.event.selected', 'Selected booking: {{id}}', { id })}
        />
      ),
    },
    {
      id: 'customerId',
      label: t('booking.attendees.form.fields.customer', 'Customer'),
      type: 'custom',
      component: ({ value, setValue, values, setFormValue }) => {
        const hasCustomer = typeof value === 'string' && value.length > 0
        return (
          <div className="space-y-3">
            <LookupSelect
              value={typeof value === 'string' ? value : null}
              onChange={(next) => setValue(next)}
              options={customerOptions}
              fetchOptions={fetchCustomerOptions}
              placeholder={t('booking.attendees.form.fields.customer.placeholder', 'Select a customer')}
              searchPlaceholder={t('booking.attendees.form.fields.customer.search', 'Search customers')}
              emptyLabel={t('booking.attendees.form.fields.customer.empty', 'No customers found')}
              selectedHintLabel={(id) => t('booking.attendees.form.fields.customer.selected', 'Selected customer: {{id}}', { id })}
            />
            {!hasCustomer ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={converting}
                onClick={() => handleConvertCustomer(values, setFormValue)}
              >
                {t('booking.attendees.form.fields.customer.convert', 'Convert to new customer')}
              </Button>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'firstName',
      label: t('booking.attendees.form.fields.firstName', 'First name'),
      type: 'text',
      required: true,
    },
    {
      id: 'lastName',
      label: t('booking.attendees.form.fields.lastName', 'Last name'),
      type: 'text',
      required: true,
    },
    {
      id: 'email',
      label: t('booking.attendees.form.fields.email', 'Email'),
      type: 'text',
    },
    {
      id: 'phone',
      label: t('booking.attendees.form.fields.phone', 'Phone'),
      type: 'text',
    },
    {
      id: 'attendeeType',
      label: t('booking.attendees.form.fields.attendeeType', 'Attendee type'),
      type: 'text',
    },
    {
      id: 'externalRef',
      label: t('booking.attendees.form.fields.externalRef', 'External reference'),
      type: 'text',
    },
    {
      id: 'addressLine1',
      label: t('booking.attendees.form.fields.addressLine1', 'Address line 1'),
      type: 'text',
    },
    {
      id: 'addressLine2',
      label: t('booking.attendees.form.fields.addressLine2', 'Address line 2'),
      type: 'text',
    },
    {
      id: 'city',
      label: t('booking.attendees.form.fields.city', 'City'),
      type: 'text',
    },
    {
      id: 'region',
      label: t('booking.attendees.form.fields.region', 'Region'),
      type: 'text',
    },
    {
      id: 'postalCode',
      label: t('booking.attendees.form.fields.postalCode', 'Postal code'),
      type: 'text',
    },
    {
      id: 'country',
      label: t('booking.attendees.form.fields.country', 'Country'),
      type: 'text',
    },
    {
      id: 'tags',
      label: t('booking.attendees.form.fields.tags', 'Tags'),
      type: 'tags',
    },
    {
      id: 'notes',
      label: t('booking.attendees.form.fields.notes', 'Notes'),
      type: 'textarea',
    },
  ], [
    customerOptions,
    eventOptions,
    fetchCustomerOptions,
    fetchEventOptions,
    handleConvertCustomer,
    converting,
    t,
  ])

  return (
    <CrudForm
      title={title}
      submitLabel={submitLabel}
      fields={fields}
      initialValues={initialValues}
      entityId={E.booking.booking_event_attendee}
      onSubmit={onSubmit}
      onDelete={onDelete}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
      cancelHref={cancelHref}
      backHref={backHref}
      deleteVisible={deleteVisible}
    />
  )
}

export type { AttendeeFormValues }
