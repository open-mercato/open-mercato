'use client'
import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PersonRow = { id?: unknown; display_name?: unknown; primary_email?: unknown }

export type CustomerPickerProps = {
  /** The chosen customer's entity id, or an empty string. */
  value: string
  onChange: (customerEntityId: string, label: string) => void
  id?: string
}

const MAX_SUGGESTIONS = 8
const DEBOUNCE_MS = 250

/**
 * Choosing a customer by typing their name.
 *
 * This replaced a text box labelled "Customer id" whose placeholder was a literal
 * `00000000-0000-0000-0000-000000000000`. The two features behind it — "show me what this person would get,
 * and when" and "why did this person not get it" — are the module's best answers to the question an operator
 * actually asks, and both were unreachable by anybody who could not produce a UUID by hand.
 *
 * The id still travels to the server: it is what the engine keys a subject on. It is simply never something a
 * person has to see or type.
 *
 * Searching needs `customers.people.view`, which is the grant that protects contact data and which a
 * marketing-only role may not hold. A refusal is reported as itself rather than as "no matches" — telling
 * somebody their colleague does not exist because of a permission is worse than telling them about the
 * permission.
 */
export function CustomerPicker({ value, onChange, id }: CustomerPickerProps) {
  const t = useT()
  const [term, setTerm] = React.useState('')
  const [rows, setRows] = React.useState<Array<{ id: string; name: string; email: string | null }>>([])
  const [searching, setSearching] = React.useState(false)
  const [refused, setRefused] = React.useState(false)
  const [chosen, setChosen] = React.useState<string | null>(null)

  React.useEffect(() => {
    const query = term.trim()
    if (query.length < 2) {
      setRows([])
      setSearching(false)
      return
    }
    setSearching(true)
    // Debounced, because this fires per keystroke against a search that reads the CRM.
    const timer = setTimeout(async () => {
      try {
        const response = await apiCall<{ items?: PersonRow[] }>(
          `/api/customers/people?pageSize=${MAX_SUGGESTIONS}&search=${encodeURIComponent(query)}`,
        )
        setRefused(response.status === 403)
        const items = response.ok && Array.isArray(response.result?.items) ? response.result.items : []
        setRows(items.flatMap((row) => {
          if (typeof row.id !== 'string') return []
          return [{
            id: row.id,
            name: typeof row.display_name === 'string' && row.display_name
              ? row.display_name
              : t('marketing_automation.picker.unnamed', 'Unnamed customer'),
            email: typeof row.primary_email === 'string' ? row.primary_email : null,
          }]
        }))
      } catch {
        // A transport failure is not an empty result, and an empty list would read as one.
        setRows([])
      } finally {
        setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, t])

  if (value && chosen) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">{chosen}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setChosen(null)
            setTerm('')
            onChange('', '')
          }}
        >
          {t('marketing_automation.picker.change', 'Change')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Input
        id={id}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t('marketing_automation.picker.placeholder', 'Search by name or email')}
      />
      {searching ? <Spinner /> : null}
      {refused ? (
        <div className="text-xs text-muted-foreground">
          {t('marketing_automation.picker.notPermitted', 'You do not have permission to search customers.')}
        </div>
      ) : null}
      {!refused && !searching && term.trim().length >= 2 && rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {t('marketing_automation.picker.noMatches', 'Nobody matches that.')}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ul className="rounded-md border">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  const label = row.email ? `${row.name} · ${row.email}` : row.name
                  setChosen(label)
                  setRows([])
                  onChange(row.id, label)
                }}
              >
                <span>{row.name}</span>
                {row.email ? <span className="ml-2 text-xs text-muted-foreground">{row.email}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
