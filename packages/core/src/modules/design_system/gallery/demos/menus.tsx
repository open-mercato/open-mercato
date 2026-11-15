import * as React from 'react'
import { Info, Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectTriggerLeading, SelectValue } from '@open-mercato/ui/primitives/select'
import { Dropdown, DropdownTrigger, DropdownContent, DropdownInput, DropdownList, DropdownEmpty, DropdownItem, DropdownFooter, DropdownCaption } from '@open-mercato/ui/primitives/dropdown'
import { CommandMenu, CommandMenuTrigger, CommandMenuContent, CommandMenuInput, CommandMenuList, CommandMenuEmpty, CommandMenuItem, CommandMenuGroup, CommandMenuSeparator, CommandMenuFooter } from '@open-mercato/ui/primitives/command-menu'
import { MenuVisual, useMenuChoices, selectKinds, commandKinds, type MenuKind } from './menu-fixtures'

export function SelectSourceExample({ kind, size = 36, state = 'filled' }: {
  kind: MenuKind
  size?: 32 | 36 | 40
  state?: 'default' | 'filled' | 'disabled' | 'error'
}) {
  const t = useT()
  const choices = useMenuChoices(kind)
  const [value, setValue] = React.useState(state === 'default' || state === 'error' ? '' : choices[0].value)
  const selected = choices.find((choice) => choice.value === value)
  const disabled = state === 'disabled'
  const label = t(`design_system.gallery.samples.menu.kind.${kind}`)
  const providerPadding = kind !== 'provider' ? undefined : size === 40 ? 'p-2' : size === 36 ? 'p-1.5' : 'p-1'
  return (
    <Select value={value} onValueChange={setValue} disabled={disabled}>
      <FormField label={label} disabled={disabled} description={t('design_system.gallery.samples.menu.hint')} error={state === 'error' ? t('design_system.gallery.samples.menu.required') : undefined}>
        <SelectTrigger size={size} className={providerPadding}>
          {kind !== 'basic' && <SelectTriggerLeading><MenuVisual kind={kind} alternative={selected?.alternative} providerSize="select" /></SelectTriggerLeading>}
          <SelectValue className="min-w-0 flex-1 text-left" placeholder={t('design_system.gallery.samples.menu.placeholder')} />
        </SelectTrigger>
      </FormField>
      <SelectContent>
        {choices.map((choice) => <SelectItem key={choice.value} value={choice.value} disabled={choice.disabled} leading={kind === 'basic' ? undefined : <MenuVisual kind={kind} alternative={choice.alternative} />}>
          {choice.label}
        </SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function SelectSourceMatrix({ size = 36, state = 'filled' }: { size?: 32 | 36 | 40; state?: 'default' | 'filled' | 'disabled' | 'error' }) {
  return <div className="grid w-full gap-6 sm:grid-cols-2 xl:grid-cols-3">{selectKinds.map((kind) => <SelectSourceExample key={kind} kind={kind} size={size} state={state} />)}</div>
}

export function DropdownSourceExample({ size = 36, empty = false }: { size?: 36 | 56; empty?: boolean }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState('basic')
  const [query, setQuery] = React.useState(empty ? 'zzzz' : '')
  const [workspaceCount, setWorkspaceCount] = React.useState(0)
  return (
    <div className="flex w-full flex-col items-start gap-3">
      <Dropdown open={open} onOpenChange={setOpen}>
        <DropdownTrigger asChild><Button variant="outline">{t('design_system.gallery.samples.menu.openDropdown')}</Button></DropdownTrigger>
        <DropdownContent className="w-96 max-w-full" aria-label={t('design_system.gallery.samples.menu.openDropdown')} commandProps={{ label: t('design_system.gallery.samples.menu.options') }}>
          <DropdownInput value={query} onValueChange={setQuery} aria-label={t('design_system.gallery.samples.menu.search')} placeholder={t('design_system.gallery.samples.menu.search')} />
          <DropdownList>
            <DropdownEmpty>{t('design_system.gallery.samples.menu.noResults')}</DropdownEmpty>
            {selectKinds.map((kind) => {
              const label = t(`design_system.gallery.samples.menu.${kind}.0`)
              return <DropdownItem key={kind} value={label} size={size} checked={value === kind} leading={<MenuVisual kind={kind} large={size === 56} />}
                description={size === 56 ? t('design_system.gallery.samples.menu.description') : undefined}
                sublabel={kind === 'basic' ? t('design_system.gallery.samples.menu.sublabel') : undefined}
                badge={kind === 'brand' ? <Badge appearance="lighter" tone="info" size={20}>{t('design_system.gallery.samples.menu.new')}</Badge> : undefined}
                shortcut={kind === 'company' ? <Kbd>⌘1</Kbd> : undefined}
                onSelect={() => { setValue(kind); setOpen(false) }}>
                {label}
              </DropdownItem>
            })}
            <DropdownItem value={t('design_system.gallery.samples.menu.unavailable')} size={size} disabled leading={<MenuVisual kind="basic" large={size === 56} />}>{t('design_system.gallery.samples.menu.unavailable')}</DropdownItem>
          </DropdownList>
          <DropdownFooter><Button variant="outline" size="sm" className="w-full" onClick={() => { setWorkspaceCount((count) => count + 1); setOpen(false) }}><Plus className="size-5" />{t('design_system.gallery.samples.menu.addWorkspace')}</Button></DropdownFooter>
          <DropdownCaption>{t('design_system.gallery.samples.menu.localCaption')}</DropdownCaption>
        </DropdownContent>
      </Dropdown>
      <output aria-live="polite" className="text-sm text-muted-foreground">{t('design_system.gallery.samples.menu.selected', { value: t(`design_system.gallery.samples.menu.${value}.0`) })}</output>
      {workspaceCount > 0 && <output aria-live="polite" className="text-sm text-muted-foreground">{t('design_system.gallery.samples.menu.created', { count: workspaceCount })}</output>}
    </div>
  )
}

function CommandSourceRows({ size, onSelect }: { size: 40 | 64; onSelect: (value: string) => void }) {
  const t = useT()
  return <>{commandKinds.map((kind) => {
    const label = t(`design_system.gallery.samples.menu.${kind}.0`)
    return <CommandMenuItem key={kind} value={label} size={size} leading={kind === 'basic' ? undefined : <MenuVisual kind={kind} large={size === 64} />}
      description={size === 64 ? t('design_system.gallery.samples.menu.description') : undefined}
      sublabel={kind === 'basic' ? t('design_system.gallery.samples.menu.sublabel') : undefined}
      badge={kind === 'brand' ? <Badge appearance="lighter" tone="info" size={20}>{t('design_system.gallery.samples.menu.new')}</Badge> : undefined}
      shortcut={kind === 'company' ? <Kbd>⌘K</Kbd> : undefined}
      onSelect={() => onSelect(label)}>{label}</CommandMenuItem>
  })}</>
}

export function CommandSourceExample({ size = 40, empty = false, withGroups = false }: { size?: 40 | 64; empty?: boolean; withGroups?: boolean }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState(empty ? 'zzzz' : '')
  const [result, setResult] = React.useState('')
  const onSelect = (label: string) => { setResult(label); setOpen(false) }
  const rows = <CommandSourceRows size={size} onSelect={onSelect} />
  return (
    <div className="flex flex-col items-start gap-3">
      <CommandMenu open={open} onOpenChange={setOpen}>
        <CommandMenuTrigger asChild><Button variant="outline">{t('design_system.gallery.samples.menu.openCommand')}</Button></CommandMenuTrigger>
        <CommandMenuContent title={t('design_system.gallery.samples.menu.openCommand')} commandProps={{ loop: true }}>
          <CommandMenuInput appearance="source" value={query} onValueChange={setQuery} aria-label={t('design_system.gallery.samples.menu.search')} placeholder={t('design_system.gallery.samples.menu.search')}
            trailing={<SimpleTooltip content={t('design_system.gallery.samples.menu.hint')}><Button variant="ghost" size="2xs" aria-label={t('design_system.gallery.samples.menu.help')}><Info className="size-5" /></Button></SimpleTooltip>} />
          <CommandMenuList>
            <CommandMenuEmpty>{t('design_system.gallery.samples.menu.noResults')}</CommandMenuEmpty>
            {withGroups ? <CommandMenuGroup heading={t('design_system.gallery.samples.menu.caption')} actionLabel={t('design_system.gallery.samples.menu.seeAll')} onAction={() => setQuery('')}>{rows}</CommandMenuGroup> : rows}
            {withGroups && <><CommandMenuSeparator /><CommandMenuGroup heading={t('design_system.gallery.samples.menu.unavailable')}><CommandMenuItem value="unavailable" disabled size={size}>{t('design_system.gallery.samples.menu.unavailable')}</CommandMenuItem></CommandMenuGroup></>}
          </CommandMenuList>
          <CommandMenuFooter className="min-h-12 flex-wrap px-5 py-3.5" helpSlot={<Button variant="link" size="2xs" onClick={() => setResult(t('design_system.gallery.samples.menu.hint'))}>{t('design_system.gallery.samples.menu.help')}</Button>} />
        </CommandMenuContent>
      </CommandMenu>
      {result && <output aria-live="polite" className="text-sm text-muted-foreground">{t('design_system.gallery.samples.menu.selected', { value: result })}</output>}
    </div>
  )
}
