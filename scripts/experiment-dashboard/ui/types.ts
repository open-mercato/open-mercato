export type Status =
  | 'pending'
  | 'running'
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'error'
  | 'skipped'
  | 'not-applicable'
export type Metrics = {
  availability: 'reported' | 'not-reported'
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  tokensPerSecond?: number
  outputTokensPerSecond?: number
  sampledAt?: string
  windowSeconds?: number
  generationSeconds?: number
  measurementKind?: 'live' | 'completed-response' | 'experiment'
  rateSource?: string
  stale?: boolean
}
export type Outcome = {
  status: Status
  diagnostics: string[]
  metrics: Metrics
  attempts?: number
  corrections?: number
  durationMs?: number
  artifactIds?: string[]
}
export type Lane = {
  id: string
  label: string
  total: number
  totalSource: 'observed' | 'declared'
  observedTotal: number
  completed: number
  counts: Record<Status, number>
}
export type ExperimentCase = {
  id: string
  title: string
  group: string
  prompt?: string
  lanes: Record<string, Outcome>
}
export type Activity = {
  caseId: string
  laneId: string
  phase: string
  metrics: Metrics
  startedAt?: string | null
  lastActivityAt?: string | null
  toolCalls?: number
}
export type Experiment = {
  id: string
  producerId: string
  name: string
  status: Status | 'completed' | 'stopped' | 'unknown'
  metadata: {
    model?: string
    runner?: string
    provider?: string
    tags?: string[]
  }
  metrics: Metrics
  source: string
  startedAt?: string | null
  updatedAt?: string | null
  finishedAt?: string | null
  stale: boolean
  error: string | null
  lanes: Lane[]
  cases: ExperimentCase[]
  active: Activity[]
}
export type ExperimentSummary = Omit<Experiment, 'cases'> & {
  caseCount: number
}
export type GeneratedFile = {
  id: string
  path: string
  content: string
  bytes: number
  sha256?: string
}
export type CaseDetail = {
  experimentId: string
  caseId: string
  lane: string
  title: string
  prompt?: string
  outcome: Outcome
  responses: { id: string; text: string; attemptId?: string }[]
  files: GeneratedFile[]
  tools: {
    id: string
    name: string
    path?: string
    isError?: boolean
    content?: string
  }[]
  structuredResponse: unknown
  evidence: unknown
  notices: string[]
  responseNote: string
}
