"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import type { AddressFormatStrategy } from '../utils/addressFormat'

type Option = {
  id: AddressFormatStrategy
  title: string
  description: string
}

export function AddressFormatSettings() {
  const t = useT()
  const [format, setFormat] = React.useState<AddressFormatStrategy>('line_first')
  const [loading, setLoading] = React.useState(true)
  const [pending, setPending] = React.useState<AddressFormatStrategy | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const options = React.useMemo<Option[]>(
    () => [
      {
        id: 'line_first',
        title: t('customers.config.addressFormat.lineFirstTitle', 'Address lines first'),
        description: t(
          'customers.config.addressFormat.lineFirstDescription',
          'Collect address line 1 and 2, then postal code, city, region, and country.'
        ),
      },
      {
        id: 'street_first',
        title: t('customers.config.addressFormat.streetFirstTitle', 'Street-first (European)'),
        description: t(
          'customers.config.addressFormat.streetFirstDescription',
          'Collect street, building and flat numbers before postal code, city, region, and country.'
        ),
      },
    ],
    [t]
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        const res = await apiFetch('/api/customers/settings/address-format')
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.config.addressFormat.error', 'Failed to load address settings')
          if (!cancelled) setError(message)
          return
        }
        const value = typeof payload?.addressFormat === 'string' ? payload.addressFormat : null
        if (!cancelled && (value === 'line_first' || value === 'street_first')) {
          setFormat(value)
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error && err.message
              ? err.message
              : t('customers.config.addressFormat.error', 'Failed to load address settings')
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [t])

  const handleChange = React.useCallback(
    async (next: AddressFormatStrategy) => {
      if (next === format) return
      setPending(next)
      setError(null)
      try {
        const res = await apiFetch('/api/customers/settings/address-format', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ addressFormat: next }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.config.addressFormat.errorSave', 'Failed to update address settings')
          setError(message)
          flash(message, 'error')
          return
        }
        setFormat(next)
        flash(t('customers.config.addressFormat.success', 'Address format updated'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.config.addressFormat.errorSave', 'Failed to update address settings')
        setError(message)
        flash(message, 'error')
      } finally {
        setPending(null)
      }
    },
    [format, t]
  )

  return (
    <section className="space-y-4 rounded-lg border bg-background p-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">
          {t('customers.config.addressFormat.title', 'Customer address format')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'customers.config.addressFormat.description',
            'Choose how address forms and displays should be structured across the customer module.'
          )}
        </p>
      </header>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('customers.config.addressFormat.loading', 'Loading current preference…')}
        </div>
      ) : (
        <div className="space-y-3">
          {options.map((option) => (
            <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded border p-3">
              <input
                type="radio"
                name="address-format"
                className="mt-1"
                value={option.id}
                checked={format === option.id}
                disabled={pending !== null && pending !== option.id}
                onChange={() => handleChange(option.id)}
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {pending ? (
            <div className="inline-flex items-center gap-2 rounded border border-dashed px-3 py-1 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" />
              {t('customers.config.addressFormat.updating', 'Saving preference…')}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

export default AddressFormatSettings
