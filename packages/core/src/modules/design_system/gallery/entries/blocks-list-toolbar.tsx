import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { ListToolbar } from '@open-mercato/ui/blocks/list-toolbar'
import { listToolbarFixtures } from '@open-mercato/ui/blocks/list-toolbar/fixtures'
import { listToolbarPropsSchema, type ListToolbarProps } from '@open-mercato/ui/blocks/contracts/list-toolbar'
import type { GalleryEntry } from '../types'

const SAMPLE_ROWS = [
  'Northwind Supplies renewal',
  'Harbor Street Bakery onboarding',
  'Lindqvist Studio expansion',
  'Greenfield Logistics pilot',
  'Atlas Print annual contract',
  'Juniper Dental equipment',
  'Riverside Market wholesale',
  'Polar Bikes service plan',
  'Meadow Hotels linen supply',
  'Cobalt Labs starter pack',
  'Sunrise Clinics framework',
  'Marble Arch Catering upgrade',
]

function ListToolbarExample({ fixture }: { fixture: ListToolbarProps }) {
  const [searchValue, setSearchValue] = React.useState(fixture.search?.value ?? '')
  const [quickFilters, setQuickFilters] = React.useState(fixture.quickFilters)
  const [chips, setChips] = React.useState(fixture.chips)
  const [activeViewId, setActiveViewId] = React.useState(fixture.activeViewId)
  return (
    <ListToolbar
      {...fixture}
      search={fixture.search ? { ...fixture.search, value: searchValue } : undefined}
      onSearchChange={fixture.search ? setSearchValue : undefined}
      quickFilters={quickFilters}
      onQuickFilterToggle={(id, next) =>
        setQuickFilters((current) =>
          current?.map((filter) => (filter.id === id ? { ...filter, active: next } : filter)),
        )
      }
      chips={chips}
      filtersActiveCount={fixture.filtersActiveCount === undefined ? undefined : chips?.length ?? 0}
      onChipRemove={fixture.onChipRemove ? (id) => setChips((current) => current?.filter((chip) => chip.id !== id)) : undefined}
      onClearAll={fixture.onClearAll ? () => setChips([]) : undefined}
      activeViewId={activeViewId}
      onViewChange={fixture.views ? setActiveViewId : undefined}
    />
  )
}

function StickyListToolbarExample() {
  return (
    <div className="h-72 overflow-y-auto rounded-md border border-border bg-background px-4 pb-4">
      <ListToolbarExample fixture={listToolbarFixtures.sticky} />
      <ul className="divide-y divide-border">
        {SAMPLE_ROWS.map((row) => (
          <li key={row} className="py-3 text-sm text-foreground">
            {row}
          </li>
        ))}
      </ul>
    </div>
  )
}

type FilterBarControl = { id: string; label: string; options: string[] }

const FILTER_BAR_CONTROLS: FilterBarControl[] = [
  { id: 'stage', label: 'Stage', options: ['Qualification', 'Proposal', 'Negotiation'] },
  { id: 'owner', label: 'Owner', options: ['Maria Lindqvist', 'Tomas Berg', 'Unassigned'] },
  { id: 'close', label: 'Close date', options: ['This month', 'Next month', 'This quarter'] },
]

type FilterOptionsProps = { control: FilterBarControl; value: string | undefined; onPick: (value: string) => void }

function FilterOptions({ control, value, onPick }: FilterOptionsProps) {
  return (
    <div role="group" aria-label={control.label} className="flex flex-col gap-1">
      {control.options.map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={option === value ? 'secondary' : 'ghost'}
          aria-pressed={option === value}
          className="h-10 justify-start font-normal md:h-8"
          onClick={() => onPick(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  )
}

type FilterBarButtonProps = { control: FilterBarControl; value: string | undefined; onPick: (value: string) => void }

function FilterBarButton({ control, value, onPick }: FilterBarButtonProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-10 font-normal md:h-8">
          {control.label}
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <FilterOptions
          control={control}
          value={value}
          onPick={(next) => {
            onPick(next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

type ChipEditor = { id: string; anchor: HTMLElement | null }

function FilterBarListToolbarExample() {
  const [searchValue, setSearchValue] = React.useState('')
  const [values, setValues] = React.useState<Record<string, string>>({ stage: 'Negotiation', owner: 'Maria Lindqvist' })
  const [editor, setEditor] = React.useState<ChipEditor | null>(null)
  const pick = (id: string, value: string) => setValues((current) => ({ ...current, [id]: value }))
  const chips = FILTER_BAR_CONTROLS.filter((control) => values[control.id] !== undefined).map((control) => ({
    id: control.id,
    label: `${control.label}: ${values[control.id]}`,
  }))
  const editedControl = FILTER_BAR_CONTROLS.find((control) => control.id === editor?.id)
  return (
    <>
      <ListToolbar
        search={{ value: searchValue, placeholder: 'Search deals' }}
        onSearchChange={setSearchValue}
        filterBar={FILTER_BAR_CONTROLS.map((control) => (
          <FilterBarButton
            key={control.id}
            control={control}
            value={values[control.id]}
            onPick={(value) => pick(control.id, value)}
          />
        ))}
        chips={chips}
        onChipOpen={(id, anchor) => setEditor({ id, anchor })}
        onChipRemove={(id) =>
          setValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))
        }
        onClearAll={() => setValues({})}
        resultSummary="128 results"
      />
      <Popover open={editor !== null && editedControl !== undefined} onOpenChange={(open) => (open ? undefined : setEditor(null))}>
        <PopoverAnchor virtualRef={{ current: editor?.anchor ?? null }} />
        <PopoverContent align="start" className="w-56 p-2">
          {editedControl ? (
            <FilterOptions
              control={editedControl}
              value={values[editedControl.id]}
              onPick={(value) => {
                pick(editedControl.id, value)
                setEditor(null)
              }}
            />
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  )
}

const listToolbarCode = (props: string) => `import { ListToolbar } from '@open-mercato/ui/blocks/list-toolbar'

<ListToolbar
${props}
/>`

export const listToolbarEntry: GalleryEntry = {
  id: 'list-toolbar',
  title: 'ListToolbar',
  importPath: '@open-mercato/ui/blocks/list-toolbar',
  contract: {
    schema: listToolbarPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/list-toolbar',
    implementationPath: '@open-mercato/ui/blocks/list-toolbar/ListToolbar',
  },
  descriptionKey: 'design_system.entries.list-toolbar.description',
  keywords: ['search', 'filters', 'chips', 'view switch', 'table', 'list', 'toolbar'],
  usage: {
    do: [
      'Keep the applied search value, filters and active view in the page and pass them in as props',
      'Pass chips with labels a person can read, for example "Stage: Negotiation"',
      'Use onOpenFilters to anchor your own filter panel to the button element it hands you',
      'Give a view an href when it has its own address so it can open in a new tab',
      'Leave primaryAction out when the page title row already has the Create button',
      'Give an action an href when it leads to its own address, for example the create page; a plain click is still handed to onAction',
      'Use filterBar for filter controls that open their own popovers; it gets a full-width row under the search row',
      'Use the element handed to onChipOpen as the second argument to anchor the editor of that filter to its chip',
    ],
    dont: [
      'Do not fetch or filter records inside the block',
      'Do not repeat the same Create action in the page title row and in the toolbar',
      'Do not put destructive actions outside the more menu',
      'Do not use sticky inside a container that hides overflow without scrolling',
    ],
  },
  accessibility: [
    'The bar has the toolbar role and a label; pass ariaLabel when a page has more than one',
    'The search field is labelled; Enter applies the query at once and the clear button returns focus to the field',
    'Quick filters are toggle buttons that expose their state with aria-pressed',
    'The view switch is a labelled group; views with an href are real links and mark the active one with aria-current',
    'Each applied filter has a remove button named after the filter, and "+N more" exposes aria-expanded',
    'On phones the Filters button and the view switch show icons only and keep their accessible names',
    'Actions with an href are real links styled as buttons; a plain click calls onAction, and clicks with Ctrl, Cmd, Shift, Alt or the middle button open the address in the browser',
    'The filterBar row is part of the toolbar; give every control in it its own accessible name',
  ],
  variants: [
    {
      id: 'search-only',
      title: 'Search only',
      render: () => <ListToolbarExample fixture={listToolbarFixtures.searchOnly} />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}`),
    },
    {
      id: 'search-with-quick-filters',
      title: 'Search with quick filters',
      render: () => <ListToolbarExample fixture={listToolbarFixtures.searchWithQuickFilters} />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}
  quickFilters={[
    { id: 'mine', label: 'My deals', icon: 'user', active: true, count: 12 },
    { id: 'open', label: 'Open', active: false, count: 48 },
    { id: 'closing', label: 'Closing this month', icon: 'calendar', active: false, count: 7 },
  ]}
  onQuickFilterToggle={(id, next) => toggleQuickFilter(id, next)}`),
    },
    {
      id: 'applied-filters',
      title: 'With applied filters',
      render: () => <ListToolbarExample fixture={listToolbarFixtures.appliedFilters} />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}
  filtersActiveCount={chips.length}
  onOpenFilters={(anchor) => openFilterPanel(anchor)}
  chips={[
    { id: 'stage', label: 'Stage: Negotiation' },
    { id: 'owner', label: 'Owner: Maria Lindqvist' },
    { id: 'value', label: 'Value: over 10,000' },
    { id: 'region', label: 'Region: North' },
  ]}
  onChipOpen={(id) => editFilter(id)}
  onChipRemove={(id) => removeFilter(id)}
  onAddFilter={() => openFilterPanel(null)}
  onClearAll={clearFilters}`),
    },
    {
      id: 'many-applied-filters',
      title: 'Many applied filters',
      render: () => <ListToolbarExample fixture={listToolbarFixtures.manyAppliedFilters} />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}
  filtersActiveCount={chips.length}
  onOpenFilters={(anchor) => openFilterPanel(anchor)}
  chips={chips}
  maxVisibleChips={6}
  onChipOpen={(id) => editFilter(id)}
  onChipRemove={(id) => removeFilter(id)}
  onAddFilter={() => openFilterPanel(null)}
  onClearAll={clearFilters}`),
    },
    {
      id: 'view-switch',
      title: 'With view switch',
      render: () => <ListToolbarExample fixture={listToolbarFixtures.viewSwitch} />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}
  views={[
    { id: 'table', label: 'Table', icon: 'rows' },
    { id: 'board', label: 'Board', icon: 'grid-3x3' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  ]}
  activeViewId={view}
  onViewChange={setView}`),
    },
    {
      id: 'with-actions',
      title: 'With actions',
      render: () => <ListToolbarExample fixture={listToolbarFixtures.withLinkActions} />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}
  primaryAction={{ key: 'create', label: 'New deal', icon: 'plus-square', href: '/backend/deals/create' }}
  secondaryActions={[
    { key: 'import', label: 'Import', icon: 'file-spreadsheet', href: '/backend/deals/import' },
    { key: 'export', label: 'Export', icon: 'download' },
    { key: 'columns', label: 'Edit columns', icon: 'settings' },
  ]}
  onAction={(key) => (key === 'create' ? router.push('/backend/deals/create') : runAction(key))}`),
    },
    {
      id: 'filter-bar',
      title: 'With filter bar',
      render: () => <FilterBarListToolbarExample />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}
  filterBar={
    <>
      <StageFilter value={filters.stage} onChange={setStage} />
      <OwnerFilter value={filters.owner} onChange={setOwner} />
      <CloseDateFilter value={filters.closeDate} onChange={setCloseDate} />
    </>
  }
  chips={chips}
  onChipOpen={(id, anchor) => openFilterEditor(id, anchor)}
  onChipRemove={(id) => removeFilter(id)}
  onClearAll={clearFilters}
  resultSummary={t(keys.resultCount, { count: total })}`),
    },
    {
      id: 'full',
      title: 'Full',
      render: () => <ListToolbarExample fixture={listToolbarFixtures.full} />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}
  quickFilters={quickFilters}
  onQuickFilterToggle={(id, next) => toggleQuickFilter(id, next)}
  filtersActiveCount={chips.length}
  onOpenFilters={(anchor) => openFilterPanel(anchor)}
  chips={chips}
  onChipOpen={(id) => editFilter(id)}
  onChipRemove={(id) => removeFilter(id)}
  onAddFilter={() => openFilterPanel(null)}
  onClearAll={clearFilters}
  views={views}
  activeViewId={view}
  onViewChange={setView}
  primaryAction={{ key: 'create', label: 'New deal', icon: 'plus-square' }}
  secondaryActions={secondaryActions}
  onAction={(key) => runAction(key)}
  resultSummary={t(keys.resultCount, { count: total })}`),
    },
    {
      id: 'busy',
      title: 'Busy',
      render: () => <ListToolbarExample fixture={listToolbarFixtures.busy} />,
      code: listToolbarCode(`  search={{ value: query, placeholder: 'Search deals' }}
  onSearchChange={setQuery}
  quickFilters={quickFilters}
  onQuickFilterToggle={(id, next) => toggleQuickFilter(id, next)}
  resultSummary={t(keys.resultCount, { count: total })}
  busy={isFetching}`),
    },
    {
      id: 'loading',
      title: 'Loading',
      render: () => <ListToolbar {...listToolbarFixtures.loading} />,
      code: listToolbarCode(`  status="loading"`),
    },
    {
      id: 'sticky',
      title: 'Sticky',
      render: () => <StickyListToolbarExample />,
      code: `import { ListToolbar } from '@open-mercato/ui/blocks/list-toolbar'

<div className="h-72 overflow-y-auto">
  <ListToolbar
    search={{ value: query, placeholder: 'Search deals' }}
    onSearchChange={setQuery}
    quickFilters={quickFilters}
    onQuickFilterToggle={(id, next) => toggleQuickFilter(id, next)}
    onOpenFilters={(anchor) => openFilterPanel(anchor)}
    resultSummary={t(keys.resultCount, { count: total })}
    sticky="top"
    stickyOffset="0px"
  />
  <DealRows />
</div>`,
    },
  ],
}
