'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Plus, Trash2 } from '../lucide-icons'

const ROLE_PATTERN = /^[a-z][a-z0-9_-]*$/

function isValidRoleId(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && ROLE_PATTERN.test(value)
}

export type RolesEditorProps = {
  roles: string[]
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
    if (!isValidRoleId(next) || next === 'admin') {
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
          className="font-mono text-xs"
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

export function RolesEditor({ roles, onAdd, onRename, onRemove }: RolesEditorProps) {
  const t = useT()
  const [draft, setDraft] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const editableRoles = React.useMemo(
    () => roles.filter((role) => role !== 'admin'),
    [roles],
  )

  const handleAdd = () => {
    const next = draft.trim()
    if (!isValidRoleId(next) || next === 'admin') {
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
    <div className="space-y-2" data-testid="roles-editor">
      <ul className="space-y-1">
        <li className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1">
          <span className="font-mono text-xs text-foreground">admin</span>
          <span className="text-[11px] text-muted-foreground">
            {t('forms.studio.parameters.roles.admin_locked')}
          </span>
        </li>
        {editableRoles.map((role) => (
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
        <div className="flex items-center gap-2">
          <Input
            placeholder={t('forms.studio.parameters.roles.add_placeholder')}
            value={draft}
            className="font-mono text-xs"
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
          <Button variant="outline" size="sm" type="button" onClick={handleAdd}>
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
