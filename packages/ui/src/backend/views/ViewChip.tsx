"use client"
import * as React from 'react'
import { Check, X, Users } from 'lucide-react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { ViewChipMenu } from './ViewChipMenu'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Props = {
  id: string
  label: string
  kind: 'personal' | 'role'
  isActive: boolean
  disabled: boolean
  isShared: boolean
  isRenaming: boolean
  renameValue: string
  canApplyToRoles: boolean
  deleting: boolean
  onActivate: () => void
  onRenameValueChange: (value: string) => void
  onRenameConfirm: () => void
  onRenameCancel: () => void
  onRenameStart?: () => void
  onClone: () => void
  onShareStart?: () => void
  onDelete: () => void
}

export function ViewChip({
  id,
  label,
  kind,
  isActive,
  disabled,
  isShared,
  isRenaming,
  renameValue,
  canApplyToRoles,
  deleting,
  onActivate,
  onRenameValueChange,
  onRenameConfirm,
  onRenameCancel,
  onRenameStart,
  onClone,
  onShareStart,
  onDelete,
}: Props) {
  const t = useT()

  if (isRenaming) {
    const renameTrimmed = renameValue.trim()
    return (
      <div className="inline-flex items-center gap-1 rounded-md border border-primary bg-primary/5 px-3 h-8">
        <input
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          className="w-24 bg-transparent text-sm outline-none"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameConfirm()
            if (e.key === 'Escape') onRenameCancel()
          }}
        />
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          className="h-auto"
          onClick={onRenameConfirm}
          disabled={!renameTrimmed}
          aria-label={t('ui.perspectives.rename.confirm', 'Confirm rename')}
        >
          <Check className={`size-4 ${renameTrimmed ? 'text-brand-violet' : 'text-muted-foreground opacity-50'}`} />
        </IconButton>
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          className="h-auto"
          onClick={onRenameCancel}
          aria-label={t('ui.perspectives.rename.cancel', 'Cancel rename')}
        >
          <X className="size-4 text-muted-foreground hover:text-destructive" />
        </IconButton>
      </div>
    )
  }

  const showUsersIcon = kind === 'role' || isShared

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-md border h-8 text-sm ${
        isActive
          ? 'bg-brand-violet/10 border-brand-violet/30 font-medium text-brand-violet'
          : 'border-border'
      }`}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto px-3 py-0 text-sm hover:bg-transparent"
        onClick={onActivate}
        disabled={disabled}
      >
        {showUsersIcon ? <Users className="size-3 mr-1 opacity-50" /> : null}
        {label}
      </Button>
      <ViewChipMenu
        kind={kind}
        canApplyToRoles={canApplyToRoles}
        deleting={deleting}
        onRenameStart={onRenameStart}
        onClone={onClone}
        onShareStart={onShareStart}
        onDelete={onDelete}
      />
    </div>
  )
}
