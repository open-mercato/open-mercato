"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type MentionUser = {
  id: string
  email: string
  name: string
}

type MentionPickerProps = {
  documentId: string
  onPick: (user: { id: string; name: string }) => void
  disabled?: boolean
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function normalizeUser(value: unknown): MentionUser | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const email = readString(record, 'email') ?? ''
  const name = readString(record, 'name') ?? email
  if (!id || !name) return null
  return { id, email, name }
}

function readUserItems(payload: unknown): MentionUser[] {
  if (Array.isArray(payload)) return payload.map(normalizeUser).filter((user): user is MentionUser => user !== null)
  const record = readRecord(payload)
  if (!record) return []
  const candidates = [record.items, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(normalizeUser).filter((user): user is MentionUser => user !== null)
    }
  }
  return []
}

export function MentionPicker({ documentId, onPick, disabled = false }: MentionPickerProps) {
  const t = useT()
  const reactId = React.useId()
  const inputId = `documents-mention-input-${documentId}-${reactId}`
  const listId = `documents-mention-list-${documentId}-${reactId}`
  const [query, setQuery] = React.useState('')
  const [users, setUsers] = React.useState<MentionUser[]>([])
  const [open, setOpen] = React.useState(false)
  const [unavailable, setUnavailable] = React.useState(false)

  React.useEffect(() => {
    setQuery('')
    setUsers([])
    setOpen(false)
    setUnavailable(false)
  }, [documentId])

  React.useEffect(() => {
    const trimmedQuery = query.trim()
    if (disabled || unavailable || trimmedQuery.length === 0) {
      setUsers([])
      setOpen(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void apiCall<unknown>(`/api/auth/users?search=${encodeURIComponent(trimmedQuery)}`)
        .then((call) => {
          if (cancelled) return
          if (!call.ok) {
            setUsers([])
            setOpen(false)
            setUnavailable(true)
            return
          }
          const nextUsers = readUserItems(call.result).slice(0, 8)
          setUsers(nextUsers)
          setOpen(nextUsers.length > 0)
        })
        .catch(() => {
          if (!cancelled) {
            setUsers([])
            setOpen(false)
            setUnavailable(true)
          }
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [disabled, query, unavailable])

  const isDisabled = disabled || unavailable

  return (
    <div
      className="relative space-y-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setOpen(false)
        }
      }}
    >
      <Label htmlFor={inputId}>{t('documents.mentions.placeholder')}</Label>
      <Input
        id={inputId}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('documents.mentions.placeholder')}
        disabled={isDisabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-popover max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {users.map((user) => (
            <Button
              key={user.id}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start px-3 py-2 text-left"
              onClick={() => {
                onPick({ id: user.id, name: user.name })
                setQuery('')
                setUsers([])
                setOpen(false)
              }}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                {user.email ? (
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                ) : null}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default MentionPicker
