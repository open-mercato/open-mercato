import * as React from 'react'
import { StagePath } from '@open-mercato/ui/blocks/stage-path'
import { stagePathFixtures } from '@open-mercato/ui/blocks/stage-path/fixtures'
import { stagePathPropsSchema, type StagePathProps } from '@open-mercato/ui/blocks/contracts/stage-path'
import { Button } from '@open-mercato/ui/primitives/button'
import type { GalleryEntry } from '../types'

const MOVE_DELAY_MS = 700

type DealOutcome = NonNullable<StagePathProps['outcome']>

const WON_OUTCOME: DealOutcome = { label: 'Won', tone: 'success', description: 'Closed today, 40 seats for 12 months' }
const LOST_OUTCOME: DealOutcome = { label: 'Lost', tone: 'error', description: 'Closed today, buyer chose to wait' }

function InteractiveExample() {
  const base = stagePathFixtures.selectable
  const lastStageId = base.stages[base.stages.length - 1]?.id ?? base.currentStageId
  const [currentStageId, setCurrentStageId] = React.useState(base.currentStageId)
  const [movedStageId, setMovedStageId] = React.useState<string | null>(null)
  const [outcome, setOutcome] = React.useState<DealOutcome | undefined>(undefined)
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([])

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  const stages = base.stages.map((stage) => {
    if (stage.id === movedStageId) return { ...stage, meta: 'Moved just now' }
    return stage
  })

  const moveTo = (stageId: string) =>
    new Promise<void>((resolve) => {
      timers.current.push(
        setTimeout(() => {
          setCurrentStageId(stageId)
          setMovedStageId(stageId)
          setOutcome(undefined)
          resolve()
        }, MOVE_DELAY_MS),
      )
    })

  const closeAsWon = () => {
    setCurrentStageId(lastStageId)
    setOutcome(WON_OUTCOME)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-lg leading-7 text-foreground">Harbor Tools annual plan</span>
          <span className="text-sm leading-5 text-muted-foreground">Deal owned by Nadia Brandt</span>
        </div>
        <div className="flex items-center gap-2">
          {outcome ? (
            <Button type="button" variant="outline" size="sm" className="h-10 sm:h-8" onClick={() => setOutcome(undefined)}>
              Reopen deal
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" className="h-10 sm:h-8" onClick={closeAsWon}>
                Mark as won
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-10 sm:h-8" onClick={() => setOutcome(LOST_OUTCOME)}>
                Mark as lost
              </Button>
            </>
          )}
        </div>
      </div>
      <StagePath {...base} stages={stages} currentStageId={currentStageId} outcome={outcome} onStageSelect={moveTo} />
    </div>
  )
}

const stagePathCode = (props: string) => `import { StagePath } from '@open-mercato/ui/blocks/stage-path'

<StagePath
${props}
/>`

const DEAL_STAGES_CODE = `  stages={[
    { id: 'lead', label: 'Lead' },
    { id: 'qualified', label: 'Qualified' },
    { id: 'proposal', label: 'Proposal' },
    { id: 'negotiation', label: 'Negotiation' },
    { id: 'contract', label: 'Contract' },
  ]}`

export const stagePathEntry: GalleryEntry = {
  id: 'stage-path',
  title: 'StagePath',
  importPath: '@open-mercato/ui/blocks/stage-path',
  contract: {
    schema: stagePathPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/stage-path',
    implementationPath: '@open-mercato/ui/blocks/stage-path/StagePath',
  },
  descriptionKey: 'design_system.entries.stage-path.description',
  keywords: ['pipeline', 'stages', 'progress', 'stepper', 'status path', 'workflow', 'outcome'],
  usage: {
    do: [
      'Use StagePath to show where a record is in an ordered process: a deal in its pipeline, a claim in handling, a domain in setup',
      'Use Wizard instead when a person fills in a form step by step; a wizard guides input, a stage path reports the state of a record',
      'Pass the stages in process order and the id of the current one; earlier stages read as done unless completedStageIds says otherwise',
      'Pass outcome for a closed record so the whole bar changes: a success turns every reached stage green, an error or neutral outcome marks the stage where the record ended',
      'Return a promise from onStageSelect; the chosen stage shows a spinner and the other stages wait until it settles',
      'Put the time in the stage into meta and the longer explanation into description; the line under the bar shows both for the current stage only',
      'Keep the bar for record headers and pick orientation="vertical" for side panels, where every stage has room for its description',
      'Pick overflow="scroll" when every stage name must stay visible and overflow="collapse" when the current stage matters most',
    ],
    dont: [
      'Do not list outcomes such as won or lost as stages; pass them as outcome',
      'Do not use the block as page navigation or as tabs',
      'Do not move a record without confirmation when the move cannot be undone; confirm inside onStageSelect',
      'Do not put the card variant inside another bordered surface; use the plain variant there',
      'Do not disable a stage without a disabledReason',
      'Do not repeat the current stage name or the outcome next to the block; the bar and its summary line already say both',
    ],
  },
  accessibility: [
    'The stages are an ordered list and the current stage carries aria-current="step"',
    'State is never shown by colour alone: a done stage has a check, the stage where a record ended has a cross, a disabled stage has a lock, and every stage has a text state for screen readers',
    'Selectable stages are buttons with a single tab stop; arrow keys, Home and End move between them and Enter or Space selects',
    'A disabled stage stays focusable, shows its reason as a tooltip and is described by it',
    'While a move is pending the chosen stage is marked busy and the other stages do not react',
    'A path that scrolls sideways can be focused and scrolled with the keyboard, and the current stage is brought into view',
    'In the collapsed layout every stage keeps its full name for screen readers and as a tooltip',
    'The summary line describes the current stage button, and the outcome chip is announced with the word Outcome before its label',
  ],
  faq: [
    {
      question: 'Why does the path never collapse?',
      answer:
        'The block compares its own width with the width the stage names need. A parent that grows with its content never gets too narrow; give that parent min-w-0 or a fixed width.',
    },
    {
      question: 'Why are the stages not clickable?',
      answer: 'Stages become buttons only when onStageSelect is set and readOnly is not.',
    },
    {
      question: 'Where did the description of the other stages go?',
      answer:
        'The bar shows the description and meta of the current stage in the line under it. Other stages show theirs in a tooltip, and the vertical orientation lists them all.',
    },
  ],
  tokens: [
    '--status-info-solid',
    '--status-info-solid-foreground',
    '--status-info-bg',
    '--status-info-icon',
    '--status-info-border',
    '--muted',
    '--muted-foreground',
    '--border',
    '--card',
    '--radius-card',
    '--status-success-bg',
    '--status-success-text',
    '--status-success-icon',
    '--status-success-solid',
    '--status-error-bg',
    '--status-error-text',
    '--status-error-border',
    '--status-error-icon',
    '--status-error-solid',
    '--status-neutral-bg',
    '--status-neutral-text',
    '--status-neutral-solid',
  ],
  variants: [
    {
      id: 'default',
      title: 'Default',
      description: 'A deal in its pipeline. The current stage is the solid segment; done stages carry a check.',
      render: () => <StagePath {...stagePathFixtures.default} />,
      code: stagePathCode(`${DEAL_STAGES_CODE}
  currentStageId="proposal"
  ariaLabel="Deal stage"`),
    },
    {
      id: 'interactive',
      title: 'Interactive',
      description: 'Pick a stage to move the deal, or close it as won or lost. The move takes a moment so the pending state is visible.',
      render: () => <InteractiveExample />,
      code: stagePathCode(`  stages={stages}
  currentStageId={deal.stageId}
  outcome={deal.closed ? { label: deal.closedLabel, tone: deal.won ? 'success' : 'error' } : undefined}
  onStageSelect={async (stageId) => {
    await moveDeal(deal.id, stageId)
  }}`),
    },
    {
      id: 'outcome-won',
      title: 'Outcome won',
      description: 'Every stage turns green and the outcome closes the line under the bar.',
      render: () => <StagePath {...stagePathFixtures.won} />,
      code: stagePathCode(`  stages={stages}
  currentStageId="contract"
  outcome={{ label: 'Won', tone: 'success', description: 'Closed on 18 Mar, 40 seats for 12 months' }}`),
    },
    {
      id: 'outcome-lost',
      title: 'Outcome lost at an early stage',
      description: 'The stage where the deal ended is marked, earlier stages go quiet and later ones read as not reached.',
      render: () => <StagePath {...stagePathFixtures.lostEarly} />,
      code: stagePathCode(`  stages={stages}
  currentStageId="qualified"
  outcome={{ label: 'Lost', tone: 'error', description: 'Budget moved to next year' }}`),
    },
    {
      id: 'detailed',
      title: 'With descriptions and meta',
      description: 'A warranty claim. Only the current stage is described under the bar; hover another stage for its details.',
      render: () => <StagePath {...stagePathFixtures.detailed} />,
      code: stagePathCode(`  stages={[
    { id: 'intake', label: 'Intake', description: 'Claim registered by the service desk', meta: '2 Mar' },
    { id: 'review', label: 'Review', description: 'Warranty terms checked', meta: '4 Mar' },
    { id: 'goods-in', label: 'Goods received', description: 'Waiting for the parcel from the customer', meta: '3 days in this stage' },
    { id: 'resolution', label: 'Resolution', description: 'Repair, replacement or refund' },
  ]}
  currentStageId="goods-in"`),
    },
    {
      id: 'vertical',
      title: 'Vertical',
      description: 'A domain setup in a side panel, next to a rejected claim. Every stage lists its description and meta.',
      render: () => (
        <div className="grid gap-8 sm:grid-cols-2">
          <div className="max-w-sm">
            <StagePath {...stagePathFixtures.vertical} />
          </div>
          <div className="max-w-sm">
            <StagePath {...stagePathFixtures.verticalLost} />
          </div>
        </div>
      ),
      code: stagePathCode(`  stages={stages}
  currentStageId="dns"
  orientation="vertical"`),
    },
    {
      id: 'compact',
      title: 'Compact',
      description: 'A 24 px bar for dense record headers. The line under the bar shows up only for an outcome or when the bar collapses.',
      render: () => (
        <div className="flex flex-col gap-6">
          <StagePath {...stagePathFixtures.compact} />
          <StagePath {...stagePathFixtures.withdrawn} size="compact" />
        </div>
      ),
      code: stagePathCode(`  stages={stages}
  currentStageId="proposal"
  size="compact"`),
    },
    {
      id: 'markers',
      title: 'Markers',
      description: 'The marker appearance in the horizontal orientation, for places where a filled bar would be too heavy.',
      render: () => <StagePath {...stagePathFixtures.markers} />,
      code: stagePathCode(`  stages={stages}
  currentStageId="goods-in"
  appearance="markers"`),
    },
    {
      id: 'disabled-stage',
      title: 'Disabled stage with a reason',
      description: 'Hover or focus the last stage to read why it cannot be chosen.',
      render: () => <StagePath {...stagePathFixtures.disabledStage} />,
      code: stagePathCode(`  stages={[
    ...openStages,
    { id: 'contract', label: 'Contract', disabled: true, disabledReason: 'Add a signed proposal before moving to Contract' },
  ]}
  currentStageId="proposal"
  onStageSelect={moveDeal}`),
    },
    {
      id: 'many-scroll',
      title: 'Many stages with scroll',
      description: 'Eight stages in a narrow container. Every name stays readable and the bar scrolls sideways with the current stage in view.',
      render: () => (
        <div className="max-w-xl">
          <StagePath {...stagePathFixtures.manyScroll} />
        </div>
      ),
      code: stagePathCode(`  stages={eightStages}
  currentStageId="scheduling"
  overflow="scroll"`),
    },
    {
      id: 'many-collapse',
      title: 'Many stages with collapse',
      description: 'The same eight stages. Only the current stage keeps its name and grows; the others shrink to slivers with their name in a tooltip.',
      render: () => (
        <div className="max-w-xl">
          <StagePath {...stagePathFixtures.manyCollapse} />
        </div>
      ),
      code: stagePathCode(`  stages={eightStages}
  currentStageId="scheduling"
  overflow="collapse"`),
    },
    {
      id: 'card',
      title: 'Card variant',
      description: 'The block draws its own frame. Use it directly on the page background only.',
      render: () => <StagePath {...stagePathFixtures.card} />,
      code: stagePathCode(`  stages={stages}
  currentStageId="proposal"
  variant="card"`),
    },
    {
      id: 'loading',
      title: 'Loading',
      render: () => <StagePath {...stagePathFixtures.loading} />,
      code: stagePathCode(`  stages={stages}
  currentStageId="proposal"
  status="loading"`),
    },
    {
      id: 'error',
      title: 'Error with retry',
      render: () => <StagePath {...stagePathFixtures.error} />,
      code: stagePathCode(`  stages={stages}
  currentStageId="proposal"
  status="error"
  onRetry={reload}`),
    },
    {
      id: 'narrow',
      title: 'Narrow width',
      description: 'At phone width the bar collapses on its own: the current stage stays wide with its name and the line under it carries the rest.',
      render: () => (
        <div className="flex max-w-sm flex-col gap-8">
          <StagePath {...stagePathFixtures.detailed} />
          <StagePath {...stagePathFixtures.lostEarly} />
        </div>
      ),
      code: stagePathCode(`  stages={stages}
  currentStageId="goods-in"`),
    },
  ],
}
