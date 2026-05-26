'use client'

import * as React from 'react'
import { Check, Phone, Mail, Users, CheckSquare } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'

export type ActivityKind = 'meeting' | 'call' | 'task' | 'email'

interface ActivitiesAddNewMenuProps {
  onSelect: (kind: ActivityKind) => void
  disabled?: boolean
}

const MENU_ITEMS: ReadonlyArray<{ kind: ActivityKind; icon: React.ComponentType<{ className?: string }>; key: string; fallback: string }> = [
  { kind: 'meeting', icon: Users, key: 'customers.activities.add.meeting', fallback: 'New meeting' },
  { kind: 'call', icon: Phone, key: 'customers.activities.add.call', fallback: 'Log call' },
  { kind: 'task', icon: CheckSquare, key: 'customers.activities.add.task', fallback: 'New task' },
  { kind: 'email', icon: Mail, key: 'customers.activities.add.email', fallback: 'Compose email' },
]

export function ActivitiesAddNewMenu({ onSelect, disabled }: ActivitiesAddNewMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const handleSelect = React.useCallback(
    (kind: ActivityKind) => {
      setOpen(false)
      onSelect(kind)
    },
    [onSelect],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('customers.activities.addNew', 'Add new')}
          className="inline-flex items-center gap-1.5 overflow-hidden rounded-md bg-foreground pl-3 pr-3.5 py-2 text-xs font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
        >
          <Check className="size-3.5" />
          {t('customers.activities.addNew', 'Add new')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[180px] p-1">
        <ul className="flex flex-col">
          {MENU_ITEMS.map(({ kind, icon: Icon, key, fallback }) => (
            <li key={kind}>
              <button
                type="button"
                onClick={() => handleSelect(kind)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent/40"
              >
                <Icon className="size-4 text-muted-foreground" />
                {t(key, fallback)}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export default ActivitiesAddNewMenu
