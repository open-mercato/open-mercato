import * as React from 'react'
import { RecordList } from '@open-mercato/ui/blocks/record-list'
import { recordListFixtures } from '@open-mercato/ui/blocks/record-list/fixtures'
import { recordListPropsSchema, type RecordListItem } from '@open-mercato/ui/blocks/contracts/record-list'
import { Progress } from '@open-mercato/ui/primitives/progress'
import type { GalleryEntry } from '../types'

const TASK_PROGRESS: Record<string, number> = { 'task-1': 80, 'task-2': 45, 'task-3': 10 }

const taskItems: RecordListItem[] = [
  { id: 'task-1', title: 'Prepare the spring price list', actions: [{ key: 'edit', label: 'Edit', icon: 'pencil-line' }] },
  { id: 'task-2', title: 'Call back about the delayed shipment', actions: [{ key: 'edit', label: 'Edit', icon: 'pencil-line' }] },
  { id: 'task-3', title: 'Review the renewal offer', actions: [{ key: 'edit', label: 'Edit', icon: 'pencil-line' }] },
]

function TaskRow({ item }: { item: RecordListItem }) {
  const value = TASK_PROGRESS[item.id] ?? 0
  return (
    <div className="flex min-h-10 min-w-0 flex-col justify-center gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-foreground">{item.title}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{value}%</span>
      </div>
      <Progress value={value} aria-label={item.title} />
    </div>
  )
}

function CustomRowExample() {
  return (
    <RecordList
      title="Open tasks"
      items={taskItems}
      onItemClick={() => undefined}
      onItemAction={() => undefined}
      renderItem={(item) => <TaskRow item={item} />}
    />
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-2xl">{children}</div>
}

const recordListCode = (props: string) => `import { RecordList } from '@open-mercato/ui/blocks/record-list'

<RecordList
${props}
/>`

export const recordListEntry: GalleryEntry = {
  id: 'record-list',
  title: 'RecordList',
  importPath: '@open-mercato/ui/blocks/record-list',
  contract: {
    schema: recordListPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/record-list',
    implementationPath: '@open-mercato/ui/blocks/record-list/RecordList',
  },
  descriptionKey: 'design_system.entries.record-list.description',
  keywords: ['child records', 'related list', 'recent records', 'linked records', 'people', 'widget list', 'row actions', 'add'],
  usage: {
    do: [
      'Use it for a short list of records inside a detail screen or a dashboard widget: child records, recent records, linked records, people',
      'Format dates, amounts and labels in the host and pass them as strings; subtitle and meta are joined into one muted line',
      'Give a row a leading visual only when it says something: avatarLabel (and avatarUrl) for people and companies, icon when rows are of different types',
      'Pass badge for one status or badges for several; a status is drawn as a dot with text so the title stays the loudest thing in the row',
      'Pass title, or ariaLabel when the surrounding section already shows the heading',
      'Use variant="plain" inside a card, dialog or section that already draws a frame and has at least 8 px of padding',
      'Give every row action an icon from the registry; the first non-destructive action with an icon is shown as an icon button, the rest go to the menu',
      'Pass count with the full total when only the first rows are loaded, so the heading and the Show all row tell the truth',
    ],
    dont: [
      'Do not use it for long, sortable or filterable data; that is a table',
      'Do not give every row the same icon; an icon that repeats on each row says nothing',
      'Do not place the card variant inside another bordered surface',
      'Do not run a destructive row action without a confirmation in onItemAction',
      'Do not repeat the Add action next to an empty list; the empty state already carries it',
      'Do not put interactive controls other than links and buttons into renderItem when the row is clickable',
    ],
  },
  accessibility: [
    'Rows are a real list named by the heading or by ariaLabel',
    'A row that opens a record has one tab stop, the title, whose hit area covers the whole row; a title with href is a real link and opens in a new tab with a modified click',
    'Row actions are separate tab stops after the title and never trigger the row click; they are revealed on hover and on keyboard focus, and stay visible on touch screens and on narrow windows',
    'Icon actions and the menu trigger are named with the action and the record title',
    'A status is text next to a decorative dot, so it never depends on colour alone; badges beyond the third are summed up and listed for screen readers',
    'A blocked Add action stays focusable and is described by its reason; in a narrow block the Add label stays in the accessible name and shows as a tooltip',
    'While loading the block is marked busy and the skeleton is hidden from assistive technology; an error is announced as an alert',
  ],
  faq: [
    {
      question: 'Why is my row action in the menu and not shown as an icon?',
      answer:
        'Only one action per row is shown as an icon button: the first one that is not destructive and has an icon name known to the icon registry. Destructive actions always stay in the menu.',
    },
    {
      question: 'Why does the status move under the title?',
      answer:
        'The block measures its own width, not the window. In a container narrower than 28rem the status drops under the text so the trailing value stays on the title line, and the Add action shows its icon only.',
    },
    {
      question: 'Why are the row actions hidden until I point at a row?',
      answer:
        'A list with an icon button on every row reads as a toolbar. Actions appear on hover and on keyboard focus; on touch screens and below the sm breakpoint they are always visible.',
    },
  ],
  tokens: ['--card', '--border', '--radius-card', '--muted', '--muted-foreground', '--foreground', '--status-success-icon', '--status-info-icon', '--status-error-icon', '--status-neutral-icon', '--shadow-focus'],
  variants: [
    {
      id: 'child-records',
      title: 'Child records with Add and row actions',
      description: 'The whole row opens the record. Edit and the menu with Duplicate and Delete appear when the row is hovered or focused.',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.childRecords} />
        </Frame>
      ),
      code: recordListCode(`  title="Job history"
  count={positions.length}
  items={positions.map((position) => ({
    id: position.id,
    title: position.name,
    subtitle: position.companyName,
    meta: formatDateRange(position),
    actions: [
      { key: 'edit', label: 'Edit', icon: 'pencil-line' },
      { key: 'duplicate', label: 'Duplicate', icon: 'copy' },
      { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' },
    ],
  }))}
  addAction={{ label: 'Add position' }}
  onAdd={openCreateDialog}
  onItemClick={openEditDialog}
  onItemAction={handleItemAction}`),
    },
    {
      id: 'recent-records',
      title: 'Recent records',
      description: 'A status, a date and an amount per row. Titles are links; the chevron shows on hover.',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.recentRecords} />
        </Frame>
      ),
      code: recordListCode(`  title="Recent orders"
  items={orders.map((order) => ({
    id: order.id,
    title: order.number,
    href: orderHref(order),
    badge: { label: order.statusLabel, tone: order.statusTone },
    subtitle: order.customerName,
    meta: formatDate(order.createdAt),
    trailing: formatMoney(order.total),
  }))}`),
    },
    {
      id: 'linked-records',
      title: 'Linked records with unlink',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.linkedRecords} />
        </Frame>
      ),
      code: recordListCode(`  title="Companies"
  count={companies.length}
  items={companies.map((company) => ({
    id: company.id,
    title: company.name,
    href: companyHref(company),
    avatarLabel: company.name,
    avatarUrl: company.logoUrl,
    subtitle: company.roleLabel,
    meta: formatSince(company.linkedAt),
    actions: [{ key: 'unlink', label: 'Unlink', icon: 'minus-circle' }],
  }))}
  addAction={{ label: 'Link company', icon: 'link' }}
  onAdd={openLinkDialog}
  onItemAction={handleItemAction}`),
    },
    {
      id: 'people',
      title: 'People with avatars',
      description: 'avatarLabel draws initials, avatarUrl a photo. Rows without a status keep the same columns.',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.people} />
        </Frame>
      ),
      code: recordListCode(`  title="People"
  count={people.length}
  items={people.map((person) => ({
    id: person.id,
    title: person.displayName,
    href: personHref(person),
    avatarLabel: person.displayName,
    avatarUrl: person.photoUrl,
    subtitle: person.jobTitle,
    meta: person.email,
    badge: person.roleLabel ? { label: person.roleLabel, tone: 'info' } : undefined,
    actions: personActions,
  }))}
  addAction={{ label: 'Add person', icon: 'user-plus' }}
  onAdd={openCreateDialog}
  onItemAction={handleItemAction}`),
    },
    {
      id: 'description-and-badges',
      title: 'With description and several badges',
      description: 'description adds a second muted line clamped to two lines. Up to three badges show; the rest are summed up as a number.',
      render: () => (
        <div className="w-full max-w-4xl">
          <RecordList {...recordListFixtures.descriptionAndBadges} />
        </div>
      ),
      code: recordListCode(`  title="Deals"
  count={deals.length}
  items={deals.map((deal) => ({
    id: deal.id,
    title: deal.title,
    href: dealHref(deal),
    subtitle: deal.companyName,
    meta: formatCloseDate(deal),
    description: deal.summary,
    badges: deal.labels,
    trailing: formatMoney(deal.value),
    actions: dealActions,
  }))}
  onItemAction={handleItemAction}`),
    },
    {
      id: 'cards',
      title: 'Cards layout',
      description: 'Tiles on a muted background without borders inside the one frame, with the same anatomy stacked. The grid follows the width of the block.',
      render: () => (
        <div className="w-full">
          <RecordList {...recordListFixtures.cards} />
        </div>
      ),
      code: recordListCode(`  title="Deals"
  layout="cards"
  items={items}
  onItemAction={handleItemAction}`),
    },
    {
      id: 'compact',
      title: 'Compact density',
      description: 'One line per row: subtitle and meta follow the title in muted.',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.compact} />
        </Frame>
      ),
      code: recordListCode(`  title="Recent orders"
  density="compact"
  items={items}`),
    },
    {
      id: 'custom-row',
      title: 'Custom row',
      description: 'renderItem replaces the row body. The block keeps the row, its click target, the actions and the chevron.',
      render: () => (
        <Frame>
          <CustomRowExample />
        </Frame>
      ),
      code: recordListCode(`  title="Open tasks"
  items={tasks}
  onItemClick={openTask}
  onItemAction={handleItemAction}
  renderItem={(item) => <TaskRow item={item} />}`),
    },
    {
      id: 'capped',
      title: 'Capped with Show all',
      description: 'count carries the full total; onShowAll opens the full list. Without onShowAll the rest expands in place.',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.capped} />
        </Frame>
      ),
      code: recordListCode(`  title="Recent orders"
  count={28}
  items={items}
  maxItems={3}
  onShowAll={openOrdersList}`),
    },
    {
      id: 'plain',
      title: 'Plain variant',
      description: 'No frame, no dividers and no side padding, for a section that already has a frame. The hover background reaches 8 px into the padding of the host.',
      render: () => (
        <Frame>
          <div className="px-2">
            <RecordList {...recordListFixtures.plain} />
          </div>
        </Frame>
      ),
      code: recordListCode(`  ariaLabel="Job history"
  variant="plain"
  items={items}
  onItemClick={openEditDialog}
  onItemAction={handleItemAction}`),
    },
    {
      id: 'long-content',
      title: 'Long titles and narrow width',
      description: 'The title truncates, the trailing value stays on the title line and the status sits under the text when the block is narrow.',
      render: () => (
        <div className="w-full max-w-md">
          <RecordList {...recordListFixtures.longContent} />
        </div>
      ),
      code: recordListCode(`  title="Claims queue"
  items={claims}
  onItemClick={openClaim}
  onItemAction={handleItemAction}`),
    },
    {
      id: 'loading',
      title: 'Loading',
      description: 'The skeleton mirrors the rows: skeleton.leading picks the leading visual, skeleton.rows the number of rows.',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.loading} />
        </Frame>
      ),
      code: recordListCode(`  title="People"
  status="loading"
  skeleton={{ rows: 4, leading: 'avatar' }}
  items={[]}`),
    },
    {
      id: 'error',
      title: 'Error with retry',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.error} />
        </Frame>
      ),
      code: recordListCode(`  title="Job history"
  status="error"
  errorMessage={t(keys.loadError)}
  onRetry={reload}
  items={[]}`),
    },
    {
      id: 'empty',
      title: 'Empty with the Add action',
      description: 'The Add action moves from the header into the empty state, so it shows once.',
      render: () => (
        <Frame>
          <RecordList {...recordListFixtures.empty} />
        </Frame>
      ),
      code: recordListCode(`  title="Job history"
  items={[]}
  emptyIcon="briefcase"
  emptyTitle={t(keys.emptyTitle)}
  emptyDescription={t(keys.emptyDescription)}
  addAction={{ label: 'Add position' }}
  onAdd={openCreateDialog}`),
    },
  ],
}
