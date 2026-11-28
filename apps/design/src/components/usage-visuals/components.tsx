'use client'

import * as React from 'react'
import { ArrowDown, Bell, ChevronDown, Inbox, MoreHorizontal, Pencil, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Bar, Divider, FRAME, LABEL, SAMPLE, T, fieldRolesPair, framesPair, visibleLabelPair } from './specimens'
import { copy, type Copy, type UsagePairGroup } from './types'

const TEXT = {
  alerts: copy('design.usageVisuals.sample.alerts', 'Email alerts'),
  day: copy('design.usageVisuals.sample.day', 'Day'),
  longBadge: copy('design.usageVisuals.sample.longBadge', 'Waiting for the customer'),
  more: copy('design.usageVisuals.sample.more', 'More actions'),
  newLabel: copy('design.usageVisuals.sample.new', 'New'),
  person: copy('design.usageVisuals.sample.person', 'Ada Lin'),
  personInitials: copy('design.usageVisuals.sample.personInitials', 'AL'),
  terms: copy('design.usageVisuals.sample.terms', 'Send a copy'),
  week: copy('design.usageVisuals.sample.week', 'Week'),
}

const POPOVER = 'rounded-md bg-background shadow-md'
const DIALOG = 'rounded-lg bg-background shadow-lg'

function ActionButton({ text, variant }: { text: Copy; variant: React.ComponentProps<typeof Button>['variant'] }) {
  return <Button type="button" size="2xs" variant={variant} tabIndex={-1}><T c={text} /></Button>
}

function MoreButton({ size }: { size: 'default' | 'lg' | 'xs' }) {
  const t = useT()
  return (
    <IconButton size={size} tabIndex={-1} aria-label={t(TEXT.more.key, TEXT.more.fallback)}>
      {size === 'xs' ? <Pencil className="size-3" /> : <MoreHorizontal className="size-4" />}
    </IconButton>
  )
}

function TouchTarget({ sizeClass }: { sizeClass: string }) {
  return (
    <span className={`flex items-center justify-center rounded-md bg-accent-indigo/10 text-accent-indigo outline outline-1 outline-dashed outline-accent-indigo/50 ${sizeClass}`}>
      <Bell className="size-4 shrink-0" />
    </span>
  )
}

function ListboxMock({ search }: { search: boolean }) {
  return (
    <div className={`flex w-24 flex-col gap-1 p-1 ${POPOVER}`}>
      {search ? (
        <span className="flex h-5 items-center gap-1 rounded-sm border border-input bg-control px-1">
          <Search className="size-3 text-muted-foreground" />
          <Bar className="w-8" soft />
        </span>
      ) : null}
      <span className="flex h-5 items-center rounded-sm bg-accent px-1"><Bar className="w-12" /></span>
      <span className="flex h-5 items-center px-1"><Bar className="w-16" /></span>
      {search ? null : <span className="flex h-5 items-center px-1"><Bar className="w-10" /></span>}
    </div>
  )
}

function ToggleRow({ control, labelled }: { control: 'checkbox' | 'switch'; labelled: boolean }) {
  return (
    <span className="flex items-center gap-2">
      {control === 'checkbox' ? <Checkbox checked tabIndex={-1} /> : <Switch checked tabIndex={-1} />}
      {labelled ? <span className={LABEL}><T c={control === 'checkbox' ? TEXT.terms : TEXT.alerts} /></span> : null}
    </span>
  )
}

function StatusRows({ second }: { second: 'success' | 'info' }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2"><Bar className="w-8" /><StatusBadge variant="success" dot><T c={SAMPLE.paid} /></StatusBadge></span>
      <span className="flex items-center gap-2"><Bar className="w-8" /><StatusBadge variant={second} dot><T c={SAMPLE.paid} /></StatusBadge></span>
    </div>
  )
}

function DialogMock({ children }: { children: React.ReactNode }) {
  return <div className={`flex w-28 flex-col gap-2 p-2 ${DIALOG}`}>{children}</div>
}

function ConfirmDialog({ variant }: { variant: 'destructive-solid' | 'default' }) {
  return (
    <DialogMock>
      <Bar className="w-16" />
      <Bar soft />
      <span className="flex items-center justify-end gap-2">
        <span className="block h-7 w-8 rounded-md border border-border bg-control" />
        <ActionButton text={SAMPLE.delete} variant={variant} />
      </span>
    </DialogMock>
  )
}

function TableMock({ header, empty = 'rows' }: { header?: React.ReactNode; empty?: 'rows' | 'blank' | 'message' }) {
  return (
    <div className={`flex w-24 flex-col overflow-hidden rounded-md ${FRAME}`}>
      <span className="flex h-5 items-center gap-2 border-b border-border bg-muted px-2">
        {header ?? <><Bar className="w-6" /><Bar className="w-4" /></>}
      </span>
      {empty === 'rows' ? (
        <>
          <span className="flex h-4 items-center gap-2 border-b border-border px-2"><Bar className="w-10" soft /><Bar className="w-4" soft /></span>
          <span className="flex h-4 items-center gap-2 px-2"><Bar className="w-8" soft /><Bar className="w-4" soft /></span>
        </>
      ) : null}
      {empty === 'blank' ? <span className="block h-12" /> : null}
      {empty === 'message' ? (
        <span className="flex h-12 flex-col items-center justify-center gap-1">
          <Inbox className="size-4 text-muted-foreground" />
          <Bar className="w-12" soft />
          <span className="block h-2 w-8 rounded-sm bg-primary" />
        </span>
      ) : null}
    </div>
  )
}

function HeaderLabel({ uppercase }: { uppercase: boolean }) {
  return (
    <span
      className={uppercase ? 'whitespace-nowrap text-muted-foreground' : 'whitespace-nowrap text-xs leading-4 text-muted-foreground'}
      style={uppercase ? { fontSize: 10, lineHeight: '16px', textTransform: 'uppercase', letterSpacing: '0.1em' } : undefined}
    >
      <T c={SAMPLE.customer} />
    </span>
  )
}

function SortHeader({ flat }: { flat: boolean }) {
  if (flat) {
    return (
      <span className="flex items-center gap-1 whitespace-nowrap text-xs leading-4 text-foreground">
        <T c={SAMPLE.customer} />
        <ChevronDown className="size-3" />
      </span>
    )
  }
  return (
    <span className="-ml-1 flex items-center gap-1 whitespace-nowrap rounded-md bg-background px-1 text-xs leading-4 text-foreground shadow-xs">
      <T c={SAMPLE.customer} />
      <ArrowDown className="size-4" />
    </span>
  )
}

function PageTabs({ variant }: { variant: 'underline' | 'pill' }) {
  if (variant === 'underline') {
    return (
      <div className="flex w-28 flex-col gap-3">
        <Bar className="w-12" />
        <span className="flex gap-3 border-b border-border">
          <span className="-mb-px flex h-4 items-start border-b-2 border-accent-indigo"><Bar className="w-6" /></span>
          <span className="flex h-4 items-start"><Bar className="w-6" soft /></span>
          <span className="flex h-4 items-start"><Bar className="w-6" soft /></span>
        </span>
        <Bar soft />
      </div>
    )
  }
  return (
    <div className="flex w-28 flex-col gap-3">
      <Bar className="w-12" />
      <span className="flex gap-1 self-start rounded-lg bg-muted-foreground/20 p-1">
        <span className="flex h-4 items-center rounded-md bg-background px-1"><Bar className="w-6" /></span>
        <span className="flex h-4 items-center px-1"><Bar className="w-6" soft /></span>
        <span className="flex h-4 items-center px-1"><Bar className="w-6" soft /></span>
      </span>
      <Bar soft />
    </div>
  )
}

function SwitcherTabs() {
  const t = useT()
  return (
    <Tabs value="day">
      <TabsList aria-label={t(TEXT.more.key, TEXT.more.fallback)}>
        <TabsTrigger value="day" className="px-2"><T c={TEXT.day} /></TabsTrigger>
        <TabsTrigger value="week" className="px-2"><T c={TEXT.week} /></TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

function HandRolledTabs() {
  return (
    <span className="flex">
      <span className="flex h-8 items-center border border-border bg-card px-3 text-sm text-foreground" style={{ borderBottomWidth: 3 }}><T c={TEXT.day} /></span>
      <span className="flex h-8 items-center border border-l-0 border-border px-3 text-sm text-muted-foreground"><T c={TEXT.week} /></span>
    </span>
  )
}

function PersonAvatar({ size, withBadge = false }: { size: 20 | 40; withBadge?: boolean }) {
  const t = useT()
  return <Avatar size={size} label={t(TEXT.person.key, TEXT.person.fallback)} badge={withBadge ? <Pencil className="size-3" /> : undefined} />
}

function HandMadeAvatar({ shape }: { shape: 'tiny' | 'square' }) {
  const shapeClass = shape === 'tiny' ? 'size-5 rounded-full text-xs' : 'size-10 rounded-md text-base'
  return <span className={`flex items-center justify-center bg-primary/10 text-primary ${shapeClass}`}><T c={TEXT.personInitials} /></span>
}

function MenuMock({ destructiveFirst }: { destructiveFirst: boolean }) {
  const destructive = <span className="flex h-5 items-center px-1 text-xs leading-4 text-destructive"><T c={SAMPLE.delete} /></span>
  return (
    <div className={`flex w-24 flex-col p-1 ${POPOVER}`}>
      {destructiveFirst ? destructive : null}
      <span className="flex h-5 items-center px-1"><Bar className="w-12" /></span>
      <span className="flex h-5 items-center px-1"><Bar className="w-16" /></span>
      {destructiveFirst ? null : <><span className="my-1 block h-px bg-border" />{destructive}</>}
    </div>
  )
}

function SubmenuStairs({ levels }: { levels: number }) {
  const offsets = ['', 'mt-3', 'mt-6', 'mt-9']
  return (
    <div className="flex items-start gap-1">
      {offsets.slice(0, levels).map((offset, index) => (
        <span key={index} className={`flex w-8 flex-col gap-1 rounded-sm bg-background p-1 shadow-md ${offset}`}>
          <Bar />
          <Bar soft />
          <Bar soft />
        </span>
      ))}
    </div>
  )
}

export const COMPONENT_PAIRS: UsagePairGroup = {
  button: [
    {
      id: 'one-primary',
      title: copy('design.usageVisuals.button.primary.title', 'One primary action'),
      covers: ['One default (primary) Button per view; remaining actions step down to outline, ghost or muted.'],
      do: {
        caption: copy('design.usageVisuals.button.primary.do', 'One stands out, the rest stay calm'),
        specimen: <span className="flex items-center gap-2"><ActionButton text={SAMPLE.cancel} variant="outline" /><ActionButton text={SAMPLE.save} variant="default" /></span>,
      },
      avoid: {
        caption: copy('design.usageVisuals.button.primary.avoid', 'Two primary buttons compete'),
        specimen: <span className="flex items-center gap-2"><ActionButton text={SAMPLE.cancel} variant="default" /><ActionButton text={SAMPLE.save} variant="default" /></span>,
      },
    },
    {
      id: 'quiet-destructive',
      title: copy('design.usageVisuals.button.destructive.title', 'Delete stays quiet on the page'),
      do: {
        caption: copy('design.usageVisuals.button.destructive.do', 'Red text on a calm surface'),
        specimen: <ActionButton text={SAMPLE.delete} variant="destructive" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.button.destructive.avoid', 'Solid red before any confirmation'),
        specimen: <ActionButton text={SAMPLE.delete} variant="destructive-solid" />,
      },
    },
  ],
  'icon-button': [
    {
      id: 'touch-area',
      title: copy('design.usageVisuals.iconButton.target.title', 'Target larger than the icon'),
      do: {
        caption: copy('design.usageVisuals.iconButton.target.do', '16 px icon in a 32 px target'),
        specimen: <TouchTarget sizeClass="size-8" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.iconButton.target.avoid', 'The target is the icon itself'),
        specimen: <TouchTarget sizeClass="size-4" />,
      },
    },
    {
      id: 'row-height',
      title: copy('design.usageVisuals.iconButton.row.title', 'Same height in a button row'),
      covers: ['size="default" is h-8, one step smaller than Button; use size="lg" (h-9) to align inside a Button row.'],
      do: {
        caption: copy('design.usageVisuals.iconButton.row.do', 'The large size lines up'),
        specimen: <span className="flex items-center gap-2"><Button type="button" variant="outline" tabIndex={-1}><T c={SAMPLE.save} /></Button><MoreButton size="lg" /></span>,
      },
      avoid: {
        caption: copy('design.usageVisuals.iconButton.row.avoid', 'The default size is shorter'),
        specimen: <span className="flex items-start gap-2"><Button type="button" variant="outline" tabIndex={-1}><T c={SAMPLE.save} /></Button><MoreButton size="default" /></span>,
      },
    },
  ],
  input: [visibleLabelPair()],
  'form-field': [visibleLabelPair(), fieldRolesPair()],
  select: [
    {
      id: 'no-search-inside',
      title: copy('design.usageVisuals.select.search.title', 'Search belongs in Dropdown'),
      do: {
        caption: copy('design.usageVisuals.select.search.do', 'A plain list of options'),
        specimen: <ListboxMock search={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.select.search.avoid', 'A search field inside the list'),
        specimen: <ListboxMock search />,
      },
    },
  ],
  checkbox: [
    {
      id: 'checkbox-label',
      title: copy('design.usageVisuals.checkbox.label.title', 'A checkbox comes with its label'),
      do: {
        caption: copy('design.usageVisuals.checkbox.label.do', 'The label says what it sets'),
        specimen: <ToggleRow control="checkbox" labelled />,
      },
      avoid: {
        caption: copy('design.usageVisuals.checkbox.label.avoid', 'A box with nothing beside it'),
        specimen: <ToggleRow control="checkbox" labelled={false} />,
      },
    },
  ],
  switch: [
    {
      id: 'switch-label',
      title: copy('design.usageVisuals.switch.label.title', 'A switch comes with its label'),
      do: {
        caption: copy('design.usageVisuals.switch.label.do', 'The label names the setting'),
        specimen: <ToggleRow control="switch" labelled />,
      },
      avoid: {
        caption: copy('design.usageVisuals.switch.label.avoid', 'A switch with nothing beside it'),
        specimen: <ToggleRow control="switch" labelled={false} />,
      },
    },
  ],
  badge: [
    {
      id: 'short-content',
      title: copy('design.usageVisuals.badge.short.title', 'Counts and short labels'),
      do: {
        caption: copy('design.usageVisuals.badge.short.do', 'A count and a one-word label'),
        specimen: <span className="flex items-center gap-2"><Badge variant="secondary"><T c={SAMPLE.count} /></Badge><Badge variant="info"><T c={TEXT.newLabel} /></Badge></span>,
      },
      avoid: {
        caption: copy('design.usageVisuals.badge.short.avoid', 'A whole sentence in a badge'),
        specimen: <Badge variant="info" className="max-w-28"><span className="truncate"><T c={TEXT.longBadge} /></span></Badge>,
      },
    },
    {
      id: 'token-colours',
      title: copy('design.usageVisuals.badge.colours.title', 'Colours from the variants'),
      covers: ['Semantic variants (success/warning/info/neutral/error) come from status tokens — no custom colors.'],
      do: {
        caption: copy('design.usageVisuals.badge.colours.do', 'The success variant'),
        specimen: <Badge variant="success"><T c={SAMPLE.paid} /></Badge>,
      },
      avoid: {
        caption: copy('design.usageVisuals.badge.colours.avoid', 'A colour picked by hand'),
        specimen: <Badge variant="outline" style={{ background: 'var(--accent-indigo)', borderColor: 'transparent', color: 'var(--accent-indigo-foreground)' }}><T c={SAMPLE.paid} /></Badge>,
      },
    },
    {
      id: 'status-elsewhere',
      title: copy('design.usageVisuals.badge.status.title', 'Status goes to StatusBadge'),
      do: {
        caption: copy('design.usageVisuals.badge.status.do', 'A status with its dot'),
        specimen: <StatusBadge variant="success" dot><T c={SAMPLE.active} /></StatusBadge>,
      },
      avoid: {
        caption: copy('design.usageVisuals.badge.status.avoid', 'A plain badge posing as status'),
        specimen: <Badge><T c={SAMPLE.active} /></Badge>,
      },
    },
  ],
  'status-badge': [
    {
      id: 'one-colour-per-status',
      title: copy('design.usageVisuals.statusBadge.map.title', 'One status, one colour'),
      do: {
        caption: copy('design.usageVisuals.statusBadge.map.do', 'Paid looks the same in every row'),
        specimen: <StatusRows second="success" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.statusBadge.map.avoid', 'Paid in two colours'),
        specimen: <StatusRows second="info" />,
      },
    },
    {
      id: 'status-not-label',
      title: copy('design.usageVisuals.statusBadge.label.title', 'Applied labels go to Tag'),
      covers: ['Not for user-applied labels or categories — that is Tag.'],
      do: {
        caption: copy('design.usageVisuals.statusBadge.label.do', 'A status badge and a tag'),
        specimen: (
          <span className="flex flex-col items-start gap-2">
            <StatusBadge variant="success" dot><T c={SAMPLE.active} /></StatusBadge>
            <Tag><T c={SAMPLE.wholesale} /></Tag>
          </span>
        ),
      },
      avoid: {
        caption: copy('design.usageVisuals.statusBadge.label.avoid', 'A category styled as status'),
        specimen: <StatusBadge variant="info" dot><T c={SAMPLE.wholesale} /></StatusBadge>,
      },
    },
  ],
  tag: [
    {
      id: 'label-not-state',
      title: copy('design.usageVisuals.tag.state.title', 'Tags are labels, not states'),
      covers: ['Not for system status — that is StatusBadge.'],
      do: {
        caption: copy('design.usageVisuals.tag.state.do', 'A label a person applied'),
        specimen: <Tag><T c={SAMPLE.wholesale} /></Tag>,
      },
      avoid: {
        caption: copy('design.usageVisuals.tag.state.avoid', 'A system state shown as a tag'),
        specimen: <Tag variant="error" dot><T c={SAMPLE.failed} /></Tag>,
      },
    },
  ],
  alert: [
    {
      id: 'alert-primitive',
      title: copy('design.usageVisuals.alert.primitive.title', 'Notices use Alert'),
      covers: ['Never build ad-hoc colored notice boxes; this is the primitive for them.'],
      do: {
        caption: copy('design.usageVisuals.alert.primitive.do', 'The Alert primitive'),
        specimen: <Alert status="success" size="xs" className="w-28"><T c={SAMPLE.draftSaved} /></Alert>,
      },
      avoid: {
        caption: copy('design.usageVisuals.alert.primitive.avoid', 'A coloured box made by hand'),
        specimen: (
          <span className="block w-28 px-2 py-1 text-xs leading-4" style={{ background: '#e5e7eb', color: '#374151', borderLeft: '3px solid #6b7280' }}>
            <T c={SAMPLE.draftSaved} />
          </span>
        ),
      },
    },
    {
      id: 'alert-emphasis',
      title: copy('design.usageVisuals.alert.emphasis.title', 'Loud only when it matters'),
      do: {
        caption: copy('design.usageVisuals.alert.emphasis.do', 'A light notice for routine news'),
        specimen: <Alert status="information" style="lighter" size="xs" className="w-28"><T c={SAMPLE.draftSaved} /></Alert>,
      },
      avoid: {
        caption: copy('design.usageVisuals.alert.emphasis.avoid', 'A filled alert for a small note'),
        specimen: <Alert status="information" style="filled" size="xs" className="w-28"><T c={SAMPLE.draftSaved} /></Alert>,
      },
    },
  ],
  dialog: [
    {
      id: 'dialog-is-frame',
      title: copy('design.usageVisuals.dialog.frame.title', 'The dialog is the frame'),
      do: {
        caption: copy('design.usageVisuals.dialog.frame.do', 'Content sits in the dialog itself'),
        specimen: <DialogMock><Bar className="w-12" /><Bar /><Divider /><Bar className="w-16" /><Bar /></DialogMock>,
      },
      avoid: {
        caption: copy('design.usageVisuals.dialog.frame.avoid', 'A bordered card inside it'),
        specimen: (
          <DialogMock>
            <Bar className="w-12" />
            <div className={`flex flex-col gap-2 rounded-md p-2 ${FRAME}`}><Bar /><Bar className="w-12" /></div>
          </DialogMock>
        ),
      },
    },
    {
      id: 'confirm-solid',
      title: copy('design.usageVisuals.dialog.confirm.title', 'Solid red only to confirm'),
      do: {
        caption: copy('design.usageVisuals.dialog.confirm.do', 'The final confirm is solid red'),
        specimen: <ConfirmDialog variant="destructive-solid" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.dialog.confirm.avoid', 'It looks like any other action'),
        specimen: <ConfirmDialog variant="default" />,
      },
    },
  ],
  card: [
    framesPair(copy('design.usageVisuals.card.frames.avoid', 'A card inside a card')),
    {
      id: 'tinted-note',
      title: copy('design.usageVisuals.card.note.title', 'Highlight with a tint'),
      do: {
        caption: copy('design.usageVisuals.card.note.do', 'A muted note without a border'),
        specimen: (
          <div className={`flex w-28 flex-col gap-2 rounded-md p-2 ${FRAME}`}>
            <Bar className="w-12" />
            <span className="flex flex-col gap-1 rounded-md bg-muted p-2"><Bar /><Bar className="w-12" /></span>
          </div>
        ),
      },
      avoid: {
        caption: copy('design.usageVisuals.card.note.avoid', 'A second bordered box'),
        specimen: (
          <div className={`flex w-28 flex-col gap-2 rounded-md p-2 ${FRAME}`}>
            <Bar className="w-12" />
            <span className={`flex flex-col gap-1 rounded-md p-2 ${FRAME}`}><Bar /><Bar className="w-12" /></span>
          </div>
        ),
      },
    },
  ],
  table: [
    {
      id: 'table-is-frame',
      title: copy('design.usageVisuals.table.frame.title', 'The table is the frame'),
      covers: ['Do not wrap the table in a Card; the table container is the frame.'],
      do: {
        caption: copy('design.usageVisuals.table.frame.do', 'A table straight on the page'),
        specimen: <TableMock />,
      },
      avoid: {
        caption: copy('design.usageVisuals.table.frame.avoid', 'A table wrapped in a card'),
        specimen: <div className={`flex flex-col gap-1 rounded-md p-1 ${FRAME}`}><Bar className="w-10" /><TableMock /></div>,
      },
    },
    {
      id: 'header-case',
      title: copy('design.usageVisuals.table.header.title', 'Sentence case headers'),
      covers: ['Do not write headers in uppercase.'],
      do: {
        caption: copy('design.usageVisuals.table.header.do', 'A header in sentence case'),
        specimen: <TableMock header={<HeaderLabel uppercase={false} />} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.table.header.avoid', 'Uppercase with wide tracking'),
        specimen: <TableMock header={<HeaderLabel uppercase />} />,
      },
    },
    {
      id: 'sort-in-header',
      title: copy('design.usageVisuals.table.sort.title', 'The header label sorts'),
      covers: ['Do not build a sortable header from a Button; the label itself is the control.'],
      do: {
        caption: copy('design.usageVisuals.table.sort.do', 'A flat label with a small chevron'),
        specimen: <TableMock header={<SortHeader flat />} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.table.sort.avoid', 'A button with a large arrow'),
        specimen: <TableMock header={<SortHeader flat={false} />} />,
      },
    },
  ],
  tabs: [
    {
      id: 'page-tabs',
      title: copy('design.usageVisuals.tabs.page.title', 'Underline for page tabs'),
      do: {
        caption: copy('design.usageVisuals.tabs.page.do', 'An underline strip under the title'),
        specimen: <PageTabs variant="underline" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.tabs.page.avoid', 'A pill switcher as page tabs'),
        specimen: <PageTabs variant="pill" />,
      },
    },
    {
      id: 'tabs-primitive',
      title: copy('design.usageVisuals.tabs.primitive.title', 'Tabs come from the primitive'),
      covers: ['No hand-rolled tab strips from buttons and border classes — lint flags raw tab lists.'],
      do: {
        caption: copy('design.usageVisuals.tabs.primitive.do', 'A small switcher from Tabs'),
        specimen: <SwitcherTabs />,
      },
      avoid: {
        caption: copy('design.usageVisuals.tabs.primitive.avoid', 'Buttons and borders as tabs'),
        specimen: <HandRolledTabs />,
      },
    },
  ],
  'empty-state': [
    {
      id: 'empty-handled',
      title: copy('design.usageVisuals.emptyState.handled.title', 'An empty list says so'),
      do: {
        caption: copy('design.usageVisuals.emptyState.handled.do', 'A message and a next step'),
        specimen: <TableMock empty="message" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.emptyState.handled.avoid', 'Headers above a blank area'),
        specimen: <TableMock empty="blank" />,
      },
    },
  ],
  avatar: [
    {
      id: 'initials',
      title: copy('design.usageVisuals.avatar.initials.title', 'Small avatars show one initial'),
      do: {
        caption: copy('design.usageVisuals.avatar.initials.do', 'One initial when small'),
        specimen: <span className="flex items-center gap-3"><PersonAvatar size={20} /><PersonAvatar size={40} /></span>,
      },
      avoid: {
        caption: copy('design.usageVisuals.avatar.initials.avoid', 'Two letters crammed at 20 px'),
        specimen: <span className="flex items-center gap-3"><HandMadeAvatar shape="tiny" /><PersonAvatar size={40} /></span>,
      },
    },
    {
      id: 'round',
      title: copy('design.usageVisuals.avatar.round.title', 'Avatars are round'),
      do: {
        caption: copy('design.usageVisuals.avatar.round.do', 'A circle from the primitive'),
        specimen: <PersonAvatar size={40} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.avatar.round.avoid', 'A square made by hand'),
        specimen: <HandMadeAvatar shape="square" />,
      },
    },
    {
      id: 'actions-outside',
      title: copy('design.usageVisuals.avatar.actions.title', 'Actions sit beside the avatar'),
      covers: ['Do not render interactive actions inside the decorative badge slot; put actions in a separate button.'],
      do: {
        caption: copy('design.usageVisuals.avatar.actions.do', 'Edit is its own button'),
        specimen: <span className="flex items-center gap-2"><PersonAvatar size={40} /><MoreButton size="xs" /></span>,
      },
      avoid: {
        caption: copy('design.usageVisuals.avatar.actions.avoid', 'Edit hidden in the badge slot'),
        specimen: <PersonAvatar size={40} withBadge />,
      },
    },
  ],
  'dropdown-menu': [
    {
      id: 'destructive-last',
      title: copy('design.usageVisuals.dropdownMenu.order.title', 'Destructive actions go last'),
      covers: ['Group related items with labels and separators and put destructive actions last'],
      do: {
        caption: copy('design.usageVisuals.dropdownMenu.order.do', 'Delete last, after a separator'),
        specimen: <MenuMock destructiveFirst={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.dropdownMenu.order.avoid', 'Delete mixed in at the top'),
        specimen: <MenuMock destructiveFirst />,
      },
    },
    {
      id: 'one-submenu',
      title: copy('design.usageVisuals.dropdownMenu.depth.title', 'One level of submenu'),
      covers: ['Do not nest submenus more than one level deep'],
      do: {
        caption: copy('design.usageVisuals.dropdownMenu.depth.do', 'A menu with one submenu'),
        specimen: <SubmenuStairs levels={2} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.dropdownMenu.depth.avoid', 'Submenus opening submenus'),
        specimen: <SubmenuStairs levels={3} />,
      },
    },
  ],
}
