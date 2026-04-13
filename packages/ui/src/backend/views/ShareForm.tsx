"use client"
import * as React from 'react'
import { Button } from '../../primitives/button'
import { Checkbox } from '../../primitives/checkbox'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Role = { id: string; name: string; hasPerspective: boolean; hasDefault: boolean }

type Props = {
  roles: Role[]
  shareRoles: string[]
  shareSetDefault: boolean
  onToggleRole: (roleId: string) => void
  onToggleSetDefault: (value: boolean) => void
  onApply: () => void
  onCancel: () => void
}

export function ShareForm({ roles, shareRoles, shareSetDefault, onToggleRole, onToggleSetDefault, onApply, onCancel }: Props) {
  const t = useT()
  return (
    <div className="rounded border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase">{t('ui.perspectives.form.shareWithRoles', 'Share with roles')}</div>
      <div className="space-y-1">
        {roles.map((role) => (
          <label key={role.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={shareRoles.includes(role.id)}
              onCheckedChange={() => onToggleRole(role.id)}
            />
            <span>{role.name}</span>
          </label>
        ))}
      </div>
      <div className="border-t mt-2 pt-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <Checkbox
            checked={shareSetDefault}
            onCheckedChange={(checked) => onToggleSetDefault(checked === true)}
            disabled={shareRoles.length === 0}
          />
          {t('ui.perspectives.form.setRoleDefault', 'Set as default for selected roles')}
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('ui.perspectives.footer.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={shareRoles.length === 0}
          onClick={onApply}
        >
          {t('ui.perspectives.menu.apply', 'Apply')}
        </Button>
      </div>
    </div>
  )
}
