import * as React from 'react'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { entityHeaderFixtures } from '@open-mercato/ui/blocks/entity-header/fixtures'
import { Inline, Stack } from '@open-mercato/ui/blocks/stack'
import { stackFixtures } from '@open-mercato/ui/blocks/stack/fixtures'
import { Kanban, kanbanFixtures } from '@open-mercato/ui/blocks/kanban'
import { KeyValue, keyValueFixtures } from '@open-mercato/ui/blocks/key-value'
import { Timeline, timelineFixtures } from '@open-mercato/ui/blocks/timeline'
import { Wizard } from '@open-mercato/ui/blocks/wizard'
import { wizardFixtures } from '@open-mercato/ui/blocks/wizard/fixtures'
import { entityHeaderPropsSchema } from '@open-mercato/ui/blocks/contracts/entity-header'
import { kanbanPropsSchema } from '@open-mercato/ui/blocks/contracts/kanban'
import { keyValuePropsSchema } from '@open-mercato/ui/blocks/contracts/key-value'
import { stackPropsSchema } from '@open-mercato/ui/blocks/contracts/stack'
import { timelinePropsSchema } from '@open-mercato/ui/blocks/contracts/timeline'
import { wizardPropsSchema } from '@open-mercato/ui/blocks/contracts/wizard'
import { EditableKeyValueExample, KanbanBoardExample, WizardNavigationExample } from '../demos/block-interactions'
import type { GalleryEntry } from '../types'

function StackSamples({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {index + 1}
        </div>
      ))}
    </>
  )
}

const stackEntry: GalleryEntry = {
  id: 'stack',
  title: 'Stack / Inline',
  importPath: '@open-mercato/ui/blocks/stack',
  contract: {
    schema: stackPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/stack',
    implementationPath: '@open-mercato/ui/blocks/stack/Stack',
  },
  descriptionKey: 'design_system.entries.stack.description',
  keywords: ['layout', 'gap', 'flex', 'inline'],
  usage: {
    do: [
      'Use gap values from the layout scale instead of ad-hoc margins',
      'Use Stack for vertical flow and Inline for horizontal flow',
    ],
    dont: [
      'Do not pass arbitrary class names to override the gap or alignment',
      'Do not nest more than two levels when a grid expresses the layout better',
    ],
  },
  variants: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <Stack {...stackFixtures.default}>
          <StackSamples count={3} />
        </Stack>
      ),
      code: `import { Stack } from '@open-mercato/ui/blocks/stack'

<Stack gap={3}>
  <Section />
  <Section />
  <Section />
</Stack>`,
    },
    {
      id: 'tight',
      title: 'Tight',
      render: () => (
        <Stack {...stackFixtures.tight}>
          <StackSamples count={3} />
        </Stack>
      ),
      code: `import { Stack } from '@open-mercato/ui/blocks/stack'

<Stack gap={1} align="start">
  <Label />
  <Value />
</Stack>`,
    },
    {
      id: 'centered',
      title: 'Centered',
      render: () => (
        <Stack {...stackFixtures.centered}>
          <StackSamples count={3} />
        </Stack>
      ),
      code: `import { Stack } from '@open-mercato/ui/blocks/stack'

<Stack gap={4} align="center" justify="center">
  <Icon />
  <Message />
</Stack>`,
    },
    {
      id: 'spread',
      title: 'Spread',
      render: () => (
        <Inline {...stackFixtures.spread}>
          <StackSamples count={3} />
        </Inline>
      ),
      code: `import { Inline } from '@open-mercato/ui/blocks/stack'

<Inline gap={2} align="center" justify="between">
  <Title />
  <Actions />
</Inline>`,
    },
    {
      id: 'wrapping',
      title: 'Wrapping',
      render: () => (
        <Inline {...stackFixtures.wrapping}>
          <StackSamples count={8} />
        </Inline>
      ),
      code: `import { Inline } from '@open-mercato/ui/blocks/stack'

<Inline gap={2} wrap align="baseline">
  {tags.map((tag) => (
    <Tag key={tag.id}>{tag.label}</Tag>
  ))}
</Inline>`,
    },
    {
      id: 'roomy',
      title: 'Roomy',
      render: () => (
        <Stack {...stackFixtures.roomy}>
          <StackSamples count={3} />
        </Stack>
      ),
      code: `import { Stack } from '@open-mercato/ui/blocks/stack'

<Stack gap={12} align="stretch" justify="end">
  <Section />
  <Section />
</Stack>`,
    },
  ],
}

const entityHeaderCode = (props: string) => `import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'

<EntityHeader
${props}
/>`

const entityHeaderEntry: GalleryEntry = {
  id: 'entity-header',
  title: 'EntityHeader',
  importPath: '@open-mercato/ui/blocks/entity-header',
  contract: {
    schema: entityHeaderPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/entity-header',
    implementationPath: '@open-mercato/ui/blocks/entity-header/EntityHeader',
  },
  figmaNodeId: '3829:27898',
  descriptionKey: 'design_system.entries.entity-header.description',
  keywords: ['record', 'detail', 'title', 'actions'],
  usage: {
    do: [
      'Pass pre-resolved title, badge, meta and actions as data',
      'Mark one action as primaryActionKey and let the rest collapse into the overflow menu',
      'Give disabled actions a disabledReason',
    ],
    dont: [
      'Do not fetch the record inside the block',
      'Do not hide destructive actions without a confirmation in onAction',
    ],
  },
  variants: [
    {
      id: 'default',
      title: 'Default',
      render: () => <EntityHeader {...entityHeaderFixtures.default} />,
      code: entityHeaderCode(`  title="Acme Corporation"
  subtitle="Customer since March 2021"
  avatar={{ initials: 'AC' }}
  badge={{ label: 'Active', tone: 'success' }}
  meta={[{ key: 'owner', label: 'Owner', value: 'Jan Kowalski' }]}
  actions={[
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete', tone: 'destructive' },
  ]}
  primaryActionKey="edit"
  onAction={handleAction}`),
    },
    {
      id: 'read-only',
      title: 'Read only',
      render: () => <EntityHeader {...entityHeaderFixtures.readOnly} />,
      code: entityHeaderCode(`  title="Acme Corporation"
  subtitle="Customer since March 2021"
  badge={{ label: 'Archived', tone: 'neutral' }}
  meta={[{ key: 'owner', label: 'Owner', value: 'Jan Kowalski' }]}`),
    },
    {
      id: 'minimal',
      title: 'Minimal',
      render: () => <EntityHeader {...entityHeaderFixtures.minimal} />,
      code: entityHeaderCode(`  title="Acme Corporation"`),
    },
    {
      id: 'loading',
      title: 'Loading',
      render: () => <EntityHeader {...entityHeaderFixtures.loading} />,
      code: entityHeaderCode(`  title="Acme Corporation"
  status="loading"`),
    },
    {
      id: 'error',
      title: 'Error',
      render: () => <EntityHeader {...entityHeaderFixtures.error} />,
      code: entityHeaderCode(`  title="Acme Corporation"
  status="error"
  errorMessage={t('customers.detail.loadError')}`),
    },
    {
      id: 'with-slots',
      title: 'With slots',
      render: () => <EntityHeader {...entityHeaderFixtures.withSlots} />,
      code: entityHeaderCode(`  title="Acme Corporation"
  leading={<CompanyLogo />}
  trailing={<SyncIndicator />}
  below={<LastContactNote />}
  actions={[{ key: 'edit', label: 'Edit' }]}
  primaryActionKey="edit"
  onAction={handleAction}`),
    },
    {
      id: 'disabled-action',
      title: 'Disabled action',
      render: () => <EntityHeader {...entityHeaderFixtures.disabledAction} />,
      code: entityHeaderCode(`  title="Acme Corporation"
  badge={{ label: 'Locked', tone: 'warning' }}
  actions={[
    {
      key: 'edit',
      label: 'Edit',
      disabled: true,
      disabledReason: 'Another user is editing this record',
    },
    { key: 'share', label: 'Share' },
  ]}
  primaryActionKey="edit"
  onAction={handleAction}`),
    },
  ],
}

const keyValueCode = (props: string) => `import { KeyValue } from '@open-mercato/ui/blocks/key-value'

<KeyValue
${props}
/>`

const keyValueEntry: GalleryEntry = {
  id: 'key-value',
  title: 'KeyValue',
  importPath: '@open-mercato/ui/blocks/key-value',
  contract: {
    schema: keyValuePropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/key-value',
    implementationPath: '@open-mercato/ui/blocks/key-value/KeyValue',
  },
  descriptionKey: 'design_system.entries.key-value.description',
  keywords: ['properties', 'fields', 'details', 'inline edit'],
  usage: {
    do: [
      'Update the item value in the parent after saving it in onEdit',
      'Use columns={2} for dense detail panels',
      'Use layout="vertical" in narrow side panels and bordered for dense comparison tables',
    ],
    dont: [
      'Do not mark an item editable without providing onEdit',
      'Do not store unsaved drafts outside the block',
    ],
  },
  variants: [
    {
      id: 'read-only',
      title: 'Read only',
      render: () => <KeyValue {...keyValueFixtures.readOnly} />,
      code: keyValueCode(`  items={[
    { key: 'owner', label: 'Owner', value: 'Anna Kowalska' },
    { key: 'email', label: 'Email', value: 'anna@example.com', hint: 'Primary contact' },
    { key: 'segment', label: 'Segment', value: 'Enterprise' },
  ]}`),
    },
    {
      id: 'two-columns',
      title: 'Two columns',
      render: () => <KeyValue {...keyValueFixtures.twoColumns} />,
      code: keyValueCode(`  columns={2}
  items={items}`),
    },
    {
      id: 'vertical',
      title: 'Vertical',
      render: () => <KeyValue {...keyValueFixtures.vertical} />,
      code: keyValueCode(`  layout="vertical"
  columns={2}
  items={items}`),
    },
    {
      id: 'bordered',
      title: 'Bordered',
      render: () => <KeyValue {...keyValueFixtures.bordered} />,
      code: keyValueCode(`  bordered
  columns={2}
  items={items}`),
    },
    {
      id: 'with-icons',
      title: 'With icons',
      render: () => <KeyValue {...keyValueFixtures.withIcons} />,
      code: keyValueCode(`  items={[
    { key: 'owner', label: 'Owner', icon: <UserRound />, value: 'Anna Kowalska' },
    { key: 'email', label: 'Email', icon: <Mail />, value: 'anna@example.com' },
  ]}`),
    },
    {
      id: 'editable',
      title: 'Editable',
      render: () => <EditableKeyValueExample />,
      code: keyValueCode(`  columns={2}
  onEdit={async (key, value) => {
    await saveField(key, value)
    setItems((current) => current.map((item) => item.key === key ? { ...item, value } : item))
  }}
  items={items}`),
    },
    {
      id: 'rich-value',
      title: 'Rich value',
      render: () => <KeyValue {...keyValueFixtures.richValue} />,
      code: keyValueCode(`  items={[
    { key: 'website', label: 'Website', value: <a href="https://example.com">example.com</a> },
    { key: 'plan', label: 'Plan', value: <span>Business, billed yearly</span> },
  ]}`),
    },
    {
      id: 'loading',
      title: 'Loading',
      render: () => <KeyValue {...keyValueFixtures.loading} />,
      code: keyValueCode(`  items={[]}
  status="loading"`),
    },
    {
      id: 'error',
      title: 'Error',
      render: () => <KeyValue {...keyValueFixtures.error} />,
      code: keyValueCode(`  items={[]}
  status="error"
  errorMessage={t('customers.detail.loadError')}`),
    },
    {
      id: 'empty',
      title: 'Empty',
      render: () => <KeyValue {...keyValueFixtures.empty} />,
      code: keyValueCode(`  items={[]}
  status="empty"`),
    },
  ],
}

const timelineCode = (props: string) => `import { Timeline } from '@open-mercato/ui/blocks/timeline'

<Timeline
${props}
/>`

const timelineEntry: GalleryEntry = {
  id: 'timeline',
  title: 'Timeline',
  importPath: '@open-mercato/ui/blocks/timeline',
  contract: {
    schema: timelinePropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/timeline',
    implementationPath: '@open-mercato/ui/blocks/timeline/Timeline',
  },
  figmaNodeId: '166035:46833',
  descriptionKey: 'design_system.entries.timeline.description',
  keywords: ['activity', 'feed', 'history', 'audit'],
  usage: {
    do: [
      'Pass items already sorted',
      'Use groupBy="day" for long histories',
      'Resolve onLoadMore only after the next page is appended to items',
      'Use groupBy="period" for record histories that span months, and group several field updates into one item with changes',
    ],
    dont: [
      'Do not fetch data inside the block',
      'Do not render interactive controls from renderItemBody without keyboard support',
    ],
  },
  variants: [
    {
      id: 'default',
      title: 'Default',
      render: () => <Timeline {...timelineFixtures.default} />,
      code: timelineCode(`  items={items}
  order="desc"
  onItemAction={(itemId, actionKey) => handleAction(itemId, actionKey)}`),
    },
    {
      id: 'field-changes',
      title: 'Field changes',
      render: () => <Timeline {...timelineFixtures.fieldChanges} />,
      code: timelineCode(`  items={[
    {
      id: 'chg-1',
      occurredAt: '2026-11-24T11:54:00Z',
      kind: 'update',
      icon: 'pencil-line',
      title: 'changed Stage and 4 other fields in',
      author: { name: 'Alex Smith' },
      target: { label: 'Sales pipeline', icon: 'briefcase' },
      changes: [
        { key: 'stage', label: 'Stage', icon: 'trending-up', from: 'Qualified', to: 'Meeting' },
        { key: 'priority', label: 'Priority', icon: 'flag', to: 'Medium' },
      ],
    },
  ]}
  order="desc"`),
    },
    {
      id: 'grouped-by-period',
      title: 'Grouped by period',
      render: () => <Timeline {...timelineFixtures.groupedByPeriod} />,
      code: timelineCode(`  items={items}
  order="desc"
  groupBy="period"`),
    },
    {
      id: 'grouped-by-day',
      title: 'Grouped by day',
      render: () => <Timeline {...timelineFixtures.groupedByDay} />,
      code: timelineCode(`  items={items}
  order="desc"
  groupBy="day"`),
    },
    {
      id: 'with-filters',
      title: 'With filters',
      render: () => <Timeline {...timelineFixtures.withFilters} />,
      code: timelineCode(`  items={items}
  order="desc"
  filters={[
    { key: 'all', label: 'All', count: 12 },
    { key: 'notes', label: 'Notes', count: 5 },
  ]}
  activeFilterKey={filterKey}
  onFilterChange={setFilterKey}`),
    },
    {
      id: 'with-more',
      title: 'With more',
      render: () => <Timeline {...timelineFixtures.withMore} />,
      code: timelineCode(`  items={items}
  order="desc"
  hasMore={hasNextPage}
  onLoadMore={async () => {
    await fetchNextPage()
  }}`),
    },
    {
      id: 'custom-body',
      title: 'Custom body',
      render: () => <Timeline {...timelineFixtures.customBody} />,
      code: timelineCode(`  items={items}
  order="desc"
  renderItemBody={(item) => <QuoteSummary id={item.id} />}`),
    },
    {
      id: 'read-only',
      title: 'Read only',
      render: () => <Timeline {...timelineFixtures.readOnly} />,
      code: timelineCode(`  items={items.map((item) => ({ ...item, actions: undefined }))}
  order="desc"`),
    },
    {
      id: 'loading',
      title: 'Loading',
      render: () => <Timeline {...timelineFixtures.loading} />,
      code: timelineCode(`  items={[]}
  order="desc"
  status="loading"`),
    },
    {
      id: 'error',
      title: 'Error',
      render: () => <Timeline {...timelineFixtures.error} />,
      code: timelineCode(`  items={[]}
  order="desc"
  status="error"
  errorMessage={t('customers.activity.loadError')}`),
    },
    {
      id: 'empty',
      title: 'Empty',
      render: () => <Timeline {...timelineFixtures.empty} />,
      code: timelineCode(`  items={[]}
  order="desc"
  status="empty"`),
    },
  ],
}

const kanbanCode = (props: string) => `import { Kanban } from '@open-mercato/ui/blocks/kanban'

<Kanban
${props}
/>`

const kanbanEntry: GalleryEntry = {
  id: 'kanban',
  title: 'Kanban',
  importPath: '@open-mercato/ui/blocks/kanban',
  contract: {
    schema: kanbanPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/kanban',
    implementationPath: '@open-mercato/ui/blocks/kanban/Kanban',
  },
  descriptionKey: 'design_system.entries.kanban.description',
  keywords: ['board', 'pipeline', 'columns', 'drag and drop', 'stages'],
  usage: {
    do: [
      'Pass count as the server total and remaining for the Show more label',
      'Update columns after onMove resolves; the block keeps the card in place until columns change',
      'Return a reason from canMove so the Move to menu and screen readers can explain a blocked column',
      'Show onMove errors and conflicts on the page with a flash or the conflict bar',
    ],
    dont: [
      'Do not fetch data or call APIs inside renderCard',
      'Do not put buttons inside renderCard that react to Enter or Space; the card shell owns them to open the card',
      'Do not set reorderable when the server sorts the column itself',
    ],
  },
  variants: [
    {
      id: 'default',
      title: 'Default',
      render: () => <KanbanBoardExample initial="default" />,
      code: kanbanCode(`  columns={stages.map((stage) => ({
    id: stage.id,
    title: stage.name,
    count: stage.total,
    cards: stage.deals,
  }))}
  onMove={async (dealId, stageId) => {
    await moveDeal(dealId, stageId)
  }}
  canMove={(dealId, stageId) => canEnterStage(dealId, stageId)}
  onCardOpen={openDeal}
  renderCard={(deal, { pending }) => <DealCard deal={deal} pending={pending} />}`),
    },
    {
      id: 'with-summaries',
      title: 'With summaries',
      render: () => <Kanban {...kanbanFixtures.withSummaries} />,
      code: kanbanCode(`  columns={stages.map((stage) => ({
    id: stage.id,
    title: stage.name,
    count: stage.total,
    summary: formatAmount(stage.totalAmount),
    cards: stage.deals,
  }))}
  onMove={moveDeal}
  renderCard={(deal) => <DealCard deal={deal} />}`),
    },
    {
      id: 'reorderable',
      title: 'Reorderable',
      render: () => <KanbanBoardExample initial="reorderable" />,
      code: kanbanCode(`  columns={columns}
  reorderable
  onMove={async (taskId, statusId, toIndex) => {
    await moveTask(taskId, statusId, toIndex)
  }}
  renderCard={(task) => <TaskCard task={task} />}`),
    },
    {
      id: 'empty-column',
      title: 'Empty column',
      render: () => <Kanban {...kanbanFixtures.emptyColumn} />,
      code: kanbanCode(`  columns={columns}
  onMove={moveTask}
  renderCard={(task) => <TaskCard task={task} />}
  emptyColumn={(column) => <EmptyColumnHint title={column.title} />}`),
    },
    {
      id: 'show-more',
      title: 'Show more',
      render: () => <Kanban {...kanbanFixtures.showMore} />,
      code: kanbanCode(`  columns={stages.map((stage) => ({
    id: stage.id,
    title: stage.name,
    count: stage.total,
    remaining: stage.total - stage.deals.length,
    hasMore: stage.deals.length < stage.total,
    cards: stage.deals,
  }))}
  onLoadMoreColumn={async (stageId) => {
    await fetchNextPage(stageId)
  }}
  onMove={moveDeal}
  renderCard={(deal) => <DealCard deal={deal} />}`),
    },
    {
      id: 'pending',
      title: 'Pending move',
      render: () => <Kanban {...kanbanFixtures.pending} />,
      code: kanbanCode(`  columns={columns}
  onMove={(taskId, statusId) => saveStatus(taskId, statusId)}
  renderCard={(task, { pending }) => <TaskCard task={task} muted={pending} />}`),
    },
    {
      id: 'column-error',
      title: 'Column error',
      render: () => <Kanban {...kanbanFixtures.columnError} />,
      code: kanbanCode(`  columns={stages.map((stage) => ({
    id: stage.id,
    title: stage.name,
    status: stage.error ? 'error' : stage.loading ? 'loading' : 'ready',
    errorMessage: stage.error ? t('customers.deals.stageLoadError') : undefined,
    cards: stage.deals,
  }))}
  onMove={moveDeal}
  renderCard={(deal) => <DealCard deal={deal} />}`),
    },
    {
      id: 'with-trailing-and-footer',
      title: 'With trailing and footer',
      render: () => <Kanban {...kanbanFixtures.withTrailingAndFooter} />,
      code: kanbanCode(`  columns={columns}
  onMove={moveDeal}
  renderCard={(deal) => <DealCard deal={deal} />}
  columnFooter={(column) => <AddDealButton stageId={column.id} />}
  trailing={<AddStageColumn />}`),
    },
    {
      id: 'loading',
      title: 'Loading',
      render: () => <Kanban {...kanbanFixtures.loading} />,
      code: kanbanCode(`  columns={[]}
  status="loading"
  onMove={moveDeal}
  renderCard={(deal) => <DealCard deal={deal} />}`),
    },
    {
      id: 'error',
      title: 'Error',
      render: () => <Kanban {...kanbanFixtures.error} />,
      code: kanbanCode(`  columns={[]}
  status="error"
  errorMessage={t('customers.deals.loadError')}
  onMove={moveDeal}
  renderCard={(deal) => <DealCard deal={deal} />}`),
    },
    {
      id: 'empty',
      title: 'Empty',
      render: () => <Kanban {...kanbanFixtures.empty} />,
      code: kanbanCode(`  columns={[]}
  status="empty"
  onMove={moveDeal}
  renderCard={(deal) => <DealCard deal={deal} />}`),
    },
  ],
}

const wizardCode = (props: string, steps = 'steps') => `import { Wizard } from '@open-mercato/ui/blocks/wizard'

<Wizard
  steps={${steps}}
${props}
/>`

const wizardEntry: GalleryEntry = {
  id: 'wizard',
  title: 'Wizard',
  importPath: '@open-mercato/ui/blocks/wizard',
  contract: {
    schema: wizardPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/wizard',
    implementationPath: '@open-mercato/ui/blocks/wizard/Wizard',
  },
  figmaNodeId: '3507:28',
  descriptionKey: 'design_system.entries.wizard.description',
  keywords: ['stepper', 'steps', 'flow', 'onboarding'],
  usage: {
    do: [
      'Own the active step in the parent and pass it as activeStepId',
      'Return false from onNext to block advancing when validation fails',
      'Set step state to error for steps that failed validation',
    ],
    dont: [
      'Do not enable onStepSelect for steps that depend on unfinished input',
      'Do not fetch step data inside the block',
    ],
  },
  variants: [
    {
      id: 'first-step',
      title: 'First step',
      render: () => <WizardNavigationExample initial="firstStep" />,
      code: wizardCode(`  activeStepId={activeStepId}
  onNext={async () => {
    if (!(await validateDetails())) return false
    setActiveStepId('pricing')
    return true
  }}
  onBack={goBack}
  onFinish={submit}`),
    },
    {
      id: 'middle-step',
      title: 'Middle step',
      render: () => <WizardNavigationExample initial="middleStep" />,
      code: wizardCode(`  activeStepId={activeStepId}
  onNext={async () => {
    if (!(await validatePricing())) return false
    setActiveStepId('review')
    return true
  }}
  onBack={goBack}
  onFinish={submit}`),
    },
    {
      id: 'last-step',
      title: 'Last step',
      render: () => <WizardNavigationExample initial="lastStep" />,
      code: wizardCode(`  activeStepId="review"
  onNext={async () => true}
  onBack={goBack}
  onFinish={submit}`),
    },
    {
      id: 'with-error',
      title: 'With error',
      render: () => <Wizard {...wizardFixtures.withError} />,
      code: wizardCode(`  activeStepId="review"
  onNext={async () => true}
  onBack={goBack}
  onFinish={submit}`, `[
    { id: 'details', title: 'Details', state: 'complete' },
    { id: 'pricing', title: 'Pricing', state: 'error' },
    { id: 'review', title: 'Review' },
  ]`),
    },
    {
      id: 'selectable',
      title: 'Selectable',
      render: () => <WizardNavigationExample initial="selectable" />,
      code: wizardCode(`  activeStepId="review"
  onStepSelect={setActiveStepId}
  onNext={async () => true}
  onBack={goBack}
  onFinish={submit}`),
    },
    {
      id: 'loading',
      title: 'Loading',
      render: () => <Wizard {...wizardFixtures.loading} />,
      code: wizardCode(`  activeStepId="details"
  status="loading"
  onNext={async () => true}
  onBack={goBack}
  onFinish={submit}`),
    },
    {
      id: 'empty',
      title: 'Empty',
      render: () => <Wizard {...wizardFixtures.empty} />,
      code: wizardCode(`  activeStepId="details"
  status="empty"
  onNext={async () => true}
  onBack={goBack}
  onFinish={submit}`),
    },
    {
      id: 'error',
      title: 'Error',
      render: () => <Wizard {...wizardFixtures.error} />,
      code: wizardCode(`  activeStepId="details"
  status="error"
  errorMessage={t('catalog.wizard.loadError')}
  onNext={async () => true}
  onBack={goBack}
  onFinish={submit}`),
    },
  ],
}

export const entries: GalleryEntry[] = [stackEntry, entityHeaderEntry, keyValueEntry, timelineEntry, kanbanEntry, wizardEntry]
