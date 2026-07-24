import * as React from 'react'
import { Download } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  FilterBar,
  type FilterDef,
  type FilterValues,
} from '@open-mercato/ui/backend/FilterBar'
import { QuickFilters, type FilterPreset } from '@open-mercato/ui/backend/filters/QuickFilters'
import { ActiveFilterChips } from '@open-mercato/ui/backend/filters/ActiveFilterChips'
import { AdvancedFilterBuilder } from '@open-mercato/ui/backend/filters/AdvancedFilterBuilder'
import { FilterEmptyState } from '@open-mercato/ui/backend/filters/FilterEmptyState'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { FilteredEmptyResults } from '@open-mercato/ui/backend/filters/FilteredEmptyResults'
import { SearchEmptyResults } from '@open-mercato/ui/backend/filters/SearchEmptyResults'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'
import type {
  AdvancedFilterTree,
  FilterGroup,
  FilterRule,
} from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.
//
// AdvancedFilterPanel itself is not showcased: it is a popover host that
// orchestrates open/anchor state and saved-filter persistence. Its
// presentational subcomponents (AdvancedFilterBuilder, QuickFilters,
// FilterEmptyState) are shown standalone below with variant titles noting it.

// ---------------------------------------------------------------------------
// Inline demo data — no API calls. Field defs and trees mirror what CRM list
// pages pass to the advanced filter stack.
// ---------------------------------------------------------------------------

const demoFilterDefs: FilterDef[] = [
  { id: 'city', label: 'City', type: 'text', placeholder: 'e.g. Berlin' },
  {
    id: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'prospect', label: 'Prospect' },
      { value: 'churned', label: 'Churned' },
    ],
  },
  { id: 'hasOpenDeals', label: 'Has open deals', type: 'checkbox' },
]

const demoFields: FilterFieldDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'active', label: 'Active', tone: 'success' },
      { value: 'prospect', label: 'Prospect', tone: 'info' },
      { value: 'churned', label: 'Churned', tone: 'error' },
    ],
  },
  { key: 'employees', label: 'Employees', type: 'number' },
]

function rule(id: string, field: string, operator: FilterRule['operator'], value: unknown): FilterRule {
  return { id, type: 'rule', field, operator, value }
}

function tree(children: FilterGroup['children']): AdvancedFilterTree {
  return { root: { id: 'root', type: 'group', combinator: 'and', children } }
}

const ruleChipsTree = tree([
  rule('r1', 'name', 'contains', 'north'),
  rule('r2', 'status', 'is', 'active'),
  rule('r3', 'employees', 'between', [10, 50]),
])

const groupChipTree = tree([
  {
    id: 'g1',
    type: 'group',
    combinator: 'or',
    children: [
      rule('g1r1', 'status', 'is', 'prospect'),
      rule('g1r2', 'status', 'is', 'churned'),
    ],
  },
])

const valuelessChipTree = tree([rule('r4', 'email', 'is_empty', null)])

const builderSingleRuleTree = tree([rule('b1', 'status', 'is', 'active')])

const builderNestedTree = tree([
  rule('b2', 'name', 'contains', 'north'),
  {
    id: 'bg1',
    type: 'group',
    combinator: 'or',
    children: [
      rule('bg1r1', 'status', 'is', 'prospect'),
      rule('bg1r2', 'employees', 'greater_than', 100),
    ],
  },
])

const demoPresets: FilterPreset[] = [
  {
    id: 'active-accounts',
    labelKey: 'Active accounts',
    iconName: 'filter',
    build: () => tree([rule('p1', 'status', 'is', 'active')]),
  },
  {
    id: 'added-this-week',
    labelKey: 'Added this week',
    iconName: 'clock',
    build: () => tree([rule('p2', 'name', 'is_not_empty', null)]),
  },
]

const userScopedPresets: FilterPreset[] = [
  ...demoPresets,
  {
    id: 'my-accounts',
    labelKey: 'My accounts',
    requiresUser: true,
    build: ({ userId }) => tree([rule('p3', 'name', 'contains', userId)]),
  },
]

// ---------------------------------------------------------------------------
// Demo wrappers — controlled components need local state to be interactive in
// the gallery. The `code` snippets show the essential consumer usage, not
// these wrappers.
// ---------------------------------------------------------------------------

function DemoFilterBar({
  layout,
  trailingItems,
}: {
  layout?: 'stacked' | 'inline'
  trailingItems?: React.ReactNode
}) {
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({ status: 'active' })
  return (
    <div className="w-full max-w-2xl">
      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        filters={demoFilterDefs}
        values={values}
        onApply={setValues}
        onClear={() => setValues({})}
        layout={layout}
        trailingItems={trailingItems}
      />
    </div>
  )
}

function DemoActiveFilterChips({ initialTree }: { initialTree: AdvancedFilterTree }) {
  const [value, setValue] = React.useState(initialTree)
  const removeNode = (id: string) =>
    setValue((prev) => ({
      root: { ...prev.root, children: prev.root.children.filter((child) => child.id !== id) },
    }))
  return (
    <div className="w-full max-w-2xl">
      <ActiveFilterChips
        tree={value}
        fields={demoFields}
        popoverOpen={false}
        onRemoveNode={removeNode}
        onOpen={() => {}}
      />
    </div>
  )
}

function DemoAdvancedFilterBuilder({ initialTree }: { initialTree: AdvancedFilterTree }) {
  const [value, setValue] = React.useState(initialTree)
  return (
    <div className="w-full max-w-2xl rounded-lg border bg-popover p-3">
      <AdvancedFilterBuilder
        fields={demoFields}
        value={value}
        onChange={setValue}
        onApply={() => {}}
        onClear={() => setValue(tree([]))}
      />
    </div>
  )
}

function DemoFilterEmptyState({ withQuickFilters }: { withQuickFilters?: boolean }) {
  const addConditionRef = React.useRef<HTMLButtonElement | null>(null)
  return (
    <div className="w-full max-w-xl rounded-lg border bg-popover">
      <FilterEmptyState
        onAddCondition={() => {}}
        addConditionRef={addConditionRef}
        quickFilters={
          withQuickFilters ? (
            <QuickFilters presets={demoPresets} userId="user-1" onApply={() => {}} />
          ) : undefined
        }
      />
    </div>
  )
}

const filterBarEntry: GalleryEntry = {
  id: 'filter-bar',
  title: 'FilterBar',
  importPath: '@open-mercato/ui/backend/FilterBar',
  variants: [
    {
      id: 'stacked',
      title: 'Stacked (default)',
      render: () => <DemoFilterBar />,
      code: `import { FilterBar, type FilterDef, type FilterValues } from '@open-mercato/ui/backend/FilterBar'

const filters: FilterDef[] = [
  { id: 'city', label: 'City', type: 'text' },
  { id: 'status', label: 'Status', type: 'select', options: statusOptions },
  { id: 'hasOpenDeals', label: 'Has open deals', type: 'checkbox' },
]

<FilterBar
  searchValue={search}
  onSearchChange={setSearch}
  filters={filters}
  values={values}
  onApply={setValues}
  onClear={() => setValues({})}
/>`,
    },
    {
      id: 'inline',
      title: 'Inline layout',
      render: () => <DemoFilterBar layout="inline" />,
      code: `import { FilterBar } from '@open-mercato/ui/backend/FilterBar'

<FilterBar
  searchValue={search}
  onSearchChange={setSearch}
  filters={filters}
  values={values}
  onApply={setValues}
  layout="inline"
/>`,
    },
    {
      id: 'trailing-items',
      title: 'With trailing items',
      render: () => (
        <DemoFilterBar
          trailingItems={
            <Button variant="outline" size="sm">
              <Download />
              Export
            </Button>
          }
        />
      ),
      code: `import { Download } from 'lucide-react'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'

<FilterBar
  searchValue={search}
  onSearchChange={setSearch}
  filters={filters}
  values={values}
  onApply={setValues}
  trailingItems={<Button variant="outline" size="sm"><Download />Export</Button>}
/>`,
    },
  ],
}

const quickFiltersEntry: GalleryEntry = {
  id: 'quick-filters',
  title: 'QuickFilters',
  importPath: '@open-mercato/ui/backend/filters/QuickFilters',
  variants: [
    {
      id: 'presets',
      title: 'Presets (used inside AdvancedFilterPanel)',
      render: () => (
        <div className="w-full max-w-xl">
          <QuickFilters presets={demoPresets} userId="user-1" onApply={() => {}} />
        </div>
      ),
      code: `import { QuickFilters, type FilterPreset } from '@open-mercato/ui/backend/filters/QuickFilters'

const presets: FilterPreset[] = [
  { id: 'active-accounts', labelKey: 'customers.filters.activeAccounts', iconName: 'filter', build: () => activeTree },
  { id: 'added-this-week', labelKey: 'customers.filters.addedThisWeek', iconName: 'clock', build: () => recentTree },
]

<QuickFilters presets={presets} userId={userId} onApply={(tree, preset) => applyTree(tree)} />`,
    },
    {
      id: 'user-scoped',
      title: 'User-scoped preset (hidden without userId)',
      render: () => (
        <div className="flex w-full max-w-xl flex-col gap-6">
          <QuickFilters presets={userScopedPresets} userId="user-1" onApply={() => {}} />
          <QuickFilters presets={userScopedPresets} userId="" onApply={() => {}} />
        </div>
      ),
      code: `import { QuickFilters } from '@open-mercato/ui/backend/filters/QuickFilters'

// Presets with requiresUser: true are hidden when userId is empty.
<QuickFilters presets={presets} userId={userId} onApply={applyTree} />`,
    },
  ],
}

const activeFilterChipsEntry: GalleryEntry = {
  id: 'active-filter-chips',
  title: 'ActiveFilterChips',
  importPath: '@open-mercato/ui/backend/filters/ActiveFilterChips',
  variants: [
    {
      id: 'rule-chips',
      title: 'Rule chips (text, toned select, range)',
      render: () => <DemoActiveFilterChips initialTree={ruleChipsTree} />,
      code: `import { ActiveFilterChips } from '@open-mercato/ui/backend/filters/ActiveFilterChips'

<ActiveFilterChips
  tree={tree}
  fields={fields}
  popoverOpen={panelOpen}
  onRemoveNode={(id) => dispatch({ type: 'removeNode', id })}
  onOpen={(focusNodeId) => setPanelOpen(true)}
/>`,
    },
    {
      id: 'group-chip',
      title: 'Group chip (first rule +N)',
      render: () => <DemoActiveFilterChips initialTree={groupChipTree} />,
      code: `import { ActiveFilterChips } from '@open-mercato/ui/backend/filters/ActiveFilterChips'

// An OR group renders as a single chip: "Status: Prospect +1".
<ActiveFilterChips tree={tree} fields={fields} popoverOpen={false} onRemoveNode={removeNode} onOpen={openPanel} />`,
    },
    {
      id: 'valueless-operator',
      title: 'Valueless operator chip',
      render: () => <DemoActiveFilterChips initialTree={valuelessChipTree} />,
      code: `import { ActiveFilterChips } from '@open-mercato/ui/backend/filters/ActiveFilterChips'

// Valueless operators read as a phrase: "Email is empty".
<ActiveFilterChips tree={tree} fields={fields} popoverOpen={false} onRemoveNode={removeNode} onOpen={openPanel} />`,
    },
  ],
}

const advancedFilterBuilderEntry: GalleryEntry = {
  id: 'advanced-filter-builder',
  title: 'AdvancedFilterBuilder',
  importPath: '@open-mercato/ui/backend/filters/AdvancedFilterBuilder',
  variants: [
    {
      id: 'single-rule',
      title: 'Single rule (presentational core of AdvancedFilterPanel)',
      render: () => <DemoAdvancedFilterBuilder initialTree={builderSingleRuleTree} />,
      code: `import { AdvancedFilterBuilder } from '@open-mercato/ui/backend/filters/AdvancedFilterBuilder'

<AdvancedFilterBuilder
  fields={fields}
  value={tree}
  onChange={setTree}
  onApply={applyFilters}
  onClear={clearFilters}
/>`,
    },
    {
      id: 'nested-group',
      title: 'Rule with nested OR group',
      render: () => <DemoAdvancedFilterBuilder initialTree={builderNestedTree} />,
      code: `import { AdvancedFilterBuilder } from '@open-mercato/ui/backend/filters/AdvancedFilterBuilder'

// Groups nest up to 3 levels; the value is a plain AdvancedFilterTree.
<AdvancedFilterBuilder fields={fields} value={tree} onChange={setTree} onApply={applyFilters} onClear={clearFilters} />`,
    },
  ],
}

const filterEmptyStateEntry: GalleryEntry = {
  id: 'filter-empty-state',
  title: 'FilterEmptyState',
  importPath: '@open-mercato/ui/backend/filters/FilterEmptyState',
  variants: [
    {
      id: 'default',
      title: 'Default (panel empty state of AdvancedFilterPanel)',
      render: () => <DemoFilterEmptyState />,
      code: `import { FilterEmptyState } from '@open-mercato/ui/backend/filters/FilterEmptyState'

<FilterEmptyState onAddCondition={openFieldPicker} addConditionRef={addConditionRef} />`,
    },
    {
      id: 'with-quick-filters',
      title: 'With quick filters slot',
      render: () => <DemoFilterEmptyState withQuickFilters />,
      code: `import { FilterEmptyState } from '@open-mercato/ui/backend/filters/FilterEmptyState'
import { QuickFilters } from '@open-mercato/ui/backend/filters/QuickFilters'

<FilterEmptyState
  onAddCondition={openFieldPicker}
  addConditionRef={addConditionRef}
  quickFilters={<QuickFilters presets={presets} userId={userId} onApply={applyTree} />}
/>`,
    },
  ],
}

const listEmptyStateEntry: GalleryEntry = {
  id: 'list-empty-state',
  title: 'ListEmptyState',
  importPath: '@open-mercato/ui/backend/filters/ListEmptyState',
  variants: [
    {
      id: 'with-create-action',
      title: 'With create action',
      render: () => (
        <div className="w-full max-w-xl">
          <ListEmptyState entityName="companies" onCreate={() => {}} createLabel="Add company" />
        </div>
      ),
      code: `import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'

// Pass to DataTable's emptyState for the zero-records case.
<ListEmptyState entityName="companies" createHref="/backend/customers/companies/create" createLabel="Add company" />`,
    },
    {
      id: 'custom-copy',
      title: 'Custom title and description',
      render: () => (
        <div className="w-full max-w-xl">
          <ListEmptyState
            title="No imports yet"
            description="Connect a source or upload a CSV file to bring records in."
          />
        </div>
      ),
      code: `import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'

<ListEmptyState
  title="No imports yet"
  description="Connect a source or upload a CSV file to bring records in."
/>`,
    },
  ],
}

const filteredEmptyResultsEntry: GalleryEntry = {
  id: 'filtered-empty-results',
  title: 'FilteredEmptyResults',
  importPath: '@open-mercato/ui/backend/filters/FilteredEmptyResults',
  variants: [
    {
      id: 'filters-only',
      title: 'Filters active',
      render: () => (
        <div className="w-full max-w-xl">
          <FilteredEmptyResults
            entityNamePlural="companies"
            canRemoveLast
            onClearAll={() => {}}
            onRemoveLast={() => {}}
          />
        </div>
      ),
      code: `import { FilteredEmptyResults } from '@open-mercato/ui/backend/filters/FilteredEmptyResults'

// DataTable renders this automatically when filters match nothing.
<FilteredEmptyResults
  entityNamePlural="companies"
  canRemoveLast={tree.root.children.length > 0}
  onClearAll={clearFilters}
  onRemoveLast={removeLastFilter}
/>`,
    },
    {
      id: 'with-search',
      title: 'Search and filters active',
      render: () => (
        <div className="w-full max-w-xl">
          <FilteredEmptyResults
            entityNamePlural="companies"
            canRemoveLast
            onClearAll={() => {}}
            onRemoveLast={() => {}}
            onClearSearch={() => {}}
          />
        </div>
      ),
      code: `import { FilteredEmptyResults } from '@open-mercato/ui/backend/filters/FilteredEmptyResults'

// Passing onClearSearch switches to combined copy and clears both at once.
<FilteredEmptyResults
  entityNamePlural="companies"
  canRemoveLast
  onClearAll={clearFilters}
  onRemoveLast={removeLastFilter}
  onClearSearch={clearSearch}
/>`,
    },
  ],
}

const searchEmptyResultsEntry: GalleryEntry = {
  id: 'search-empty-results',
  title: 'SearchEmptyResults',
  importPath: '@open-mercato/ui/backend/filters/SearchEmptyResults',
  variants: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <div className="flex w-full max-w-xl justify-center">
          <SearchEmptyResults query="northwind" onClearSearch={() => {}} />
        </div>
      ),
      code: `import { SearchEmptyResults } from '@open-mercato/ui/backend/filters/SearchEmptyResults'

// DataTable renders this automatically when a search matches nothing.
<SearchEmptyResults query={search} onClearSearch={() => setSearch('')} />`,
    },
    {
      id: 'with-entity',
      title: 'With entity label',
      render: () => (
        <div className="flex w-full max-w-xl justify-center">
          <SearchEmptyResults
            query="northwind"
            entityNamePlural="companies"
            onClearSearch={() => {}}
          />
        </div>
      ),
      code: `import { SearchEmptyResults } from '@open-mercato/ui/backend/filters/SearchEmptyResults'

<SearchEmptyResults query={search} entityNamePlural="companies" onClearSearch={() => setSearch('')} />`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  filterBarEntry,
  quickFiltersEntry,
  activeFilterChipsEntry,
  advancedFilterBuilderEntry,
  filterEmptyStateEntry,
  listEmptyStateEntry,
  filteredEmptyResultsEntry,
  searchEmptyResultsEntry,
]
