import type { StagePathProps, StagePathStage } from '../contracts/stage-path'

const noop = () => undefined

const dealStages: StagePathStage[] = [
  { id: 'lead', label: 'Lead', description: 'Inbound request from the trade fair', meta: 'Since 3 Feb' },
  { id: 'qualified', label: 'Qualified', description: 'Budget and decision maker confirmed', meta: 'Since 11 Feb' },
  { id: 'proposal', label: 'Proposal', description: 'Offer for 40 seats sent to the buyer', meta: '6 days in this stage' },
  { id: 'negotiation', label: 'Negotiation', description: 'Terms and discount under discussion' },
  { id: 'contract', label: 'Contract', description: 'Signature and first invoice' },
]

const plainDealStages: StagePathStage[] = dealStages.map((stage) => ({ id: stage.id, label: stage.label }))

const claimStages: StagePathStage[] = [
  { id: 'intake', label: 'Intake', description: 'Claim registered by the service desk', meta: '2 Mar' },
  { id: 'review', label: 'Review', description: 'Warranty terms checked', meta: '4 Mar' },
  { id: 'goods-in', label: 'Goods received', description: 'Waiting for the parcel from the customer', meta: '3 days in this stage' },
  { id: 'resolution', label: 'Resolution', description: 'Repair, replacement or refund' },
]

const domainStages: StagePathStage[] = [
  { id: 'ownership', label: 'Ownership check', description: 'TXT record found', meta: '09:12' },
  { id: 'dns', label: 'DNS records', description: 'Waiting for the CNAME record to propagate', meta: 'Checked 4 min ago' },
  { id: 'certificate', label: 'Certificate', description: 'Issued once DNS resolves' },
  { id: 'live', label: 'Live', description: 'Traffic served from the new domain' },
]

const orderStages: StagePathStage[] = [
  { id: 'request', label: 'Request', meta: '12 May' },
  { id: 'screening', label: 'Screening', meta: '13 May' },
  { id: 'estimate', label: 'Estimate', meta: '15 May' },
  { id: 'approval', label: 'Approval', meta: '19 May' },
  { id: 'scheduling', label: 'Scheduling', description: 'Crew and delivery slot being booked', meta: '2 days in this stage' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'inspection', label: 'Inspection' },
  { id: 'handover', label: 'Handover' },
]

const gatedStages: StagePathStage[] = [
  ...dealStages.slice(0, 4),
  {
    id: 'contract',
    label: 'Contract',
    description: 'Signature and first invoice',
    disabled: true,
    disabledReason: 'Add a signed proposal before moving to Contract',
  },
]

export const stagePathFixtures: Record<string, StagePathProps> = {
  default: { stages: plainDealStages, currentStageId: 'proposal', ariaLabel: 'Deal stage' },
  selectable: { stages: dealStages, currentStageId: 'proposal', ariaLabel: 'Deal stage', onStageSelect: noop },
  won: {
    stages: dealStages,
    currentStageId: 'contract',
    ariaLabel: 'Deal stage',
    outcome: { label: 'Won', tone: 'success', description: 'Closed on 18 Mar, 40 seats for 12 months' },
  },
  lostEarly: {
    stages: dealStages,
    currentStageId: 'qualified',
    ariaLabel: 'Deal stage',
    outcome: { label: 'Lost', tone: 'error', description: 'Budget moved to next year' },
  },
  withdrawn: {
    stages: claimStages,
    currentStageId: 'review',
    ariaLabel: 'Claim progress',
    outcome: { label: 'Withdrawn', tone: 'neutral', description: 'Customer cancelled the claim' },
  },
  detailed: { stages: claimStages, currentStageId: 'goods-in', ariaLabel: 'Claim progress' },
  vertical: { stages: domainStages, currentStageId: 'dns', orientation: 'vertical', ariaLabel: 'Domain setup' },
  verticalLost: {
    stages: claimStages.map((stage, index) => (index < 2 ? stage : { id: stage.id, label: stage.label, description: stage.description })),
    currentStageId: 'review',
    orientation: 'vertical',
    ariaLabel: 'Claim progress',
    outcome: { label: 'Rejected', tone: 'error', description: 'Damage is not covered by the warranty' },
  },
  compact: { stages: plainDealStages, currentStageId: 'proposal', size: 'compact', ariaLabel: 'Deal stage' },
  markers: { stages: claimStages, currentStageId: 'goods-in', appearance: 'markers', ariaLabel: 'Claim progress' },
  disabledStage: { stages: gatedStages, currentStageId: 'proposal', ariaLabel: 'Deal stage', onStageSelect: noop },
  manyScroll: { stages: orderStages, currentStageId: 'scheduling', overflow: 'scroll', ariaLabel: 'Order progress' },
  manyCollapse: { stages: orderStages, currentStageId: 'scheduling', overflow: 'collapse', ariaLabel: 'Order progress' },
  card: { stages: dealStages, currentStageId: 'proposal', variant: 'card', ariaLabel: 'Deal stage' },
  loading: { stages: plainDealStages, currentStageId: 'proposal', status: 'loading' },
  error: { stages: plainDealStages, currentStageId: 'proposal', status: 'error', onRetry: noop },
}
