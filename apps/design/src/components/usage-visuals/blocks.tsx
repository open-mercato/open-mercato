'use client'

import * as React from 'react'
import { Check, MoreHorizontal, Search, Trash2, X } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Bar, LABEL, LABEL_MUTED, SAMPLE, SOLID, SURFACE, T, evenRhythmPair } from './specimens'
import { copy, type UsagePairGroup } from './types'

const TEXT = {
  chipRaw: copy('design.usageVisuals.sample.chipRaw', 'stage_id=3'),
  chipReadable: copy('design.usageVisuals.sample.chipReadable', 'Stage: Won'),
  countOrders: copy('design.usageVisuals.sample.countOrders', '128 orders'),
  owner: copy('design.usageVisuals.sample.owner', 'Owner'),
  ownerName: copy('design.usageVisuals.sample.ownerName', 'Ada Lin'),
}

const PRIMARY_BLOCK = 'block h-5 w-6 shrink-0 rounded-sm bg-primary'
const QUIET_BLOCK = 'block h-5 w-5 shrink-0 rounded-sm border border-border bg-control'
const DASHED = 'outline outline-1 outline-dashed outline-muted-foreground/60'

function MiniTabs() {
  return (
    <span className="flex gap-3 border-b border-border">
      <span className="-mb-px flex h-4 items-start border-b-2 border-accent-indigo"><Bar className="w-6" /></span>
      <span className="flex h-4 items-start"><Bar className="w-6" soft /></span>
      <span className="flex h-4 items-start"><Bar className="w-6" soft /></span>
    </span>
  )
}

function HeaderActions({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex w-28 items-center justify-between gap-1">
      <Bar className={collapsed ? 'w-10' : 'w-3'} />
      {collapsed ? (
        <span className="flex items-center gap-1">
          <span className={PRIMARY_BLOCK} />
          <span className={`${QUIET_BLOCK} flex items-center justify-center`}><MoreHorizontal className="size-3 text-muted-foreground" /></span>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <span className={PRIMARY_BLOCK} />
          <span className={QUIET_BLOCK} />
          <span className={QUIET_BLOCK} />
          <span className={QUIET_BLOCK} />
        </span>
      )}
    </div>
  )
}

function HeaderCount({ repeated }: { repeated: boolean }) {
  return (
    <div className="flex w-28 flex-col gap-1">
      <span className="flex items-center gap-2">
        <span className="text-base leading-6 text-foreground"><T c={SAMPLE.orders} /></span>
        <Badge variant="secondary" size="sm"><T c={SAMPLE.count} /></Badge>
      </span>
      {repeated ? <span className={LABEL_MUTED}><T c={TEXT.countOrders} /></span> : <Bar className="w-20" soft />}
    </div>
  )
}

function HeaderTabs({ strips }: { strips: number }) {
  return (
    <div className="flex w-28 flex-col gap-2">
      <Bar className="w-12" />
      <MiniTabs />
      {strips > 1 ? <MiniTabs /> : null}
      <Bar soft />
    </div>
  )
}

function NarrowPanel({ vertical }: { vertical: boolean }) {
  const row = (
    <span className={vertical ? 'flex flex-col gap-1' : 'flex items-center gap-1'}>
      <Bar className={vertical ? 'w-6' : 'w-5'} soft />
      <Bar className={vertical ? 'w-12' : 'w-5'} />
    </span>
  )
  return <div className={`flex w-16 flex-col ${vertical ? 'gap-2' : 'gap-3'} rounded-md p-2 ${SURFACE}`}>{row}{row}{vertical ? null : row}</div>
}

function LabelValue({ quietLabel }: { quietLabel: boolean }) {
  const labelClass = quietLabel ? LABEL_MUTED : LABEL
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <span className={labelClass}><T c={TEXT.owner} /></span>
      <span className={LABEL}><T c={TEXT.ownerName} /></span>
      <span className={labelClass}><T c={SAMPLE.total} /></span>
      <span className={LABEL}><T c={SAMPLE.count} /></span>
    </div>
  )
}

function TimelineItem({ wide = false }: { wide?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`block size-2 shrink-0 rounded-full ${SOLID}`} />
      <Bar className={wide ? 'w-16' : 'w-12'} />
    </span>
  )
}

function TimelineDays({ grouped }: { grouped: boolean }) {
  return (
    <div className="flex w-24 flex-col gap-2">
      {grouped ? <Bar className="w-8" soft /> : <TimelineItem wide />}
      <TimelineItem />
      <TimelineItem wide />
      {grouped ? <Bar className="w-10" soft /> : <TimelineItem />}
      <TimelineItem />
    </div>
  )
}

function TimelineChanges({ merged }: { merged: boolean }) {
  if (merged) {
    return (
      <div className="flex w-24 flex-col gap-2">
        <TimelineItem wide />
        <span className="ml-4 flex flex-col gap-2">
          <Bar className="w-16" soft />
          <Bar className="w-12" soft />
          <Bar className="w-16" soft />
        </span>
      </div>
    )
  }
  return (
    <div className="flex w-24 flex-col gap-3">
      <TimelineItem wide />
      <TimelineItem wide />
      <TimelineItem wide />
    </div>
  )
}

function KanbanCard({ withButton }: { withButton: boolean }) {
  return (
    <div className="flex w-20 flex-col gap-1 rounded-md bg-muted-foreground/10 p-1">
      <span className={`flex flex-col gap-2 rounded-sm p-2 ${SURFACE}`}>
        <Bar className="w-12" />
        <Bar className="w-8" soft />
        {withButton ? <span className="block h-4 w-10 rounded-sm border border-border bg-control" /> : null}
      </span>
    </div>
  )
}

function WizardSteps({ marked }: { marked: boolean }) {
  const done = 'flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-indigo text-accent-indigo-foreground'
  return (
    <div className="flex w-28 items-center gap-1">
      <span className={done}><Check className="size-3" /></span>
      <span className="block h-px flex-1 bg-border" />
      {marked ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-status-error-bg text-status-error-icon outline outline-1 outline-status-error-border"><X className="size-3" /></span>
      ) : (
        <span className={done}><Check className="size-3" /></span>
      )}
      <span className="block h-px flex-1 bg-border" />
      <span className="block size-5 shrink-0 rounded-full bg-muted-foreground/20" />
    </div>
  )
}

function GridOrNesting({ nested }: { nested: boolean }) {
  const block = `block h-5 rounded-sm ${SOLID}`
  if (!nested) {
    return (
      <div className="grid w-24 grid-cols-2 gap-2">
        <span className={block} /><span className={block} /><span className={block} /><span className={block} />
      </div>
    )
  }
  return (
    <div className={`flex w-28 flex-col gap-1 rounded-sm p-1 ${DASHED}`}>
      <div className={`flex gap-1 rounded-sm p-1 ${DASHED}`}>
        <div className={`flex flex-1 flex-col gap-1 rounded-sm p-1 ${DASHED}`}><span className={block} /><span className={block} /></div>
        <div className={`flex flex-1 flex-col gap-1 rounded-sm p-1 ${DASHED}`}><span className={block} /><span className={block} /></div>
      </div>
    </div>
  )
}

function ListRows() {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <span key={index} className="flex items-center gap-2">
          <span className="block size-2 shrink-0 rounded-sm bg-accent-indigo" />
          <Bar className={index === 1 ? 'w-16' : 'w-20'} soft />
        </span>
      ))}
    </>
  )
}

function FloatingBars({ count }: { count: number }) {
  const bar = (
    <span className="mx-auto flex h-4 w-20 items-center justify-between rounded-md bg-background px-1 shadow-md">
      <Bar className="w-6" />
      <span className="block h-2 w-4 rounded-sm bg-primary" />
    </span>
  )
  return (
    <div className="flex h-20 w-28 flex-col justify-between">
      <span className="flex flex-col gap-2"><ListRows /></span>
      <span className="flex flex-col gap-1">{count > 1 ? bar : null}{bar}</span>
    </div>
  )
}

function SaveBar() {
  return (
    <span className="flex h-5 w-full items-center justify-end rounded-md bg-background px-1 shadow-md">
      <span className="block h-3 w-6 rounded-sm bg-primary" />
    </span>
  )
}

function FieldBox() {
  return <span className="block h-5 w-full shrink-0 rounded-sm border border-input bg-control" />
}

function SavePage({ headerSave }: { headerSave: boolean }) {
  return (
    <div className="flex h-20 w-28 flex-col justify-between">
      <span className="flex flex-col gap-2">
        <span className="flex h-3 items-center justify-between">
          <Bar className="w-10" />
          {headerSave ? <span className="block h-3 w-6 rounded-sm bg-primary" /> : null}
        </span>
        <FieldBox />
      </span>
      <SaveBar />
    </div>
  )
}

function SaveOverlap({ covered }: { covered: boolean }) {
  return (
    <div className="relative h-20 w-28">
      <span className="flex flex-col gap-2">
        <FieldBox />
        <FieldBox />
        {covered ? <FieldBox /> : null}
      </span>
      <span className="absolute inset-x-0 bottom-0 flex"><SaveBar /></span>
    </div>
  )
}

function SearchField() {
  return (
    <span className="flex h-5 min-w-0 flex-1 items-center gap-1 rounded-sm border border-input bg-control px-1">
      <Search className="size-3 shrink-0 text-muted-foreground" />
      <Bar className="w-8" soft />
    </span>
  )
}

function ToolbarCreate({ repeated }: { repeated: boolean }) {
  return (
    <div className="flex w-28 flex-col gap-3">
      <span className="flex items-center justify-between"><Bar className="w-10" /><span className={PRIMARY_BLOCK} /></span>
      <span className="flex items-center gap-1"><SearchField />{repeated ? <span className={PRIMARY_BLOCK} /> : null}</span>
    </div>
  )
}

function ToolbarActions({ deleteOutside }: { deleteOutside: boolean }) {
  return (
    <div className="flex w-28 items-center gap-1">
      <SearchField />
      {deleteOutside ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-destructive bg-control"><Trash2 className="size-3 text-destructive" /></span>
      ) : null}
      <span className={`${QUIET_BLOCK} flex items-center justify-center`}><MoreHorizontal className="size-3 text-muted-foreground" /></span>
    </div>
  )
}

function FilterChip({ raw }: { raw: boolean }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2 text-xs text-foreground ${SURFACE} ${raw ? 'font-mono' : ''}`}>
      <T c={raw ? TEXT.chipRaw : TEXT.chipReadable} />
    </span>
  )
}

export const BLOCK_PAIRS: UsagePairGroup = {
  'entity-header': [
    {
      id: 'one-primary-action',
      title: copy('design.usageVisuals.entityHeader.actions.title', 'One primary, the rest in a menu'),
      covers: ['Mark one action as primaryActionKey and let the rest collapse into the overflow menu'],
      do: {
        caption: copy('design.usageVisuals.entityHeader.actions.do', 'A main action and an overflow menu'),
        specimen: <HeaderActions collapsed />,
      },
      avoid: {
        caption: copy('design.usageVisuals.entityHeader.actions.avoid', 'Every action as its own button'),
        specimen: <HeaderActions collapsed={false} />,
      },
    },
    {
      id: 'count-once',
      title: copy('design.usageVisuals.entityHeader.count.title', 'The count appears once'),
      covers: ['Do not repeat the count in the subtitle or in a tab badge on the same screen'],
      do: {
        caption: copy('design.usageVisuals.entityHeader.count.do', 'One count next to the title'),
        specimen: <HeaderCount repeated={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.entityHeader.count.avoid', 'The subtitle says it again'),
        specimen: <HeaderCount repeated />,
      },
    },
    {
      id: 'one-tab-strip',
      title: copy('design.usageVisuals.entityHeader.tabs.title', 'One tab strip'),
      covers: ['Do not build a second tab strip in the below slot; the below slot stays above the tabs and is meant for short supporting content'],
      do: {
        caption: copy('design.usageVisuals.entityHeader.tabs.do', 'Tabs once, under the header'),
        specimen: <HeaderTabs strips={1} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.entityHeader.tabs.avoid', 'A second strip below the first'),
        specimen: <HeaderTabs strips={2} />,
      },
    },
  ],
  'key-value': [
    {
      id: 'narrow-vertical',
      title: copy('design.usageVisuals.keyValue.narrow.title', 'Stack fields in narrow panels'),
      do: {
        caption: copy('design.usageVisuals.keyValue.narrow.do', 'Label above value in a side panel'),
        specimen: <NarrowPanel vertical />,
      },
      avoid: {
        caption: copy('design.usageVisuals.keyValue.narrow.avoid', 'Label and value squeezed in a row'),
        specimen: <NarrowPanel vertical={false} />,
      },
    },
    {
      id: 'quiet-labels',
      title: copy('design.usageVisuals.keyValue.labels.title', 'Labels quieter than values'),
      do: {
        caption: copy('design.usageVisuals.keyValue.labels.do', 'Muted label, clear value'),
        specimen: <LabelValue quietLabel />,
      },
      avoid: {
        caption: copy('design.usageVisuals.keyValue.labels.avoid', 'Label and value look the same'),
        specimen: <LabelValue quietLabel={false} />,
      },
    },
  ],
  timeline: [
    {
      id: 'group-by-day',
      title: copy('design.usageVisuals.timeline.days.title', 'Group long histories by day'),
      covers: ['Use groupBy="day" for long histories'],
      do: {
        caption: copy('design.usageVisuals.timeline.days.do', 'Day headings break up the list'),
        specimen: <TimelineDays grouped />,
      },
      avoid: {
        caption: copy('design.usageVisuals.timeline.days.avoid', 'One long unbroken list'),
        specimen: <TimelineDays grouped={false} />,
      },
    },
    {
      id: 'merge-changes',
      title: copy('design.usageVisuals.timeline.changes.title', 'One event, several changes'),
      do: {
        caption: copy('design.usageVisuals.timeline.changes.do', 'Field changes inside one item'),
        specimen: <TimelineChanges merged />,
      },
      avoid: {
        caption: copy('design.usageVisuals.timeline.changes.avoid', 'One item per changed field'),
        specimen: <TimelineChanges merged={false} />,
      },
    },
  ],
  kanban: [
    {
      id: 'card-is-target',
      title: copy('design.usageVisuals.kanban.card.title', 'The card is the click target'),
      do: {
        caption: copy('design.usageVisuals.kanban.card.do', 'The whole card opens the record'),
        specimen: <KanbanCard withButton={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.kanban.card.avoid', 'A button inside the card'),
        specimen: <KanbanCard withButton />,
      },
    },
  ],
  wizard: [
    {
      id: 'error-step',
      title: copy('design.usageVisuals.wizard.error.title', 'Failed steps are marked'),
      covers: ['Set step state to error for steps that failed validation'],
      do: {
        caption: copy('design.usageVisuals.wizard.error.do', 'The failed step shows an error'),
        specimen: <WizardSteps marked />,
      },
      avoid: {
        caption: copy('design.usageVisuals.wizard.error.avoid', 'The failed step looks done'),
        specimen: <WizardSteps marked={false} />,
      },
    },
  ],
  stack: [
    evenRhythmPair(
      copy('design.usageVisuals.stack.gap.title', 'Gaps from the layout scale'),
      copy('design.usageVisuals.stack.gap.do', 'One gap value down the stack'),
      copy('design.usageVisuals.stack.gap.avoid', 'Margins added block by block'),
      ['Use gap values from the layout scale instead of ad-hoc margins'],
    ),
    {
      id: 'grid-over-nesting',
      title: copy('design.usageVisuals.stack.grid.title', 'A grid instead of deep nesting'),
      covers: ['Do not nest more than two levels when a grid expresses the layout better'],
      do: {
        caption: copy('design.usageVisuals.stack.grid.do', 'Four tiles in one grid'),
        specimen: <GridOrNesting nested={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.stack.grid.avoid', 'Stacks nested three deep'),
        specimen: <GridOrNesting nested />,
      },
    },
  ],
  'bulk-action-bar': [
    {
      id: 'one-floating-bar',
      title: copy('design.usageVisuals.bulkActionBar.single.title', 'One floating bar per page'),
      covers: ['Do not render two floating bars on one page'],
      do: {
        caption: copy('design.usageVisuals.bulkActionBar.single.do', 'A single bar over the list'),
        specimen: <FloatingBars count={1} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.bulkActionBar.single.avoid', 'Two bars stacked at the bottom'),
        specimen: <FloatingBars count={2} />,
      },
    },
  ],
  'form-save-bar': [
    {
      id: 'only-save',
      title: copy('design.usageVisuals.formSaveBar.single.title', 'One Save on the page'),
      covers: ['Use the bar as the only Save on the page; remove the Save button from the header and footer'],
      do: {
        caption: copy('design.usageVisuals.formSaveBar.single.do', 'Save lives in the bar only'),
        specimen: <SavePage headerSave={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.formSaveBar.single.avoid', 'A second Save in the header'),
        specimen: <SavePage headerSave />,
      },
    },
    {
      id: 'no-covered-field',
      title: copy('design.usageVisuals.formSaveBar.spacer.title', 'The bar never covers a field'),
      do: {
        caption: copy('design.usageVisuals.formSaveBar.spacer.do', 'Space left under the last field'),
        specimen: <SaveOverlap covered={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.formSaveBar.spacer.avoid', 'The bar sits on the last field'),
        specimen: <SaveOverlap covered />,
      },
    },
  ],
  'list-toolbar': [
    {
      id: 'create-once',
      title: copy('design.usageVisuals.listToolbar.create.title', 'Create appears once'),
      covers: [
        'Leave primaryAction out when the page title row already has the Create button',
        'Do not repeat the same Create action in the page title row and in the toolbar',
      ],
      do: {
        caption: copy('design.usageVisuals.listToolbar.create.do', 'Create in the title row only'),
        specimen: <ToolbarCreate repeated={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.listToolbar.create.avoid', 'The same Create in both rows'),
        specimen: <ToolbarCreate repeated />,
      },
    },
    {
      id: 'readable-chips',
      title: copy('design.usageVisuals.listToolbar.chips.title', 'Chips people can read'),
      covers: ['Pass chips with labels a person can read, for example "Stage: Negotiation"'],
      do: {
        caption: copy('design.usageVisuals.listToolbar.chips.do', 'Field and value in plain words'),
        specimen: <FilterChip raw={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.listToolbar.chips.avoid', 'A raw key and an id'),
        specimen: <FilterChip raw />,
      },
    },
    {
      id: 'delete-in-menu',
      title: copy('design.usageVisuals.listToolbar.destructive.title', 'Delete stays in the more menu'),
      covers: ['Do not put destructive actions outside the more menu'],
      do: {
        caption: copy('design.usageVisuals.listToolbar.destructive.do', 'Search and a more menu'),
        specimen: <ToolbarActions deleteOutside={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.listToolbar.destructive.avoid', 'Delete out in the toolbar'),
        specimen: <ToolbarActions deleteOutside />,
      },
    },
  ],
}
