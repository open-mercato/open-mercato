/**
 * View model for the Process detail screen (`/backend/processes/[id]`).
 *
 * Field names mirror Patryk's planned backend so the sample→API swap is 1:1 once
 * the projection + routes land — spec
 * `.ai/specs/enterprise/agent-orchestrator/next/2026-06-25-agent-process-subject-and-caseload-projection.md`
 * (Owner: Patryk Lewczuk · Status: Not started):
 *   - `process` ← GET /api/agent_orchestrator/processes/:id  (the `AgentProcess` row)
 *   - `steps`   ← GET /api/agent_orchestrator/proposals?processId=… (+ /runs/:id for detail)
 *   - `stages`  ← workflow definition steps; the current one is marked via `process.currentStage`
 *
 * The backend projection does not exist yet, so the page renders a clearly-badged
 * sample. No new entities — pure read projections.
 */

/** Mirrors `AgentProcessStatus` (spec §Data Models → status derivation). */
export type AgentProcessStatus =
  | 'running'
  | 'waiting_on_you'
  | 'question_open'
  | 'docs_requested'
  | 'fraud_hold'
  | 'auto_completing'
  | 'auto_completed'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ProcessStateTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

/** Non-filterable display extras (spec: `AgentProcess.subjectFacets` jsonb). */
export type ProcessSubjectFacets = {
  policyholder?: string | null
  ownerLabel?: string | null
}

/** Mirrors the `AgentProcess` projection row (GET /api/agent_orchestrator/processes/:id). */
export type ProcessProjection = {
  processId: string
  workflowId: string | null
  workflowVersion: string | null
  subjectType: string | null
  subjectId: string | null
  subjectLabel: string | null
  subjectTitle: string | null
  subjectValueMinor: number | null
  subjectFraud: boolean | null
  subjectFacets: ProcessSubjectFacets | null
  status: AgentProcessStatus
  currentStage: string | null
  agentIds: string[]
  costMinor: number | null
  currency: string | null
  runCount: number
  pendingProposalCount: number
  assigneeUserId: string | null
  teamId: string | null
  waitingSince: string | null
  openedAt: string | null
  lastActivityAt: string | null
}

/** Maps a process status → state-pill tone (shared by the list + detail). */
export const PROCESS_STATUS_TONE: Record<AgentProcessStatus, ProcessStateTone> = {
  running: 'info',
  waiting_on_you: 'warning',
  question_open: 'info',
  docs_requested: 'warning',
  fraud_hold: 'error',
  auto_completing: 'info',
  auto_completed: 'success',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
}

/** Maps a process status → its i18n label key (shared by the list + detail). */
export const PROCESS_STATUS_LABEL_KEY: Record<AgentProcessStatus, string> = {
  running: 'agent_orchestrator.process.status.running',
  waiting_on_you: 'agent_orchestrator.process.status.waitingOnYou',
  question_open: 'agent_orchestrator.process.status.questionOpen',
  docs_requested: 'agent_orchestrator.process.status.docsRequested',
  fraud_hold: 'agent_orchestrator.process.status.fraudHold',
  auto_completing: 'agent_orchestrator.process.status.autoCompleting',
  auto_completed: 'agent_orchestrator.process.status.autoCompleted',
  completed: 'agent_orchestrator.process.status.completed',
  failed: 'agent_orchestrator.process.status.failed',
  cancelled: 'agent_orchestrator.process.status.cancelled',
}

/** One row of the Processes list (a denormalized AgentProcess projection row). */
export type ProcessListRow = {
  id: string
  subjectType: string
  subjectLabel: string
  subjectTitle: string
  currentStage: string
  status: AgentProcessStatus
  agentIds: string[]
  /** Nullable by honesty (data-honesty spec §3.7): unknown renders `—`, never a fake 0/epoch. */
  costMinor: number | null
  currency: string | null
  openedAt: string | null
  subjectValueMinor: number | null
  subjectFraud: boolean
}

/** One stepper stage — labels come from the workflow definition. */
export type ProcessStage = {
  key: string
  label: string
}

/** `agent` proposes (brand-violet), `system` (Open Mercato) disposes (accent-indigo). */
export type ProcessActorKind = 'agent' | 'system'

export type ProcessDetailRow = { label: string; value: string }

export type ProcessDetailSectionKind = 'input' | 'tools' | 'output'

export type ProcessDetailSection = {
  kind: ProcessDetailSectionKind
  rows: ProcessDetailRow[]
}

export type ProcessStepDetail = {
  /** Pre-formatted metric strings (e.g. "0.95", "3.1s", "0.41 zł") or null. */
  confidence: string | null
  latency: string | null
  cost: string | null
  sections: ProcessDetailSection[]
  payload: unknown
}

export type ProcessStepDay = 'today' | 'yesterday'

/** One timeline entry — a display projection of a proposal (+ its run). */
export type ProcessStep = {
  id: string
  /** FK id → agent run; drives "Open full trace" + GET /runs/:id. Null in sample mode. */
  runId: string | null
  /** FK id → the proposal this step projects; drives "Review in Caseload". Null in sample mode. */
  proposalId: string | null
  /** Proposal disposition at build time; `'pending'` enables the caseload CTA. Null in sample mode. */
  disposition: string | null
  /** Agent definition id (proposal.agent_id). */
  agentId: string | null
  /** Workflow step id (proposal.step_id). */
  stepId: string | null
  actor: string
  actorKind: ProcessActorKind
  summary: string
  time: string
  /** Day-divider key: `'today'`/`'yesterday'` (sample) or a `YYYY-MM-DD` date (real data). */
  day: string
  detail: ProcessStepDetail
}

export type ProcessView = {
  isSample: boolean
  process: ProcessProjection
  stages: ProcessStage[]
  steps: ProcessStep[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

/**
 * The Ergo Hestia motor-claim sample from the design (Figma 136:424), shaped as a
 * real `AgentProcess` projection + proposal/run timeline. Rendered when no live
 * process data is available so the screen is fully reviewable.
 */
export function buildSampleProcess(reference: string): ProcessView {
  return {
    isSample: true,
    process: {
      processId: reference,
      workflowId: 'claims_motor_adjudication_v1',
      workflowVersion: '1',
      subjectType: 'Motor',
      subjectId: 'clm-2026-04417',
      subjectLabel: reference,
      subjectTitle: 'Motor collision — payout adjudication',
      subjectValueMinor: 1840000,
      subjectFraud: false,
      subjectFacets: { policyholder: 'A. Kowalska', ownerLabel: 'Adjudication Agent' },
      status: 'waiting_on_you',
      currentStage: 'Adjudication',
      agentIds: ['intake', 'coverage', 'damage', 'fraud'],
      costMinor: 157,
      currency: 'PLN',
      runCount: 5,
      pendingProposalCount: 1,
      assigneeUserId: null,
      teamId: null,
      waitingSince: isoAgo(4 * HOUR_MS),
      openedAt: isoAgo(2 * DAY_MS + 4 * HOUR_MS),
      lastActivityAt: isoAgo(4 * HOUR_MS),
    },
    stages: [
      { key: 'intake', label: 'Intake' },
      { key: 'coverage', label: 'Coverage check' },
      { key: 'damage', label: 'Damage estimate' },
      { key: 'fraud', label: 'Fraud screen' },
      { key: 'adjudication', label: 'Adjudication' },
      { key: 'payout', label: 'Payout & comms' },
    ],
    steps: [
      {
        id: 'intake',
        runId: null,
        proposalId: null,
        disposition: null,
        agentId: 'intake',
        stepId: 'intake',
        actor: 'Intake Agent',
        actorKind: 'agent',
        summary: 'Parsed FNOL — created claim record',
        time: '09:14',
        day: 'today',
        detail: {
          confidence: '0.95',
          latency: '3.1s',
          cost: '0.41 zł',
          sections: [
            {
              kind: 'input',
              rows: [
                { label: 'Source', value: 'FNOL web form + 1 PDF' },
                { label: 'Raw fields', value: '14 extracted' },
                { label: 'Attachments', value: 'police_report.pdf' },
              ],
            },
            {
              kind: 'tools',
              rows: [
                { label: 'ocr.extract', value: '14 fields' },
                { label: 'policy.lookup', value: '1 match' },
              ],
            },
            {
              kind: 'output',
              rows: [
                { label: 'policy_no', value: 'MOT-88241-PL' },
                { label: 'incident_date', value: '2026-05-12' },
                { label: 'parties', value: '2' },
                { label: 'claim_type', value: 'motor / collision' },
              ],
            },
          ],
          payload: { policy_no: 'MOT-88241-PL', incident_date: '2026-05-12', parties: 2 },
        },
      },
      {
        id: 'coverage',
        runId: null,
        proposalId: null,
        disposition: null,
        agentId: 'coverage',
        stepId: 'coverage',
        actor: 'Coverage Analyst',
        actorKind: 'agent',
        summary: 'Coverage confirmed',
        time: '09:15',
        day: 'today',
        detail: {
          confidence: '0.91',
          latency: '2.4s',
          cost: '0.33 zł',
          sections: [
            {
              kind: 'input',
              rows: [
                { label: 'Policy', value: 'MOT-88241-PL' },
                { label: 'Claim type', value: 'motor / collision' },
              ],
            },
            {
              kind: 'tools',
              rows: [{ label: 'coverage.evaluate', value: '1 policy' }],
            },
            {
              kind: 'output',
              rows: [
                { label: 'coverage', value: 'confirmed' },
                { label: 'deductible', value: '500 PLN' },
                { label: 'exclusions', value: 'none' },
              ],
            },
          ],
          payload: { coverage: 'active', deductible_pln: 500, exclusions: [] },
        },
      },
      {
        id: 'damage',
        runId: null,
        proposalId: null,
        disposition: null,
        agentId: 'damage',
        stepId: 'damage',
        actor: 'Damage Estimator',
        actorKind: 'agent',
        summary: 'Repair estimate 18,400 PLN',
        time: '14:02',
        day: 'yesterday',
        detail: {
          confidence: '0.88',
          latency: '5.7s',
          cost: '0.62 zł',
          sections: [
            {
              kind: 'input',
              rows: [
                { label: 'Photos', value: '6 attached' },
                { label: 'Repair shop', value: 'Auto-Serwis Nord' },
              ],
            },
            {
              kind: 'tools',
              rows: [
                { label: 'vision.assess', value: '6 images' },
                { label: 'parts.catalog', value: '12 lines' },
              ],
            },
            {
              kind: 'output',
              rows: [
                { label: 'repair_estimate', value: '18,400 PLN' },
                { label: 'severity', value: 'moderate' },
                { label: 'total_loss', value: 'no' },
              ],
            },
          ],
          payload: { repair_estimate_pln: 18400, severity: 'moderate', total_loss: false },
        },
      },
      {
        id: 'fraud',
        runId: null,
        proposalId: null,
        disposition: null,
        agentId: 'fraud',
        stepId: 'fraud',
        actor: 'Fraud Signal Agent',
        actorKind: 'agent',
        summary: 'Fraud score 0.12 — below threshold',
        time: '14:03',
        day: 'yesterday',
        detail: {
          confidence: '0.97',
          latency: '1.8s',
          cost: '0.21 zł',
          sections: [
            {
              kind: 'input',
              rows: [
                { label: 'Claim', value: 'CLM-2026-04417' },
                { label: 'Policyholder', value: 'A. Kowalska' },
                { label: 'History', value: '2 prior claims' },
              ],
            },
            {
              kind: 'tools',
              rows: [
                { label: 'fraud.score', value: '12 signals' },
                { label: 'sanctions.check', value: '0 hits' },
              ],
            },
            {
              kind: 'output',
              rows: [
                { label: 'fraud_score', value: '0.12' },
                { label: 'recommendation', value: 'below threshold' },
              ],
            },
          ],
          payload: { fraud_score: 0.12, threshold: 0.6, recommendation: 'pass' },
        },
      },
      {
        id: 'dispose',
        runId: null,
        proposalId: null,
        disposition: null,
        agentId: null,
        stepId: 'dispose',
        actor: 'Open Mercato',
        actorKind: 'system',
        summary: 'Disposed — auto-accepted',
        time: '14:03',
        day: 'yesterday',
        detail: {
          confidence: 'auto',
          latency: '0.4s',
          cost: '—',
          sections: [
            {
              kind: 'input',
              rows: [
                { label: 'Proposals', value: '4 agents' },
                { label: 'Gate', value: 'auto-accept ≥ 0.85' },
              ],
            },
            {
              kind: 'tools',
              rows: [{ label: 'proposal.dispose', value: '4 accepted' }],
            },
            {
              kind: 'output',
              rows: [
                { label: 'disposition', value: 'auto-accepted' },
                { label: 'next_stage', value: 'Adjudication' },
              ],
            },
          ],
          payload: { disposition: 'auto_accepted', proposals: 4, next_stage: 'adjudication' },
        },
      },
    ],
  }
}

/**
 * Sample Processes list (Figma 129:554) — one row per claim-anchored process.
 * The first row matches the detail sample (`CLM-2026-04417`). Until the
 * `AgentProcess` projection + list route land (Patryk's spec #11), the list is
 * sample-driven; every row deep-links into the (sample) Process detail.
 */
export function buildSampleProcessList(): ProcessListRow[] {
  return [
    {
      id: 'CLM-2026-04417',
      subjectType: 'Motor',
      subjectLabel: 'CLM-2026-04417',
      subjectTitle: 'Motor collision — payout adjudication',
      currentStage: 'Adjudication',
      status: 'waiting_on_you',
      agentIds: ['Intake', 'Coverage', 'Damage', 'Fraud'],
      costMinor: 157,
      currency: 'PLN',
      openedAt: isoAgo(2 * DAY_MS + 4 * HOUR_MS),
      subjectValueMinor: 1840000,
      subjectFraud: false,
    },
    {
      id: 'CLM-2026-04211',
      subjectType: 'Motor',
      subjectLabel: 'CLM-2026-04211',
      subjectTitle: 'Rear-end collision — third-party injury',
      currentStage: 'Fraud screen',
      status: 'fraud_hold',
      agentIds: ['Intake', 'Coverage', 'Fraud'],
      costMinor: 121,
      currency: 'PLN',
      openedAt: isoAgo(1 * DAY_MS + 9 * HOUR_MS),
      subjectValueMinor: 4200000,
      subjectFraud: true,
    },
    {
      id: 'CLM-2026-04188',
      subjectType: 'Property',
      subjectLabel: 'CLM-2026-04188',
      subjectTitle: 'Water damage — kitchen appliance',
      currentStage: 'Payout & comms',
      status: 'auto_completing',
      agentIds: ['Intake', 'Coverage', 'Damage', 'Payout'],
      costMinor: 98,
      currency: 'PLN',
      openedAt: isoAgo(5 * HOUR_MS),
      subjectValueMinor: 890000,
      subjectFraud: false,
    },
    {
      id: 'CLM-2026-04172',
      subjectType: 'Motor',
      subjectLabel: 'CLM-2026-04172',
      subjectTitle: 'Windscreen replacement — glass cover',
      currentStage: 'Coverage check',
      status: 'question_open',
      agentIds: ['Intake', 'Coverage'],
      costMinor: 64,
      currency: 'PLN',
      openedAt: isoAgo(3 * HOUR_MS),
      subjectValueMinor: 123000,
      subjectFraud: false,
    },
    {
      id: 'CLM-2026-04155',
      subjectType: 'Liability',
      subjectLabel: 'CLM-2026-04155',
      subjectTitle: 'Public liability — slip and fall',
      currentStage: 'Damage estimate',
      status: 'running',
      agentIds: ['Intake', 'Coverage', 'Damage'],
      costMinor: 143,
      currency: 'PLN',
      openedAt: isoAgo(1 * DAY_MS + 6 * HOUR_MS),
      subjectValueMinor: 6750000,
      subjectFraud: false,
    },
    {
      id: 'CLM-2026-04140',
      subjectType: 'Property',
      subjectLabel: 'CLM-2026-04140',
      subjectTitle: 'Storm damage — roof tiles',
      currentStage: 'Intake',
      status: 'docs_requested',
      agentIds: ['Intake'],
      costMinor: 31,
      currency: 'PLN',
      openedAt: isoAgo(2 * HOUR_MS),
      subjectValueMinor: 520000,
      subjectFraud: false,
    },
  ]
}

// ── Real-data mappers (projection API → view models) ─────────────────────────

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

const PROCESS_STATUSES: ReadonlySet<string> = new Set([
  'running', 'waiting_on_you', 'question_open', 'docs_requested', 'fraud_hold',
  'auto_completing', 'auto_completed', 'completed', 'failed', 'cancelled',
])

function processStatus(value: unknown): AgentProcessStatus {
  return typeof value === 'string' && PROCESS_STATUSES.has(value)
    ? (value as AgentProcessStatus)
    : 'running'
}

/**
 * Maps one `GET /api/agent_orchestrator/processes` (or `/processes/:id`) row to
 * the `ProcessProjection` view. Snake_case/camelCase tolerant, null-safe: a
 * process without a subject still renders by processId/workflow name (spec's
 * honest degradation), never crashes.
 */
export function mapProcessProjection(item: Record<string, unknown>): ProcessProjection | null {
  const processId = str(item.process_id) ?? str(item.processId)
  if (!processId) return null
  const agentIdsRaw = (item.agent_ids ?? item.agentIds) as unknown
  return {
    processId,
    workflowId: str(item.workflow_id) ?? str(item.workflowId),
    workflowVersion: str(item.workflow_version) ?? str(item.workflowVersion),
    subjectType: str(item.subject_type) ?? str(item.subjectType),
    subjectId: str(item.subject_id) ?? str(item.subjectId),
    subjectLabel: str(item.subject_label) ?? str(item.subjectLabel),
    subjectTitle: str(item.subject_title) ?? str(item.subjectTitle),
    subjectValueMinor: num(item.subject_value_minor ?? item.subjectValueMinor),
    subjectFraud: bool(item.subject_fraud ?? item.subjectFraud),
    subjectFacets: ((item.subject_facets ?? item.subjectFacets) as ProcessSubjectFacets | null) ?? null,
    status: processStatus(item.status),
    currentStage: str(item.current_stage) ?? str(item.currentStage),
    agentIds: Array.isArray(agentIdsRaw)
      ? agentIdsRaw.filter((id): id is string => typeof id === 'string')
      : [],
    costMinor: num(item.cost_minor ?? item.costMinor),
    currency: str(item.currency),
    runCount: num(item.run_count ?? item.runCount) ?? 0,
    pendingProposalCount: num(item.pending_proposal_count ?? item.pendingProposalCount) ?? 0,
    assigneeUserId: str(item.assignee_user_id) ?? str(item.assigneeUserId),
    teamId: str(item.team_id) ?? str(item.teamId),
    waitingSince: str(item.waiting_since) ?? str(item.waitingSince),
    openedAt: str(item.opened_at) ?? str(item.openedAt),
    lastActivityAt: str(item.last_activity_at) ?? str(item.lastActivityAt),
  }
}

/** Maps a projection row to one Processes-list row (subject-less rows degrade to processId/workflow name). */
export function mapProcessListRow(item: Record<string, unknown>): ProcessListRow | null {
  const projection = mapProcessProjection(item)
  if (!projection) return null
  return {
    id: projection.processId,
    subjectType: projection.subjectType ?? '—',
    subjectLabel: projection.subjectLabel ?? projection.processId.slice(0, 8).toUpperCase(),
    subjectTitle: projection.subjectTitle ?? projection.workflowId ?? '',
    currentStage: projection.currentStage ?? '—',
    status: projection.status,
    agentIds: projection.agentIds,
    // Nulls stay nulls (data-honesty spec §3.7) — a 0-cost or epoch-1970 age
    // ("20000d") is a polite lie; cells render `—` instead.
    costMinor: projection.costMinor,
    currency: projection.currency,
    openedAt: projection.openedAt,
    subjectValueMinor: projection.subjectValueMinor,
    subjectFraud: projection.subjectFraud ?? false,
  }
}
