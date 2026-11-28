"use client"

import * as React from 'react'
import { format } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { GLOBAL_MUTATION_INJECTION_SPOT_ID } from '@open-mercato/ui/backend/injection/mutationEvents'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { calendarInstantToWallTime, defaultCalendarTimezone } from '../../lib/calendar/timezone'

const getToday = (timezone: string) => calendarInstantToWallTime(new Date(), timezone).date
const departureDateError = 'customers.companies.detail.employment.dateInvalid'

type EndEmploymentDialogProps = {
  companyId: string
  personId: string
  personName: string
  updatedAt: string
  onClose: () => void
  onEnded: () => void
}

export function EndEmploymentDialog({ companyId, personId, personName, updatedAt, onClose, onEnded }: EndEmploymentDialogProps) {
  const t = useT()
  const [timezone] = React.useState(defaultCalendarTimezone)
  const formSchema = React.useMemo(() => z.object({
    endedOn: z.iso.date(departureDateError).refine((date) => date <= getToday(timezone), departureDateError),
  }), [timezone])
  const title = t('customers.companies.detail.employment.end', 'End employment')
  const dateLabel = t('customers.companies.detail.employment.departureDate', 'Departure date')
  const fields = React.useMemo<CrudField[]>(() => [{
    id: 'endedOn',
    label: dateLabel,
    required: true,
    type: 'custom',
    component: ({ id, value, setValue, disabled }) => (
      <DatePicker
        id={id}
        aria-label={dateLabel}
        value={typeof value === 'string' && value ? parseISO(value) : null}
        onChange={(date) => setValue(date ? format(date, 'yyyy-MM-dd') : '')}
        maxDate={parseISO(getToday(timezone))}
        footer="none"
        disabled={disabled}
        required
      />
    ),
  }], [dateLabel, timezone])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onKeyDown={(event) => {
        if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
        event.preventDefault()
        event.currentTarget.querySelector('form')?.requestSubmit()
      }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t('customers.companies.detail.employment.endDescription', 'Record the last day {name} worked at this company.', { name: personName })}
          </DialogDescription>
        </DialogHeader>
        <CrudForm<z.infer<typeof formSchema>>
          embedded
          density="compact"
          injectionSpotId={GLOBAL_MUTATION_INJECTION_SPOT_ID}
          resourceKind="customers.person"
          resourceId={personId}
          optimisticLockUpdatedAt={updatedAt}
          fields={fields}
          schema={formSchema}
          submitLabel={title}
          onSubmit={async ({ endedOn }) => {
            await apiCallOrThrow(`/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(companyId)}/end`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ endedOn, timezone }),
            }, { errorMessage: t('customers.companies.detail.employment.saveError', 'Failed to end employment.') })
          }}
          onSubmitSuccess={onEnded}
          extraActions={<Button type="button" variant="outline" onClick={onClose}>{t('ui.forms.actions.cancel', 'Cancel')}</Button>}
        />
      </DialogContent>
    </Dialog>
  )
}
