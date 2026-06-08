"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Command as CommandPrimitive } from 'cmdk'
import { ChevronRight, Search, X } from 'lucide-react'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Kbd } from './kbd'

/**
 * Command palette primitive — Cmd+K spotlight-style launcher backed by
 * the `cmdk` library (auto-filters items as the user types) and hosted
 * inside a Radix Dialog overlay so it inherits the modal focus contract
 * (ESC closes, outside-click closes, focus trap, ARIA role="dialog").
 *
 * Compound API:
 *   <CommandMenu> — root dialog (controlled via `open` / `onOpenChange`,
 *                   or hands off via `defaultOpen`). Wraps `cmdk` + Radix
 *                   Dialog.
 *   <CommandMenuTrigger> — anchor / trigger button (Radix Dialog.Trigger).
 *   <CommandMenuContent> — the floating panel rendered through Portal:
 *                          centered overlay with rounded card, max-width,
 *                          shadow, animations.
 *   <CommandMenuInput> — leading magnifier + input + trailing `⌘K` kbd
 *                        + auto X to clear when there's a value.
 *   <CommandMenuList> — scrollable container for groups/items.
 *   <CommandMenuEmpty> — fallback when no items match the search query.
 *   <CommandMenuGroup> — labelled section with optional `actionLabel`
 *                        / `onAction` "see all"-style affordance.
 *   <CommandMenuItem> — selectable row. Supports `leading` (avatar /
 *                       icon / flag), label, optional `description`,
 *                       optional `shortcut` (Kbd), and the auto
 *                       chevron on hover/selection.
 *   <CommandMenuSeparator> — visual divider between groups.
 *   <CommandMenuFooter> — bottom bar with shortcut hints + help link.
 *
 * Figma source: DS Open Mercato `Command Menu` page (4152:24764) —
 * Search Input [1.1] (4187:559), Items [1.1] (4171:15653), Footer [1.1]
 * (4172:16590).
 *
 * ```tsx
 * const [open, setOpen] = React.useState(false)
 *
 * React.useEffect(() => {
 *   const onKey = (e: KeyboardEvent) => {
 *     if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
 *       e.preventDefault()
 *       setOpen((o) => !o)
 *     }
 *   }
 *   window.addEventListener('keydown', onKey)
 *   return () => window.removeEventListener('keydown', onKey)
 * }, [])
 *
 * <CommandMenu open={open} onOpenChange={setOpen}>
 *   <CommandMenuContent>
 *     <CommandMenuInput placeholder="Search HR tools or press..." />
 *     <CommandMenuList>
 *       <CommandMenuEmpty>No results.</CommandMenuEmpty>
 *       <CommandMenuGroup heading="Tools & Apps">
 *         <CommandMenuItem leading={<Logo />} onSelect={...}>Monday.com</CommandMenuItem>
 *         <CommandMenuItem leading={<Logo />} onSelect={...}>Loom</CommandMenuItem>
 *       </CommandMenuGroup>
 *       <CommandMenuSeparator />
 *       <CommandMenuGroup heading="Employees">
 *         <CommandMenuItem leading={<Avatar />} description="Engineer">James Brown</CommandMenuItem>
 *       </CommandMenuGroup>
 *     </CommandMenuList>
 *     <CommandMenuFooter />
 *   </CommandMenuContent>
 * </CommandMenu>
 * ```
 */

type CommandMenuRootProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>

const CommandMenu = (props: CommandMenuRootProps) => <DialogPrimitive.Root {...props} />
CommandMenu.displayName = 'CommandMenu'

const CommandMenuTrigger = DialogPrimitive.Trigger
const CommandMenuPortal = DialogPrimitive.Portal
const CommandMenuClose = DialogPrimitive.Close

const CommandMenuOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="command-menu-overlay"
    className={cn(
      'fixed inset-0 z-overlay bg-foreground/40 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
      className,
    )}
    {...props}
  />
))
CommandMenuOverlay.displayName = 'CommandMenuOverlay'

export type CommandMenuContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /** Accessible dialog title — required by Radix; auto visually hidden. */
  title?: string
  /** Optional max-width override (default `max-w-xl`, ~640px). */
  contentClassName?: string
  /** Pass to underlying `cmdk` root (`loop`, `shouldFilter`, etc.). */
  commandProps?: Omit<React.ComponentPropsWithoutRef<typeof CommandPrimitive>, 'children' | 'className'>
}

const CommandMenuContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  CommandMenuContentProps
>(({ className, contentClassName, title, commandProps, children, ...props }, ref) => {
  const t = useT()
  const resolvedTitle = title ?? t('ui.commandMenu.title.srOnly', 'Command menu')
  return (
    <CommandMenuPortal>
      <CommandMenuOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="command-menu-content"
        className={cn(
          // top-1/4 places content roughly 25% from viewport top (Tailwind fraction scale);
          // w-[calc(100%-2rem)] kept — no DS token expresses "viewport minus 2rem gutters".
          'fixed left-1/2 top-1/4 z-popover w-[calc(100%-2rem)] -translate-x-1/2 outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          'data-[state=open]:duration-150 data-[state=closed]:duration-100',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{resolvedTitle}</DialogPrimitive.Title>
      <CommandPrimitive
        data-slot="command-menu-root"
        className={cn(
          'mx-auto flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-input bg-background shadow-lg',
          contentClassName,
        )}
        {...commandProps}
      >
        {children}
      </CommandPrimitive>
    </DialogPrimitive.Content>
  </CommandMenuPortal>
  )
})
CommandMenuContent.displayName = 'CommandMenuContent'

export type CommandMenuInputProps = React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Input
> & {
  /** Show the trailing `⌘K` hint. Default `true`. */
  showShortcut?: boolean
  /** Custom shortcut label. Default `⌘K`. */
  shortcutLabel?: string
  /** Show the trailing × clear button when the input has a value. Default `true`. */
  showClear?: boolean
  /** Accessible label for the clear button. Default `'Clear search'`. */
  clearAriaLabel?: string
  /** Container className override (border / padding / row). */
  wrapperClassName?: string
}

const CommandMenuInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  CommandMenuInputProps
>(
  (
    {
      className,
      wrapperClassName,
      showShortcut = true,
      shortcutLabel = '⌘K',
      showClear = true,
      clearAriaLabel = 'Clear search',
      value,
      defaultValue,
      onValueChange,
      ...props
    },
    ref,
  ) => {
    const isControlled = value !== undefined
    const [internal, setInternal] = React.useState<string>(
      typeof defaultValue === 'string' ? defaultValue : '',
    )
    const currentValue = isControlled ? (value as string) : internal

    const handleChange = React.useCallback(
      (next: string) => {
        if (!isControlled) setInternal(next)
        onValueChange?.(next)
      },
      [isControlled, onValueChange],
    )

    return (
      <div
        data-slot="command-menu-input-wrapper"
        className={cn(
          'flex h-12 items-center gap-2 border-b border-input px-4',
          wrapperClassName,
        )}
      >
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
          data-slot="command-menu-input-icon"
        />
        <CommandPrimitive.Input
          ref={ref}
          data-slot="command-menu-input"
          value={currentValue}
          onValueChange={handleChange}
          className={cn(
            'flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none',
            className,
          )}
          {...props}
        />
        {showClear && currentValue.length > 0 ? (
          <button
            type="button"
            data-slot="command-menu-input-clear"
            aria-label={clearAriaLabel}
            onClick={() => handleChange('')}
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors',
              'hover:bg-muted/40 hover:text-foreground',
              'focus-visible:shadow-focus',
            )}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : showShortcut ? (
          <Kbd
            data-slot="command-menu-input-shortcut"
            className="shrink-0"
          >
            {shortcutLabel}
          </Kbd>
        ) : null}
      </div>
    )
  },
)
CommandMenuInput.displayName = 'CommandMenuInput'

const CommandMenuList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    data-slot="command-menu-list"
    className={cn(
      'max-h-[420px] overflow-y-auto overflow-x-hidden p-2',
      className,
    )}
    {...props}
  />
))
CommandMenuList.displayName = 'CommandMenuList'

const CommandMenuEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    data-slot="command-menu-empty"
    className={cn(
      'py-8 text-center text-sm text-muted-foreground',
      className,
    )}
    {...props}
  />
))
CommandMenuEmpty.displayName = 'CommandMenuEmpty'

export type CommandMenuGroupProps = React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Group
> & {
  /** Optional trailing "see all"-style affordance shown next to the heading. */
  actionLabel?: string
  /** Click handler for the trailing action. Renders an arrow icon when set. */
  onAction?: () => void
  /** Accessible label for the trailing action button. Default uses `actionLabel`. */
  actionAriaLabel?: string
}

const CommandMenuGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  CommandMenuGroupProps
>(
  (
    { className, heading, actionLabel, onAction, actionAriaLabel, children, ...props },
    ref,
  ) => {
    const hasAction = onAction !== undefined
    return (
      <CommandPrimitive.Group
        ref={ref}
        data-slot="command-menu-group"
        heading={heading}
        className={cn(
          'overflow-hidden text-foreground',
          '[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:justify-between',
          '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
          '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
          className,
        )}
        {...props}
      >
        {hasAction ? (
          <div
            data-slot="command-menu-group-action"
            className="-mt-7 mb-1 flex justify-end px-2"
          >
            <button
              type="button"
              onClick={onAction}
              aria-label={actionAriaLabel ?? actionLabel ?? 'See all'}
              className={cn(
                'inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors',
                'hover:text-foreground focus-visible:shadow-focus',
              )}
            >
              {actionLabel}
              <ChevronRight aria-hidden="true" className="size-3" />
            </button>
          </div>
        ) : null}
        {children}
      </CommandPrimitive.Group>
    )
  },
)
CommandMenuGroup.displayName = 'CommandMenuGroup'

export type CommandMenuItemProps = React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Item
> & {
  /** Optional leading slot — avatar, icon, flag, brand mark, etc. */
  leading?: React.ReactNode
  /** Optional secondary line beneath the label. */
  description?: React.ReactNode
  /** Optional trailing keyboard hint. */
  shortcut?: React.ReactNode
  /** Hide the auto chevron-right trailing affordance. Default `false`. */
  hideChevron?: boolean
}

const CommandMenuItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  CommandMenuItemProps
>(
  (
    {
      className,
      children,
      leading,
      description,
      shortcut,
      hideChevron = false,
      ...props
    },
    ref,
  ) => (
    <CommandPrimitive.Item
      ref={ref}
      data-slot="command-menu-item"
      className={cn(
        'group relative flex w-full cursor-pointer select-none items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground outline-none',
        'data-[selected=true]:bg-muted/40',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    >
      {leading ? (
        <span
          data-slot="command-menu-item-leading"
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center"
        >
          {leading}
        </span>
      ) : null}
      <div
        data-slot="command-menu-item-text"
        className="min-w-0 flex-1"
      >
        <div className="truncate text-sm font-medium text-foreground">
          {children}
        </div>
        {description ? (
          <div
            data-slot="command-menu-item-description"
            className="truncate text-xs text-muted-foreground"
          >
            {description}
          </div>
        ) : null}
      </div>
      {shortcut ? (
        <span
          data-slot="command-menu-item-shortcut"
          className="ml-auto shrink-0"
        >
          {shortcut}
        </span>
      ) : !hideChevron ? (
        <ChevronRight
          aria-hidden="true"
          data-slot="command-menu-item-chevron"
          className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-data-[selected=true]:opacity-100"
        />
      ) : null}
    </CommandPrimitive.Item>
  ),
)
CommandMenuItem.displayName = 'CommandMenuItem'

const CommandMenuSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    data-slot="command-menu-separator"
    className={cn('-mx-2 my-2 h-px bg-input', className)}
    {...props}
  />
))
CommandMenuSeparator.displayName = 'CommandMenuSeparator'

export type CommandMenuFooterProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Override the left-side shortcut hints (defaults to ↑/↓ Navigate, ↵ Select). */
  hints?: React.ReactNode
  /** Optional right-side help affordance ("Any problem? Contact"). */
  helpSlot?: React.ReactNode
}

const CommandMenuFooter = React.forwardRef<HTMLDivElement, CommandMenuFooterProps>(
  ({ className, hints, helpSlot, ...props }, ref) => {
    const t = useT()
    return (
    <div
      ref={ref}
      data-slot="command-menu-footer"
      className={cn(
        'flex items-center justify-between gap-3 border-t border-input px-3 py-2 text-xs text-muted-foreground',
        className,
      )}
      {...props}
    >
      <div data-slot="command-menu-footer-hints" className="flex items-center gap-3">
        {hints ?? (
          <>
            <span className="inline-flex items-center gap-1">
              <Kbd>{'↑'}</Kbd>
              <Kbd>{'↓'}</Kbd>
              <span>{t('ui.commandMenu.footer.navigate', 'Navigate')}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>{'↵'}</Kbd>
              <span>{t('ui.commandMenu.footer.select', 'Select')}</span>
            </span>
          </>
        )}
      </div>
      {helpSlot ? (
        <div data-slot="command-menu-footer-help">{helpSlot}</div>
      ) : null}
    </div>
    )
  },
)
CommandMenuFooter.displayName = 'CommandMenuFooter'

export {
  CommandMenu,
  CommandMenuTrigger,
  CommandMenuPortal,
  CommandMenuClose,
  CommandMenuOverlay,
  CommandMenuContent,
  CommandMenuInput,
  CommandMenuList,
  CommandMenuEmpty,
  CommandMenuGroup,
  CommandMenuItem,
  CommandMenuSeparator,
  CommandMenuFooter,
}
