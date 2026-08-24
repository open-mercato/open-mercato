'use client'

import * as React from 'react'
import { Phone, Mail, Plus, Users, CheckSquare } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
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
        <Button
          type="button"
          disabled={disabled}
          aria-label={t('customers.activities.addNew', 'Add new')}
        >
          <Plus className="size-4" />
          {t('customers.activities.addNew', 'Add new')}
        </Button>
      </PopoverTrigger>
      {/* PopoverContent's base min-w-[280px] would win over a plain width class,
          so reset it — the menu matches the w-44 RowActions dropdown width. */}
      <PopoverContent align="end" className="min-w-0 w-44 p-1">
        <ul role="menu" className="flex flex-col">
          {MENU_ITEMS.map(({ kind, icon: Icon, key, fallback }) => (
            <li key={kind} role="none">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                role="menuitem"
                onClick={() => handleSelect(kind)}
                className="w-full justify-start gap-2 font-normal text-foreground"
              >
                <Icon className="size-3.5 text-muted-foreground" />
                {t(key, fallback)}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export default ActivitiesAddNewMenu
