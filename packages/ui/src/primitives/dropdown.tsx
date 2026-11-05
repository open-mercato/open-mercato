"use client"

import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Check } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import {
  CommandMenuEmpty,
  CommandMenuGroup,
  CommandMenuInput,
  CommandMenuItem,
  CommandMenuList,
  CommandMenuSeparator,
  type CommandMenuInputProps,
  type CommandMenuItemProps,
} from './command-menu'

export const Dropdown = Popover
export const DropdownTrigger = PopoverTrigger
export const DropdownList = CommandMenuList
export const DropdownEmpty = CommandMenuEmpty
export const DropdownGroup = CommandMenuGroup
export const DropdownSeparator = CommandMenuSeparator

export type DropdownContentProps = React.ComponentPropsWithoutRef<typeof PopoverContent> & {
  commandProps?: Omit<React.ComponentPropsWithoutRef<typeof CommandPrimitive>, 'children' | 'className'>
}

export const DropdownContent = React.forwardRef<React.ElementRef<typeof PopoverContent>, DropdownContentProps>(
  ({ children, className, commandProps, ...props }, ref) => {
    const t = useT()
    return (
    <PopoverContent ref={ref} data-slot="dropdown-content" className={cn('w-80 min-w-0 overflow-hidden rounded-xl p-0', className)} {...props}>
      <CommandPrimitive data-slot="dropdown-root" label={t('ui.commandMenu.title.srOnly', 'Command menu')} loop {...commandProps}>
        {children}
      </CommandPrimitive>
    </PopoverContent>
    )
  },
)
DropdownContent.displayName = 'DropdownContent'

export const DropdownInput = React.forwardRef<HTMLInputElement, CommandMenuInputProps>(
  (props, ref) => <CommandMenuInput ref={ref} appearance="dropdown" showShortcut={false} {...props} />,
)
DropdownInput.displayName = 'DropdownInput'

export type DropdownItemProps = Omit<CommandMenuItemProps, 'size'> & {
  size?: 36 | 56
  /** Committed selection; cmdk's aria-selected tracks keyboard navigation independently. */
  checked?: boolean
}

export const DropdownItem = React.forwardRef<React.ElementRef<typeof CommandMenuItem>, DropdownItemProps>(
  ({ className, size = 36, checked, shortcut, hideChevron = true, ...props }, ref) => (
    <CommandMenuItem
      ref={ref}
      data-slot="dropdown-item"
      data-checked={checked}
      size={size === 56 ? 64 : 40}
      hideChevron={hideChevron}
      shortcut={checked ? <Check aria-hidden="true" className="size-5 text-foreground" /> : shortcut}
      className={cn(
        'p-2 data-[selected=true]:bg-muted',
        size === 36 && 'h-9 gap-2 rounded-md [&_[data-slot=command-menu-item-leading]]:w-auto',
        size === 56 && 'h-14 gap-3 rounded-lg',
        className,
      )}
      {...props}
    />
  ),
)
DropdownItem.displayName = 'DropdownItem'

export const DropdownFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} data-slot="dropdown-footer" className={cn('border-t border-input p-2', className)} {...props} />,
)
DropdownFooter.displayName = 'DropdownFooter'

export const DropdownCaption = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} data-slot="dropdown-caption" className={cn('px-2 py-2 text-sm text-muted-foreground', className)} {...props} />,
)
DropdownCaption.displayName = 'DropdownCaption'
