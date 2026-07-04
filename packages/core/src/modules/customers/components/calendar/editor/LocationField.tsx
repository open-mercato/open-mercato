"use client"

import * as React from 'react'
import { MapPin, Phone } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Field } from './inputs'
import { fetchPeoplePhones, type ContactPhone } from './lookups'

// Below the Call "Phone / link" field: when a linked contact has a primary
// phone and the field is still empty, offer it as a one-click suggestion chip
// showing the actual number (#3552). Companies/staff have no phone and never
// appear. The chips vanish once the field is filled.
function PhoneSuggestions({
  contactIds,
  onPick,
}: {
  contactIds: string[]
  onPick(phone: string): void
}) {
  const t = useT()
  const [contacts, setContacts] = React.useState<ContactPhone[]>([])
  const idsKey = contactIds.join(',')

  React.useEffect(() => {
    if (contactIds.length === 0) {
      setContacts([])
      return
    }
    const controller = new AbortController()
    let cancelled = false
    fetchPeoplePhones(contactIds, controller.signal).then((found) => {
      if (!cancelled) setContacts(found)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey captures the ids
  }, [idsKey])

  if (contacts.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
      {contacts.map((contact) => (
        <button
          key={contact.id}
          type="button"
          onClick={() => onPick(contact.phone)}
          title={t('customers.calendar.editor.phoneSuggestion.use', 'Use {name}’s number', { name: contact.name })}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Phone aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{contact.name}</span>
          <span className="shrink-0 tabular-nums text-foreground">{contact.phone}</span>
        </button>
      ))}
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
  /** Person ids whose phone can be suggested (Call variant only). */
  phoneContactIds?: string[]
}) {
  const t = useT()
  const label = variant === 'phoneLink'
    ? t('customers.calendar.editor.phoneLink', 'Phone / link')
    : t('customers.calendar.editor.location', 'Location')
  const placeholder = variant === 'phoneLink'
    ? t('customers.calendar.editor.phoneLinkPlaceholder', 'Add a phone number or link…')
    : t('customers.calendar.editor.locationPlaceholder', 'Add a location or link…')
  // Suggestions only help while the field is empty — once filled they'd be noise.
  const showSuggestions = variant === 'phoneLink' && value.trim().length === 0
  return (
    <Field label={label}>
      <Input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        leftIcon={variant === 'phoneLink' ? <Phone /> : <MapPin />}
      />
      {showSuggestions ? (
        <PhoneSuggestions contactIds={phoneContactIds ?? []} onPick={(phone) => onChange(phone)} />
      ) : null}
    </Field>
  )
}
