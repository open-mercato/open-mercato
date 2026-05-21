'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Plus, Trash2 } from '../lucide-icons'
import { GUEST_ROLE } from '../schema-helpers'

const ROLE_PATTERN = /^[a-z][a-z0-9_-]*$/
const RESERVED_ROLES = new Set<string>(['admin', GUEST_ROLE])

function isValidRoleId(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && ROLE_PATTERN.test(value)
}

export type RolesEditorProps = {
  roles: string[]
  guestEnabled: boolean
  onToggleGuest: (enabled: boolean) => void
  onAdd: (role: string) => void
  onRename: (oldRole: string, newRole: string) => void
  onRemove: (role: string) => void
}

function RoleRow({
  role,
  roles,
  onRename,
  onRemove,
}: {
  role: string
  roles: string[]
  onRename: (oldRole: string, newRole: string) => void
  onRemove: (role: string) => void
}) {
  const t = useT()
  const [draft, setDraft] = React.useState(role)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setDraft(role)
    setError(null)
  }, [role])

  const commit = () => {
    const next = draft.trim()
    if (next === role) {
      setError(null)
      return
    }
    if (!isValidRoleId(next) || RESERVED_ROLES.has(next)) {
      setError(t('forms.studio.parameters.roles.invalid'))
      return
    }
    if (roles.some((entry) => entry !== role && entry === next)) {
      setError(t('forms.studio.parameters.roles.invalid'))
      return
    }
    setError(null)
    onRename(role, next)
  }

  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          aria-label={role}
          value={draft}
          className="min-w-0 flex-1 font-mono text-xs"
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
        <IconButton
          aria-label={t('forms.studio.parameters.roles.remove')}
          title={t('forms.studio.parameters.roles.remove')}
          variant="ghost"
          size="sm"
          type="button"
          className="shrink-0"
          onClick={() => onRemove(role)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      {error ? (
        <p className="text-xs text-status-danger-foreground">{error}</p>
      ) : null}
    </li>
  )
}

function ManagedRoleRow({ role, hint }: { role: string; hint: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1">
      <span className="shrink-0 font-mono text-xs text-foreground">{role}</span>
      <span className="min-w-0 truncate text-[11px] text-muted-foreground">{hint}</span>
    </li>
  )
}

export function RolesEditor({
  roles,
  guestEnabled,
  onToggleGuest,
  onAdd,
  onRename,
  onRemove,
}: RolesEditorProps) {
  const t = useT()
  const [draft, setDraft] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const customRoles = React.useMemo(
    () => roles.filter((role) => !RESERVED_ROLES.has(role)),
    [roles],
  )

  const handleAdd = () => {
    const next = draft.trim()
    if (!isValidRoleId(next) || RESERVED_ROLES.has(next)) {
      setError(t('forms.studio.parameters.roles.invalid'))
      return
    }
    if (roles.includes(next)) {
      setError(t('forms.studio.parameters.roles.invalid'))
      return
    }
    setError(null)
    onAdd(next)
    setDraft('')
  }

  return (
    <div className="space-y-3" data-testid="roles-editor">
      <label className="flex items-start justify-between gap-3">
        <span className="min-w-0 space-y-0.5">
          <span className="block text-sm font-medium text-foreground">
            {t('forms.studio.parameters.roles.guest.label')}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t('forms.studio.parameters.roles.guest.helper')}
          </span>
        </span>
        <Switch
          checked={guestEnabled}
          className="mt-0.5 shrink-0"
          onCheckedChange={(value) => onToggleGuest(Boolean(value))}
        />
      </label>

      <ul className="space-y-1">
        <ManagedRoleRow
          role="admin"
          hint={t('forms.studio.parameters.roles.admin_locked')}
        />
        {guestEnabled ? (
          <ManagedRoleRow
            role={GUEST_ROLE}
            hint={t('forms.studio.parameters.roles.managed_by_switch')}
          />
        ) : null}
        {customRoles.map((role) => (
          <RoleRow
            key={role}
            role={role}
            roles={roles}
            onRename={onRename}
            onRemove={onRemove}
          />
        ))}
      </ul>

      <div className="space-y-1 rounded-md border border-dashed border-border p-2">
        <span className="block text-xs font-medium text-foreground">
          {t('forms.studio.parameters.roles.custom.label')}
        </span>
        <p className="text-[11px] text-muted-foreground">
          {t('forms.studio.parameters.roles.custom.helper')}
        </p>
        <div className="flex items-center gap-2">
          <Input
            aria-label={t('forms.studio.parameters.roles.custom.label')}
            placeholder={t('forms.studio.parameters.roles.add_placeholder')}
            value={draft}
            className="min-w-0 flex-1 font-mono text-xs"
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleAdd()
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            type="button"
            className="shrink-0"
            onClick={handleAdd}
          >
            <Plus className="mr-1 size-4" aria-hidden="true" />
            {t('forms.studio.parameters.roles.add')}
          </Button>
        </div>
        {error ? (
          <p className="text-xs text-status-danger-foreground">{error}</p>
        ) : null}
      </div>
    </div>
  )
}
