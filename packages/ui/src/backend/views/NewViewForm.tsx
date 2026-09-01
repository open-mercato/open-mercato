"use client"
import * as React from 'react'
import { Check, X } from 'lucide-react'
import { IconButton } from '../../primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Props = {
  name: string
  onNameChange: (name: string) => void
  onSubmit: () => void
  onCancel: () => void
  saving: boolean
}

export function NewViewForm({ name, onNameChange, onSubmit, onCancel, saving }: Props) {
  const t = useT()
  const trimmed = name.trim()
  const hintId = React.useId()
  // A greyed-out check that does nothing when clicked is the dead end reported
  // in #5113 — always render the reason the control is inert.
  const nameRequiredHint = t('ui.perspectives.form.nameRequired', 'Enter a name to create the view')
  return (
    <div className="relative">
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={t('ui.perspectives.form.namePlaceholder', 'View name...')}
        autoFocus
        aria-describedby={trimmed ? undefined : hintId}
        className="w-full h-9 rounded border border-primary pl-2 pr-16 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && trimmed) onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => { if (trimmed) onSubmit() }}
          disabled={!trimmed || saving}
          title={trimmed ? undefined : nameRequiredHint}
          aria-label={t('ui.perspectives.form.confirmCreate', 'Create view')}
        >
          <Check className={`size-4 ${trimmed ? 'text-brand-violet' : 'text-muted-foreground opacity-50'}`} />
        </IconButton>
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          onClick={onCancel}
          aria-label={t('ui.perspectives.form.cancelCreate', 'Cancel')}
        >
          <X className="size-4 text-muted-foreground hover:text-destructive" />
        </IconButton>
      </div>
      {trimmed ? null : (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">{nameRequiredHint}</p>
      )}
    </div>
  )
}
