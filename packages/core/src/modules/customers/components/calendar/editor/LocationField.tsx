"use client"

import * as React from 'react'
import { MapPin, Phone, UserRound } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Field, DROPDOWN_PANEL_CLASS, useDropdownDismiss } from './inputs'
import { fetchPeoplePhones, type ContactPhone } from './lookups'

// Small trailing button on the Call "Phone / link" field: pulls the primary
// phone number(s) of the linked person + customer attendees and inserts one.
// Companies/staff have no phone in the model, so they simply never appear.
function ContactPhonePicker({ contactIds, onPick }: { contactIds: string[]; onPick(phone: string): void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [contacts, setContacts] = React.useState<ContactPhone[]>([])
  const close = React.useCallback(() => setOpen(false), [])
  const rootRef = useDropdownDismiss(open, close)

  const handleClick = React.useCallback(() => {
    if (loading) return
    const controller = new AbortController()
    setLoading(true)
    fetchPeoplePhones(contactIds, controller.signal)
      .then((found) => {
        if (found.length === 0) {
          flash(t('customers.calendar.editor.phonePicker.none', 'No phone number on the linked contacts'), 'info')
          return
        }
        if (found.length === 1) {
          onPick(found[0].phone)
          return
        }
        setContacts(found)
        setOpen(true)
      })
      .finally(() => setLoading(false))
  }, [contactIds, loading, onPick, t])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <IconButton
        type="button"
        variant="outline"
        size="sm"
        disabled={loading}
        aria-label={t('customers.calendar.editor.phonePicker.trigger', 'Insert phone from contact')}
        title={t('customers.calendar.editor.phonePicker.trigger', 'Insert phone from contact')}
        onClick={handleClick}
        className="h-9 w-9"
      >
        <UserRound aria-hidden className="size-4" />
      </IconButton>
      {open ? (
        <div role="listbox" aria-label={t('customers.calendar.editor.phonePicker.trigger', 'Insert phone from contact')} className={cn(DROPDOWN_PANEL_CLASS, 'right-0 w-64')}>
          {contacts.map((contact) => (
            <Button
              key={contact.id}
              type="button"
              variant="ghost"
              role="option"
              aria-selected={false}
              title={`${contact.name} — ${contact.phone}`}
              onClick={() => {
                onPick(contact.phone)
                setOpen(false)
              }}
              className="h-auto w-full justify-start gap-2 whitespace-normal px-2 py-1.5 text-left text-sm font-normal text-foreground"
            >
              <Phone aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {contact.name}
                <span className="ml-1.5 text-xs text-muted-foreground">{contact.phone}</span>
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function LocationField({
  variant,
  value,
  onChange,
  phoneContactIds,
}: {
  variant: 'location' | 'phoneLink'
  value: string
  onChange(next: string): void
  /** Person ids whose phone can be inserted (Call variant only). */
  phoneContactIds?: string[]
}) {
  const t = useT()
  const label = variant === 'phoneLink'
    ? t('customers.calendar.editor.phoneLink', 'Phone / link')
    : t('customers.calendar.editor.location', 'Location')
  const placeholder = variant === 'phoneLink'
    ? t('customers.calendar.editor.phoneLinkPlaceholder', 'Add a phone number or link…')
    : t('customers.calendar.editor.locationPlaceholder', 'Add a location or link…')
  const showPhonePicker = variant === 'phoneLink' && (phoneContactIds?.length ?? 0) > 0
  return (
    <Field label={label}>
      <div className="flex w-full items-center gap-2">
        <Input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          leftIcon={variant === 'phoneLink' ? <Phone /> : <MapPin />}
          className="min-w-0 flex-1"
        />
        {showPhonePicker ? (
          <ContactPhonePicker contactIds={phoneContactIds ?? []} onPick={(phone) => onChange(phone)} />
        ) : null}
      </div>
    </Field>
  )
}
