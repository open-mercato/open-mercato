type RecordListCodeOptions = {
  query?: string
  chips?: boolean
  selected?: boolean
  empty?: boolean
}

export function recordListCode({ query = '', chips = false, selected = false, empty = false }: RecordListCodeOptions = {}): string {
  const emptyImport = empty ? `import { Button } from '@open-mercato/ui/primitives/button'\nimport { EmptyState } from '@open-mercato/ui/primitives/empty-state'\n` : ''
  const chipState = chips ? `['priority-high', 'due-soon']` : '[]'
  const selectionState = selected ? `['req-1041', 'req-1038']` : '[]'
  const emptyBranch = empty
    ? `      {visible.length === 0 ? (
        <EmptyState title="No requests match" description="Try another search term or remove a filter."
          actions={<Button variant="outline" size="sm" onClick={() => { setQuery(''); setChipIds([]) }}>Clear search and filters</Button>} />
      ) : (
        <RequestsTable rows={visible} selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
      )}`
    : `      <RequestsTable rows={visible} selectedIds={selectedIds} onSelectionChange={setSelectedIds} />`
  return `import * as React from 'react'
import { BulkActionBar } from '@open-mercato/ui/blocks/bulk-action-bar'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { ListToolbar } from '@open-mercato/ui/blocks/list-toolbar'
${emptyImport}import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'

const chipLabels = { 'priority-high': 'Priority: High', 'due-soon': 'Due: this week' }

function RequestsTable({ rows, selectedIds, onSelectionChange }) {
  const toggle = (id, next) => onSelectionChange(next ? [...selectedIds, id] : selectedIds.filter((rowId) => rowId !== id))
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <Table aria-label="Service requests">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox aria-label="Select all requests" checked={selectedIds.length === rows.length}
                onCheckedChange={(next) => onSelectionChange(next === true ? rows.map((row) => row.id) : [])} />
            </TableHead>
            <TableHead>Request</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell><Checkbox aria-label={\`Select \${row.title}\`} checked={selectedIds.includes(row.id)} onCheckedChange={(next) => toggle(row.id, next === true)} /></TableCell>
              <TableCell>{row.title}</TableCell>
              <TableCell>{row.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ServiceRequestsPage({ initialRequests }) {
  const [requests, setRequests] = React.useState(initialRequests)
  const [query, setQuery] = React.useState('${query}')
  const [onlyMine, setOnlyMine] = React.useState(false)
  const [chipIds, setChipIds] = React.useState(${chipState})
  const [view, setView] = React.useState('table')
  const [selectedIds, setSelectedIds] = React.useState(${selectionState})
  const visible = filterRequests(requests, { query, onlyMine, chipIds })
  const runBulkAction = async (actionKey) => {
    setRequests(await applyBulkAction(actionKey, selectedIds))
    setSelectedIds([])
  }

  return (
    <div className={\`mx-auto flex max-w-7xl flex-col gap-section p-page \${selectedIds.length > 0 ? 'pb-24' : ''}\`}>
      <EntityHeader title="Service requests" count={requests.length}
        actions={[{ key: 'create', label: 'New request', icon: 'plus-square' }]} primaryActionKey="create" onAction={openCreateForm} />
      <ListToolbar
        search={{ value: query, placeholder: 'Search requests' }} onSearchChange={setQuery}
        quickFilters={[{ id: 'mine', label: 'Assigned to me', icon: 'user', active: onlyMine }]}
        onQuickFilterToggle={(id, next) => setOnlyMine(next)}
        chips={chipIds.map((id) => ({ id, label: chipLabels[id] }))}
        onChipRemove={(id) => setChipIds(chipIds.filter((chipId) => chipId !== id))} onClearAll={() => setChipIds([])}
        views={[{ id: 'table', label: 'Table', icon: 'rows' }, { id: 'board', label: 'Board', icon: 'grid-3x3' }]}
        activeViewId={view} onViewChange={setView} />
${emptyBranch}
      <BulkActionBar selectedCount={selectedIds.length} onAction={runBulkAction} onClear={() => setSelectedIds([])}
        actions={[
          { key: 'mark-done', label: 'Mark as done', icon: 'check-circle-2' },
          { key: 'assign-me', label: 'Assign to me', icon: 'user-round' },
          { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' },
        ]} />
    </div>
  )
}`
}

type RecordDetailCodeOptions = {
  tab?: 'overview' | 'activity'
  loading?: boolean
}

export function recordDetailCode({ tab = 'overview', loading = false }: RecordDetailCodeOptions = {}): string {
  const signature = loading ? '{ customer, activity, isLoading }' : '{ customer, activity }'
  const status = loading ? `\n  const status = isLoading ? 'loading' : undefined` : ''
  const statusProp = loading ? ' status={status}' : ''
  return `import * as React from 'react'
import { EntityHeader, entityHeaderTabIds } from '@open-mercato/ui/blocks/entity-header'
import { KeyValue } from '@open-mercato/ui/blocks/key-value'
import { Timeline } from '@open-mercato/ui/blocks/timeline'

export function CustomerPage(${signature}) {
  const [activeTab, setActiveTab] = React.useState('${tab}')
  const [details, setDetails] = React.useState(customer.details)${status}
  const { tabId, panelId } = entityHeaderTabIds('customer', activeTab)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-section p-page">
      <EntityHeader${statusProp}
        idBase="customer"
        backLabel="Customers" backHref="/backend/customers"
        avatar={{ initials: 'BC' }}
        title={customer.name}
        badge={{ label: 'Active', tone: 'success' }}
        meta={[
          { key: 'owner', label: 'Owner', value: customer.owner },
          { key: 'segment', label: 'Segment', value: customer.segment },
        ]}
        actions={[
          { key: 'log-call', label: 'Log a call', icon: 'phone-call' },
          { key: 'archive', label: 'Archive', icon: 'archive' },
        ]}
        primaryActionKey="log-call"
        onAction={runCustomerAction}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'activity', label: 'Activity', count: activity.length },
        ]}
        activeTabKey={activeTab}
        onTabChange={setActiveTab}
      />
      <div role="tabpanel" id={panelId} aria-labelledby={tabId} tabIndex={0}>
        {activeTab === 'overview' ? (
          <div className="grid items-start gap-gutter lg:grid-cols-5">
            <section className="rounded-card border border-border p-card lg:col-span-3">
              <h2>Details</h2>
              <KeyValue${statusProp} items={details} columns={2} layout="vertical"
                onEdit={async (key, nextValue) => setDetails(await saveCustomerField(customer.id, key, nextValue))} />
            </section>
            <section className="rounded-card border border-border p-card lg:col-span-2">
              <h2>Latest activity</h2>
              <Timeline${statusProp} order="desc" groupBy="none" items={activity.slice(0, 3)} />
            </section>
          </div>
        ) : (
          <Timeline${statusProp} order="desc" groupBy="day" items={activity} />
        )}
      </div>
    </div>
  )
}`
}

type RecordFormCodeOptions = {
  initial?: 'clean' | 'dirty' | 'failed'
}

export function recordFormCode({ initial = 'clean' }: RecordFormCodeOptions = {}): string {
  const draft = initial === 'clean' ? 'supplier' : `{ ...supplier, phone: '+1 555 0190' }`
  const failed = initial === 'failed' ? 'true' : 'false'
  return `import * as React from 'react'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { FormSaveBar } from '@open-mercato/ui/blocks/form-save-bar'
import { Inline, Stack } from '@open-mercato/ui/blocks/stack'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

export function EditSupplierPage({ supplier }) {
  const formId = React.useId()
  const [saved, setSaved] = React.useState(supplier)
  const [draft, setDraft] = React.useState(${draft})
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(${failed})
  const [savedAt, setSavedAt] = React.useState()
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const saveState = saving ? 'saving' : failed ? 'failed' : dirty ? 'dirty' : savedAt ? 'saved' : 'idle'
  const setField = (key) => (event) => setDraft({ ...draft, [key]: event.target.value })

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      setSaved(await saveSupplier(draft))
      setSavedAt(new Date().toISOString())
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={\`mx-auto flex max-w-3xl flex-col gap-section p-page \${saveState === 'idle' ? '' : 'pb-36 sm:pb-24'}\`}>
      <EntityHeader backLabel="Suppliers" backHref="/backend/suppliers" title="Edit supplier"
        subtitle="These details appear on purchase orders." />
      <form id={formId} onSubmit={handleSubmit}>
        <Stack gap={6}>
          <section className="rounded-card border border-border p-card">
            <Stack gap={4}>
              <h2>Company</h2>
              <FormField label="Company name" required>
                <Input value={draft.name} onChange={setField('name')} />
              </FormField>
              <Inline gap={4} wrap>
                <FormField className="min-w-56 flex-1" label="Tax ID">
                  <Input value={draft.taxId} onChange={setField('taxId')} />
                </FormField>
                <FormField className="min-w-56 flex-1" label="Website">
                  <Input value={draft.website} onChange={setField('website')} />
                </FormField>
              </Inline>
            </Stack>
          </section>
          <OrderContactSection draft={draft} onChange={setDraft} />
          <TermsSection draft={draft} onChange={setDraft} />
        </Stack>
      </form>
      <FormSaveBar formId={formId} saveState={saveState} savedAt={savedAt}
        errorMessage="Could not save. Check your connection and try again."
        onReset={() => { setDraft(saved); setFailed(false) }} />
    </div>
  )
}`
}

type BoardCodeOptions = {
  columnStates?: boolean
}

export function boardCode({ columnStates = false }: BoardCodeOptions = {}): string {
  const signature = columnStates ? '{ stages, stageStatus, reloadStage }' : '{ stages }'
  const columnStatus = columnStates
    ? `
    status: stageStatus[stage.id],
    errorMessage: stageStatus[stage.id] === 'error' ? 'Could not load this stage' : undefined,`
    : ''
  const retry = columnStates ? `\n        onRetryColumn={reloadStage}` : ''
  return `import * as React from 'react'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { Kanban, applyMove } from '@open-mercato/ui/blocks/kanban'
import { ListToolbar } from '@open-mercato/ui/blocks/list-toolbar'

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function DealCard({ deal }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-foreground">{deal.title}</span>
      <span className="text-xs text-muted-foreground">{deal.company}</span>
      <span className="text-sm tabular-nums text-foreground">{money.format(deal.amount)}</span>
    </div>
  )
}

export function PipelinePage(${signature}) {
  const [columns, setColumns] = React.useState(stages)
  const [query, setQuery] = React.useState('')
  const [onlyMine, setOnlyMine] = React.useState(false)
  const [view, setView] = React.useState('board')
  const boardColumns = columns.map((stage) => {
    const cards = stage.cards.filter((deal) => matchesDeal(deal, { query, onlyMine }))
    const total = cards.reduce((sum, deal) => sum + deal.amount, 0)
    return { id: stage.id, title: stage.title, count: cards.length, summary: money.format(total), cards,${columnStatus} }
  })

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-section p-page">
      <EntityHeader title="Sales pipeline" count={columns.flatMap((stage) => stage.cards).length}
        actions={[{ key: 'create', label: 'New deal', icon: 'plus-square' }]} primaryActionKey="create" onAction={openCreateForm} />
      <ListToolbar
        search={{ value: query, placeholder: 'Search deals' }} onSearchChange={setQuery}
        quickFilters={[{ id: 'mine', label: 'My deals', icon: 'user', active: onlyMine }]}
        onQuickFilterToggle={(id, next) => setOnlyMine(next)}
        views={[{ id: 'table', label: 'Table', icon: 'rows' }, { id: 'board', label: 'Board', icon: 'grid-3x3' }]}
        activeViewId={view} onViewChange={setView} />
      <Kanban
        columns={boardColumns}
        renderCard={(deal) => <DealCard deal={deal} />}
        onMove={async (cardId, toColumnId, toIndex) => {
          setColumns((current) => applyMove(current, cardId, toColumnId, toIndex))
          await moveDeal(cardId, toColumnId, toIndex)
        }}${retry}
      />
    </div>
  )
}`
}

type SetupWizardCodeOptions = {
  stepError?: boolean
}

export function setupWizardCode({ stepError = false }: SetupWizardCodeOptions = {}): string {
  const startStep = stepError ? 'team' : 'workspace'
  const invalid = stepError ? `['team']` : '[]'
  return `import * as React from 'react'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { Wizard } from '@open-mercato/ui/blocks/wizard'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Result } from '@open-mercato/ui/primitives/result'

const order = ['workspace', 'team', 'review']
const titles = { workspace: 'Workspace', team: 'Team', review: 'Review' }
const isValid = { workspace: (values) => values.name.trim() !== '', team: (values) => values.adminEmail.includes('@'), review: () => true }

export function SetupWorkspacePage({ initialValues }) {
  const [values, setValues] = React.useState(initialValues)
  const [activeStepId, setActiveStepId] = React.useState('${startStep}')
  const [invalidSteps, setInvalidSteps] = React.useState(${invalid})
  const [finished, setFinished] = React.useState(false)
  const activeIndex = order.indexOf(activeStepId)
  const steps = order.map((id, index) => ({
    id,
    title: titles[id],
    state: invalidSteps.includes(id) && !isValid[id](values) ? 'error' : index < activeIndex ? 'complete' : undefined,
  }))

  const header = <EntityHeader backLabel="Workspaces" backHref="/backend/workspaces" title="Set up a workspace" />

  if (finished) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-section p-page">
        {header}
        <Result status="success" focusTitle title="Workspace created" subtitle={\`\${values.name} is ready.\`}
          actions={<Button variant="outline" onClick={() => setFinished(false)}>Set up another workspace</Button>} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-section p-page">
      {header}
      <Wizard
        steps={steps}
        activeStepId={activeStepId}
        onNext={async () => {
          if (!isValid[activeStepId](values)) {
            setInvalidSteps([...invalidSteps, activeStepId])
            return false
          }
          setActiveStepId(order[activeIndex + 1])
          return true
        }}
        onBack={() => setActiveStepId(order[activeIndex - 1])}
        onStepSelect={setActiveStepId}
        onFinish={async () => {
          await createWorkspace(values)
          setFinished(true)
        }}
      >
        {activeStepId === 'workspace' ? (
          <FormField label="Workspace name" required>
            <Input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
          </FormField>
        ) : null}
        {activeStepId === 'team' ? <TeamFields values={values} onChange={setValues} showErrors={invalidSteps.includes('team')} /> : null}
        {activeStepId === 'review' ? <ReviewSummary values={values} onChange={setValues} /> : null}
      </Wizard>
    </div>
  )
}`
}
