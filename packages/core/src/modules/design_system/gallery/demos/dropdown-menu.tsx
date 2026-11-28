"use client"

import * as React from 'react'
import { Bell, ChevronDown, CreditCard, Keyboard, LogOut, Mail, MessageSquare, Plus, Settings, Trash2, User, UserPlus, Users } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@open-mercato/ui/primitives/dropdown-menu'

const k = (key: string) => `design_system.gallery.samples.menu.${key}`

function Trigger({ label }: { label: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="outline">
        {label}
        <ChevronDown aria-hidden />
      </Button>
    </DropdownMenuTrigger>
  )
}

export function DropdownMenuBasicExample() {
  const t = useT()
  return (
    <DropdownMenu>
      <Trigger label={t(k('open'))} />
      <DropdownMenuContent>
        <DropdownMenuLabel>{t(k('account'))}</DropdownMenuLabel>
        <DropdownMenuItem>{t(k('profile'))}</DropdownMenuItem>
        <DropdownMenuItem>{t(k('billing'))}</DropdownMenuItem>
        <DropdownMenuItem>{t(k('settings'))}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>{t(k('api'))}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DropdownMenuIconsExample() {
  const t = useT()
  return (
    <DropdownMenu>
      <Trigger label={t(k('open'))} />
      <DropdownMenuContent>
        <DropdownMenuItem><User aria-hidden />{t(k('profile'))}<DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem><CreditCard aria-hidden />{t(k('billing'))}<DropdownMenuShortcut>⌘B</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem><Settings aria-hidden />{t(k('settings'))}<DropdownMenuShortcut>⌘,</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem><Keyboard aria-hidden />{t(k('shortcuts'))}<DropdownMenuShortcut>⌘K</DropdownMenuShortcut></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DropdownMenuCheckboxesExample() {
  const t = useT()
  const [columns, setColumns] = React.useState({ owner: true, stage: true, value: false })
  return (
    <DropdownMenu>
      <Trigger label={t(k('columns'))} />
      <DropdownMenuContent>
        <DropdownMenuLabel>{t(k('visibleColumns'))}</DropdownMenuLabel>
        {(Object.keys(columns) as Array<keyof typeof columns>).map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={columns[column]}
            onCheckedChange={(checked) => setColumns((current) => ({ ...current, [column]: checked === true }))}
            onSelect={(event) => event.preventDefault()}
          >
            {t(k(`column.${column}`))}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DropdownMenuRadioExample() {
  const t = useT()
  const [sort, setSort] = React.useState('newest')
  return (
    <DropdownMenu>
      <Trigger label={`${t(k('sort'))}: ${t(k(`sortBy.${sort}`))}`} />
      <DropdownMenuContent>
        <DropdownMenuLabel>{t(k('sort'))}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
          {['newest', 'oldest', 'value'].map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>{t(k(`sortBy.${option}`))}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DropdownMenuSubmenuExample() {
  const t = useT()
  return (
    <DropdownMenu>
      <Trigger label={t(k('open'))} />
      <DropdownMenuContent>
        <DropdownMenuItem><Users aria-hidden />{t(k('team'))}</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><UserPlus aria-hidden />{t(k('invite'))}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem><Mail aria-hidden />{t(k('email'))}</DropdownMenuItem>
            <DropdownMenuItem><MessageSquare aria-hidden />{t(k('message'))}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem><Plus aria-hidden />{t(k('more'))}</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem><Plus aria-hidden />{t(k('newTeam'))}<DropdownMenuShortcut>⌘T</DropdownMenuShortcut></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DropdownMenuDestructiveExample() {
  const t = useT()
  return (
    <DropdownMenu>
      <Trigger label={t(k('actions'))} />
      <DropdownMenuContent>
        <DropdownMenuItem>{t(k('edit'))}</DropdownMenuItem>
        <DropdownMenuItem>{t(k('duplicate'))}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><Trash2 aria-hidden />{t(k('delete'))}<DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DropdownMenuAccountExample() {
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="h-auto gap-3 px-2 py-2">
          <Avatar size="sm" label="Maya Chen" />
          <span className="flex flex-col items-start text-left">
            <span className="text-sm text-foreground">Maya Chen</span>
            <span className="text-xs text-muted-foreground">maya@northline.example</span>
          </span>
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>{t(k('workspaces'))}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value="northline">
          <DropdownMenuRadioItem value="northline">Northline Logistics</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="harbor">Harbor Foods</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem><User aria-hidden />{t(k('profile'))}</DropdownMenuItem>
          <DropdownMenuItem><Bell aria-hidden />{t(k('notifications'))}</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><LogOut aria-hidden />{t(k('logout'))}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DropdownMenuComplexExample() {
  const t = useT()
  const [notify, setNotify] = React.useState(true)
  const [density, setDensity] = React.useState('comfortable')
  return (
    <DropdownMenu>
      <Trigger label={t(k('view'))} />
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>{t(k('display'))}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={density} onValueChange={setDensity}>
          <DropdownMenuRadioItem value="comfortable">{t(k('comfortable'))}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">{t(k('compact'))}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={notify} onCheckedChange={(checked) => setNotify(checked === true)}>{t(k('notifyMe'))}</DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger inset>{t(k('export'))}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>CSV</DropdownMenuItem>
            <DropdownMenuItem>Excel</DropdownMenuItem>
            <DropdownMenuItem>PDF</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem><Settings aria-hidden />{t(k('settings'))}<DropdownMenuShortcut>⌘,</DropdownMenuShortcut></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
