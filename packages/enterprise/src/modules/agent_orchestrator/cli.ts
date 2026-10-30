import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AgentTokenUsage } from './lib/tokens/types'
import {
  AgentCorrection,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
  type AgentProposalDisposition,
  type AgentSpanKind,
} from './data/entities'
import { recomputeProcessInstance } from './lib/processes/processProjection'
import { evalSetSnapshotSchema } from './data/validators'
import { runEvalGate } from './lib/eval/evalGate'
import { buildEvalReport } from './lib/eval/report/buildEvalReport'
import { buildEvalErrorReport, type BuildEvalErrorReportInput } from './lib/eval/report/errorReport'
import { renderEvalReportJunit } from './lib/eval/report/renderJunit'
import { renderEvalReportMarkdown } from './lib/eval/report/renderMarkdown'
import type { EvalReport } from './lib/eval/report/reportSchema'

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^-+/, '')
    const value = args[i + 1]
    if (key && value) result[key] = value
  }
  return result
}

/**
 * Rebuilds the `process_instances` read model from the module's own proposals +
 * runs: every distinct `(tenant, org, workflowInstanceId)` with agent activity is
 * recomputed through the same idempotent upsert the event subscribers use, so
 * re-running is a no-op. Used for first rollout and drift repair.
 *
 * It is a PROJECTION, which is what makes a full rebuild safe: nothing here
 * decides a lifecycle. Terminal statuses latched from prior `workflows.instance.*`
 * events are preserved on existing rows; rows created fresh here re-derive from
 * agent data alone until the next lifecycle event arrives.
 *
 *   yarn mercato agent_orchestrator rebuild-processes [--tenant <tenantId>]
 */
const rebuildProcesses: ModuleCli = {
  command: 'rebuild-processes',
  async run(rest: string[]) {
    const args = parseArgs(rest ?? [])
    const { resolve } = await createRequestContainer()
    const em = (resolve('em') as EntityManager).fork()

    const tenantFilter = args.tenant ? { tenantId: args.tenant } : {}
    const [proposalKeys, runKeys] = await Promise.all([
      em.find(
        AgentProposal,
        { ...tenantFilter, workflowInstanceId: { $ne: null }, deletedAt: null },
        { fields: ['id', 'tenantId', 'organizationId', 'workflowInstanceId'] },
      ),
      em.find(
        AgentRun,
        { ...tenantFilter, workflowInstanceId: { $ne: null }, deletedAt: null },
        { fields: ['id', 'tenantId', 'organizationId', 'workflowInstanceId'] },
      ),
    ])

    const seen = new Map<string, { tenantId: string; organizationId: string; workflowInstanceId: string }>()
    for (const row of [...proposalKeys, ...runKeys]) {
      if (!row.workflowInstanceId) continue
      const key = `${row.tenantId}:${row.organizationId}:${row.workflowInstanceId}`
      if (!seen.has(key)) {
        seen.set(key, {
          tenantId: row.tenantId,
          organizationId: row.organizationId,
          workflowInstanceId: row.workflowInstanceId,
        })
      }
    }

    console.log(`Rebuilding ${seen.size} process execution projection row(s)…`)
    let rebuilt = 0
    for (const scope of seen.values()) {
      const result = await recomputeProcessInstance(
        em.fork(),
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
        scope.workflowInstanceId,
      )
      if (result) rebuilt += 1
    }
    console.log(`Done. ${rebuilt}/${seen.size} row(s) upserted.`)
  },
}

type DemoAgentSpec = {
  id: string
  runtime: string
  model: string
  kind: 'proposal' | 'research'
  runCount: number
  actionType: string
  subjects: string[]
  rationales: string[]
  buildInput: (subject: string) => Record<string, unknown>
  buildActionPayload: (subject: string) => Record<string, unknown>
  buildResearcherOutput: (subject: string) => Record<string, unknown>
  stageByRationale?: string[]
  withProcess?: boolean
}

const DEMO_DEAL_SUBJECTS = [
  'Acme Corp renewal Q3',
  'Globex platform expansion',
  'Initech onboarding package',
  'Umbrella logistics pilot',
  'Stark Industries upsell',
  'Wayne Enterprises migration',
  'Hooli enterprise tier',
  'Soylent wholesale contract',
  'Tyrell replicant program',
  'Cyberdyne support renewal',
  'Wonka distribution deal',
  'Oscorp lab equipment',
]

const DEMO_TICKET_SUBJECTS = [
  'Order #10482 arrived damaged',
  'Cannot reset portal password',
  'Invoice missing VAT number',
  'Duplicate charge on card',
  'Where is my refund for #99121',
  'API webhook stopped firing',
  'Wrong size shipped for #10513',
  'Subscription renewed unexpectedly',
  'CSV export times out',
  'Update billing address request',
]

const DEMO_STAGES = ['qualification', 'proposal', 'negotiation', 'closed_won', 'nurture']

const DEMO_AGENTS: DemoAgentSpec[] = [
  {
    id: 'deals.health_check',
    runtime: 'in-process',
    model: 'claude-haiku-4-5',
    kind: 'proposal',
    runCount: 18,
    actionType: 'set_stage',
    subjects: DEMO_DEAL_SUBJECTS,
    rationales: [
      'Momentum is strong: three touchpoints this week and the champion confirmed budget. Moving forward matches the playbook.',
      'No activity for 14 days and the last email bounced — the deal is going stale and needs a nurture stage.',
      'Pricing was accepted verbally; the remaining blocker is legal review, which fits the negotiation stage.',
      'The buying committee expanded and a security questionnaire arrived — classic proposal-stage signals.',
    ],
    stageByRationale: ['negotiation', 'nurture', 'negotiation', 'proposal'],
    buildInput: (subject) => ({ deal: { name: subject, pipelineStage: 'qualification', amount: 25000 + Math.floor(Math.random() * 90000) } }),
    buildActionPayload: (subject) => ({ stage: DEMO_STAGES[Math.floor(Math.random() * 3) + 1], dealName: subject }),
    buildResearcherOutput: (subject) => ({ summary: `Deal ${subject} reviewed` }),
    withProcess: true,
  },
  {
    id: 'deals.health_check_file',
    runtime: 'opencode',
    model: 'claude-sonnet-4-5',
    kind: 'proposal',
    runCount: 12,
    actionType: 'set_stage',
    subjects: DEMO_DEAL_SUBJECTS,
    rationales: [
      'Activity scan found two stakeholder meetings and a signed NDA in the last 10 days — the deal earned the next stage.',
      'Sub-agent scan shows declining engagement; recommending nurture to protect win-rate metrics.',
      'Champion changed roles mid-cycle; stage should regress until the new owner re-confirms scope.',
    ],
    stageByRationale: ['negotiation', 'nurture', 'qualification'],
    buildInput: (subject) => ({ deal: { name: subject, pipelineStage: 'proposal', amount: 40000 + Math.floor(Math.random() * 120000) } }),
    buildActionPayload: (subject) => ({ stage: DEMO_STAGES[Math.floor(Math.random() * DEMO_STAGES.length)], dealName: subject }),
    buildResearcherOutput: (subject) => ({ summary: `Deal ${subject} reviewed` }),
    withProcess: true,
  },
  {
    id: 'support.ticket_triage',
    runtime: 'in-process',
    model: 'claude-haiku-4-5',
    kind: 'research',
    runCount: 16,
    actionType: 'classify_ticket',
    subjects: DEMO_TICKET_SUBJECTS,
    rationales: [],
    buildInput: (subject) => ({ ticket: { subject, channel: 'email' } }),
    buildActionPayload: (subject) => ({ subject }),
    buildResearcherOutput: (subject) => ({
      category: ['billing', 'shipping', 'account', 'technical'][Math.floor(Math.random() * 4)],
      priority: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
      summary: `Triage for: ${subject}`,
    }),
  },
  {
    id: 'support.resolution_advisor',
    runtime: 'opencode',
    model: 'claude-sonnet-4-5',
    kind: 'proposal',
    runCount: 14,
    actionType: 'suggest_reply',
    subjects: DEMO_TICKET_SUBJECTS,
    rationales: [
      'Two similar tickets were resolved with a replacement shipment; history strongly supports the same resolution here.',
      'The customer is on the enterprise plan with an SLA breach risk — recommending an expedited refund plus apology credit.',
      'Resolution playbook matches a known carrier issue; the drafted reply links the tracking escalation form.',
    ],
    buildInput: (subject) => ({ ticket: { subject, plan: 'enterprise' } }),
    buildActionPayload: (subject) => ({
      reply: `Draft reply for "${subject}" based on the resolution playbook and matching historical tickets.`,
      nextStatus: 'pending_customer',
    }),
    buildResearcherOutput: (subject) => ({ summary: `Advice for ${subject}` }),
  },
  {
    id: 'deals.web_researcher',
    runtime: 'opencode',
    model: 'claude-sonnet-4-5',
    kind: 'research',
    runCount: 8,
    actionType: 'research',
    subjects: DEMO_DEAL_SUBJECTS,
    rationales: [],
    buildInput: (subject) => ({ deal: { name: subject } }),
    buildActionPayload: (subject) => ({ subject }),
    buildResearcherOutput: (subject) => ({
      company: subject.split(' ')[0],
      headlines: ['Announced new funding round', 'Opened second EU warehouse'],
      riskSignals: [],
    }),
  },
]

const DEMO_TOOLS = [
  'customers.list_deals',
  'customers.get_deal',
  'agent_examples.lookup_ticket_history',
  'agent_orchestrator.load_skill',
  'agent_orchestrator.web_search',
]

function pick<T>(items: T[], index: number): T {
  return items[index % items.length]!
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * Seeds a realistic demo dataset for the cockpit (overview KPIs, caseload
 * queue, traces, processes, corrections). Rows are tagged with
 * `input.demoSeed = true` so `--clean true` can remove them again.
 *
 *   yarn mercato agent_orchestrator seed-demo [--tenant <id> --org <id>] [--clean true]
 */
const seedDemo: ModuleCli = {
  command: 'seed-demo',
  async run(rest: string[]) {
    const args = parseArgs(rest ?? [])
    const { resolve } = await createRequestContainer()
    const em = (resolve('em') as EntityManager).fork()
    const connection = em.getConnection()

    let tenantId = args.tenant ?? null
    let organizationId = args.org ?? null
    if (!tenantId || !organizationId) {
      const rows = await connection.execute(
        `select id, tenant_id from organizations where deleted_at is null order by created_at asc limit 1`,
      )
      const first = Array.isArray(rows) ? rows[0] : null
      if (!first) {
        console.error('No organization found — pass --tenant and --org explicitly.')
        return
      }
      organizationId = organizationId ?? String(first.id)
      tenantId = tenantId ?? String(first.tenant_id)
    }
    console.log(`Seeding agent_orchestrator demo data into tenant=${tenantId} org=${organizationId}`)

    if (args.clean === 'true') {
      await connection.execute(`delete from agent_corrections where tenant_id = ? and agent_run_id in (select id from agent_runs where tenant_id = ? and ((input->>'demoSeed') = 'true' or (input->'demo'->>'seed') = 'true'))`, [tenantId, tenantId])
      await connection.execute(`delete from agent_tool_calls where tenant_id = ? and agent_run_id in (select id from agent_runs where tenant_id = ? and ((input->>'demoSeed') = 'true' or (input->'demo'->>'seed') = 'true'))`, [tenantId, tenantId])
      await connection.execute(`delete from agent_spans where tenant_id = ? and agent_run_id in (select id from agent_runs where tenant_id = ? and ((input->>'demoSeed') = 'true' or (input->'demo'->>'seed') = 'true'))`, [tenantId, tenantId])
      await connection.execute(`delete from agent_proposals where tenant_id = ? and run_id in (select id from agent_runs where tenant_id = ? and ((input->>'demoSeed') = 'true' or (input->'demo'->>'seed') = 'true'))`, [tenantId, tenantId])
      await connection.execute(`delete from agent_runs where tenant_id = ? and ((input->>'demoSeed') = 'true' or (input->'demo'->>'seed') = 'true')`, [tenantId])
      console.log('Previous demo rows removed.')
      if (!args.seed || args.seed === 'false') return
    }

    const userRows = await connection.execute(
      `select id from users where tenant_id = ? and deleted_at is null order by created_at asc limit 1`,
      [tenantId],
    )
    const operatorUserId = Array.isArray(userRows) && userRows[0] ? String(userRows[0].id) : null

    const now = Date.now()
    const backdates: Array<{ table: string; id: string; createdAt: Date; completedAt?: Date | null }> = []
    const processIds = new Set<string>()
    let pendingBudget = 10
    let runningBudget = 2
    let runTotal = 0
    let proposalTotal = 0
    let correctionTotal = 0
    let spanTotal = 0

    for (const spec of DEMO_AGENTS) {
      for (let index = 0; index < spec.runCount; index += 1) {
        const subject = pick(spec.subjects, index)
        const isPending = spec.kind === 'proposal' && pendingBudget > 0 && index < 3
        const isRunning = !isPending && runningBudget > 0 && index === spec.runCount - 1
        const isError = !isPending && !isRunning && index % 9 === 8
        // Pending rows land in the last 30h so the caseload "waiting" sort has
        // spread; the rest scatter across the last 7 days for the KPI windows.
        const ageMs = isPending
          ? randomBetween(5, 30 * 60) * 60 * 1000
          : isRunning
            ? randomBetween(1, 4) * 60 * 1000
            : randomBetween(60, 7 * 24 * 60) * 60 * 1000
        const createdAt = new Date(now - ageMs)
        const latencyMs = randomBetween(1800, 24000)
        const completedAt = isRunning ? null : new Date(createdAt.getTime() + latencyMs)
        const confidence = spec.kind === 'proposal' ? randomBetween(55, 97) / 100 : null
        const evalScore = isError || isRunning ? null : randomBetween(72, 99) / 100
        const workflowInstanceId = spec.withProcess && !isRunning ? randomUUID() : null
        if (workflowInstanceId) processIds.add(workflowInstanceId)
        const rationaleIndex = spec.rationales.length > 0 ? index % spec.rationales.length : 0
        const rationale = spec.rationales.length > 0 ? spec.rationales[rationaleIndex] : undefined
        const actionPayload = spec.stageByRationale
          ? { stage: spec.stageByRationale[rationaleIndex], dealName: subject }
          : spec.buildActionPayload(subject)

        const run = em.create(AgentRun, {
          id: randomUUID(),
          tenantId: tenantId!,
          organizationId: organizationId!,
          agentId: spec.id,
          workflowInstanceId,
          stepId: workflowInstanceId ? 'assess' : null,
          runtime: spec.runtime,
          model: spec.model,
          agentVersion: 'v1',
          status: isRunning ? 'running' : isError ? 'error' : 'ok',
          completedAt,
          confidence,
          inputTokens: randomBetween(1200, 9000),
          outputTokens: randomBetween(300, 2400),
          costMinor: randomBetween(2, 45),
          currency: 'USD',
          latencyMs: isRunning ? null : latencyMs,
          evalScore,
          evalPassed: evalScore == null ? null : evalScore >= 0.8,
          input: { ...spec.buildInput(subject), demo: { seed: true } },
          output: isRunning || isError
            ? null
            : spec.kind === 'research'
              ? { kind: 'research', data: spec.buildResearcherOutput(subject) }
              : {
                  kind: 'proposal',
                  proposal: {
                    actions: [{ type: spec.actionType, payload: actionPayload }],
                    confidence,
                    rationale,
                  },
                },
          resultKind: isRunning || isError ? null : spec.kind,
          errorMessage: isError ? 'Model returned an outcome that failed schema validation after one retry.' : null,
        })
        em.persist(run)
        runTotal += 1
        backdates.push({ table: 'agent_runs', id: run.id, createdAt, completedAt })

        if (spec.kind === 'proposal' && !isRunning && !isError) {
          let disposition: AgentProposalDisposition
          let dispositionBy: string | null = null
          let dispositionReason: string | null = null
          if (isPending) {
            disposition = 'pending'
            pendingBudget -= 1
          } else if ((confidence ?? 0) >= 0.8) {
            disposition = 'auto_approved'
            dispositionBy = 'rule:threshold'
          } else {
            const verdictRoll = index % 5
            if (verdictRoll <= 1) {
              disposition = 'approved'
              dispositionBy = operatorUserId ?? 'demo.operator'
            } else if (verdictRoll === 2) {
              disposition = 'edited'
              dispositionBy = operatorUserId ?? 'demo.operator'
              dispositionReason = 'Adjusted the target stage — the agent under-weighted the recent security review.'
            } else {
              disposition = 'rejected'
              dispositionBy = operatorUserId ?? 'demo.operator'
              dispositionReason = 'Signal too weak: the referenced activity belongs to a different opportunity.'
            }
          }
          const proposal = em.create(AgentProposal, {
            id: randomUUID(),
            tenantId: tenantId!,
            organizationId: organizationId!,
            agentId: spec.id,
            runId: run.id,
            workflowInstanceId,
            stepId: workflowInstanceId ? 'assess' : null,
            payload: {
              actions: [{ type: spec.actionType, payload: actionPayload }],
              confidence,
              rationale,
            },
            confidence,
            disposition,
            dispositionBy,
            dispositionReason,
          })
          em.persist(proposal)
          proposalTotal += 1
          backdates.push({ table: 'agent_proposals', id: proposal.id, createdAt })

          if ((disposition === 'edited' || disposition === 'rejected') && operatorUserId) {
            const correction = em.create(AgentCorrection, {
              id: randomUUID(),
              tenantId: tenantId!,
              organizationId: organizationId!,
              workflowInstanceId,
              stepId: workflowInstanceId ? 'assess' : null,
              agentRunId: run.id,
              proposalId: proposal.id,
              correctedByUserId: operatorUserId,
              action: disposition === 'edited' ? 'edit' : 'reject',
              proposedValue: proposal.payload,
              correctedValue:
                disposition === 'edited'
                  ? { actions: [{ type: spec.actionType, payload: { ...actionPayload, stage: 'negotiation' } }] }
                  : null,
              reason: dispositionReason ?? 'Operator correction',
            })
            em.persist(correction)
            correctionTotal += 1
            backdates.push({ table: 'agent_corrections', id: correction.id, createdAt: new Date(createdAt.getTime() + latencyMs + 5 * 60 * 1000) })
          }
        }

        if (isRunning) runningBudget -= 1

        // A span tree + tool calls for recent completed runs so the trace
        // detail page has something to show during the demo.
        if (!isRunning && !isError && ageMs < 48 * 60 * 60 * 1000) {
          const spanNames: Array<{ name: string; kind: AgentSpanKind; tool?: string }> = [
            { name: 'plan', kind: 'llm' },
            { name: pick(DEMO_TOOLS, index), kind: 'tool', tool: pick(DEMO_TOOLS, index) },
            { name: 'synthesize', kind: 'llm' },
          ]
          let cursor = createdAt.getTime()
          spanNames.forEach((entry, sequence) => {
            const duration = Math.floor(latencyMs / spanNames.length)
            const span = em.create(AgentSpan, {
              id: randomUUID(),
              tenantId: tenantId!,
              organizationId: organizationId!,
              agentRunId: run.id,
              externalSpanId: `demo-${run.id}-${sequence}`,
              sequence,
              name: entry.name,
              kind: entry.kind,
              startedAt: new Date(cursor),
              endedAt: new Date(cursor + duration),
              durationMs: duration,
              status: 'ok',
              attributes: entry.kind === 'llm' ? { model: spec.model } : null,
            })
            em.persist(span)
            spanTotal += 1
            backdates.push({ table: 'agent_spans', id: span.id, createdAt: new Date(cursor) })
            if (entry.tool) {
              const toolCall = em.create(AgentToolCall, {
                id: randomUUID(),
                tenantId: tenantId!,
                organizationId: organizationId!,
                spanId: span.id,
                agentRunId: run.id,
                toolName: entry.tool,
                requestSummary: { subject },
                responseSummary: { ok: true, records: randomBetween(1, 6) },
                status: 'ok',
                latencyMs: randomBetween(120, 900),
              })
              em.persist(toolCall)
              backdates.push({ table: 'agent_tool_calls', id: toolCall.id, createdAt: new Date(cursor) })
            }
            cursor += duration
          })
        }
      }
    }

    await em.flush()

    for (const row of backdates) {
      if (row.table === 'agent_runs') {
        await connection.execute(
          `update agent_runs set created_at = ?, updated_at = ?, completed_at = ? where id = ?`,
          [row.createdAt, row.completedAt ?? row.createdAt, row.completedAt ?? null, row.id],
        )
      } else if (row.table === 'agent_proposals') {
        await connection.execute(
          `update agent_proposals set created_at = ?, updated_at = ? where id = ?`,
          [row.createdAt, row.createdAt, row.id],
        )
      } else {
        await connection.execute(`update ${row.table} set created_at = ? where id = ?`, [row.createdAt, row.id])
      }
    }

    let processTotal = 0
    for (const workflowInstanceId of processIds) {
      const result = await recomputeProcessInstance(
        em.fork(),
        { tenantId: tenantId!, organizationId: organizationId! },
        workflowInstanceId,
      )
      if (result) processTotal += 1
    }

    console.log(
      `Done. Seeded ${runTotal} runs, ${proposalTotal} proposals, ${correctionTotal} corrections, ${spanTotal} spans, ${processTotal} process rows.`,
    )
    console.log('Re-run with --clean true to remove the demo rows (add --seed true to reseed in the same call).')
  },
}

const EVAL_REPORT_FORMATS = ['json', 'md', 'junit'] as const
type EvalReportFormat = (typeof EVAL_REPORT_FORMATS)[number]
const DEFAULT_EVAL_REPORT_FORMATS: EvalReportFormat[] = ['json', 'md']
const EVAL_REPORT_FILE_NAMES: Record<EvalReportFormat, string> = {
  json: 'report.json',
  md: 'report.md',
  junit: 'junit.xml',
}
const EVAL_GATE_USAGE =
  'Usage: mercato agent_orchestrator eval --agent <agentId> --tenant <tenantId> --org <organizationId> [--release <id>] [--eval-set-version <v> | --snapshot <sha256:...|latest>] [--require-snapshot true] [--baseline <suiteRunId>] [--repeat <n>] [--gate true] [--report <dir>] [--format json,md,junit] [--include-payloads true] [--fail-on-flaky true] [--min-pass-score <0..1>]\n' +
  '  --tenant/--org fall back to OM_EVAL_TENANT_ID/OM_EVAL_ORG_ID.'

function isEvalReportFormat(value: string): value is EvalReportFormat {
  return (EVAL_REPORT_FORMATS as readonly string[]).includes(value)
}

function parseEvalReportFormats(raw: string | undefined): EvalReportFormat[] | null {
  if (raw === undefined) return DEFAULT_EVAL_REPORT_FORMATS
  const tokens = raw.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean)
  if (!tokens.length || !tokens.every(isEvalReportFormat)) return null
  return Array.from(new Set(tokens))
}

function parseOptionalBooleanFlag(raw: string | undefined): boolean | null {
  if (raw === undefined) return false
  return parseBooleanToken(raw)
}

function parseMinPassScore(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(value) || value < 0 || value > 1) return null
  return value
}

function renderEvalReport(report: EvalReport, format: EvalReportFormat): string {
  if (format === 'md') return renderEvalReportMarkdown(report)
  if (format === 'junit') return renderEvalReportJunit(report)
  return `${JSON.stringify(report, null, 2)}\n`
}

function writeEvalReportFiles(dir: string, report: EvalReport, formats: EvalReportFormat[]): string[] {
  const resolved = path.resolve(dir)
  fs.mkdirSync(resolved, { recursive: true })
  return formats.map((format) => {
    const filePath = path.join(resolved, EVAL_REPORT_FILE_NAMES[format])
    fs.writeFileSync(filePath, renderEvalReport(report, format), 'utf8')
    return filePath
  })
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function writeEvalErrorReport(dir: string, input: BuildEvalErrorReportInput): void {
  try {
    const written = writeEvalReportFiles(dir, buildEvalErrorReport(input), ['json'])
    console.error(`Error report: ${written.join(', ')}`)
  } catch (writeError) {
    console.error(`Could not write the error report: ${errorMessageOf(writeError)}`)
  }
}

/**
 * Regression gate over an agent's approved eval cases.
 *
 *   yarn mercato agent_orchestrator eval --agent <agentId> --tenant <id> --org <id> \
 *     [--release <id>] [--eval-set-version <v> | --snapshot <sha256:...|latest>] \
 *     [--require-snapshot true] [--baseline <suiteRunId>] \
 *     [--repeat <n>] [--gate true] [--report <dir>] [--format json,md,junit] \
 *     [--include-payloads true] [--fail-on-flaky true] [--min-pass-score <0..1>]
 *
 * A thin wrapper over the SAME library the workbench uses — one scorer registry,
 * one replay engine, no second implementation to drift. With `--gate true` the
 * process exits non-zero on a failed outcome so CI blocks; without it the result
 * is printed and the exit code stays 0 (report-only).
 *
 * Note that a run without `--eval-set-version` is reported as ADVISORY: with no
 * pinned dataset the verdict is not reproducible, so it must not read as a gate
 * result — and `--gate true` on an advisory run is refused rather than silently
 * passing.
 *
 * `--snapshot latest` freezes the current dataset and pins its manifest hash;
 * `--snapshot sha256:<hex>` replays a stored manifest, so the run (and its
 * baseline) is tied to the identical dataset. `--require-snapshot true` refuses
 * label-only pins and unpinned runs with exit 2.
 *
 * Exit codes: 0 passed or report-only; 1 gate failed (stored outcome, or narrowed
 * by `--fail-on-flaky`/`--min-pass-score`, or the run threw under `--gate true`);
 * 2 usage/environment error, advisory run refused, label pin refused under
 * `--require-snapshot true`, or report not writable.
 * Report files are written BEFORE the exit code is set; when the run throws, a
 * minimal `report.json` with `status: 'error'` is written instead. The narrowing
 * flags apply only under `--gate true` and can never widen a failure into a pass.
 */
const evalGate: ModuleCli = {
  command: 'eval',
  async run(rest: string[]) {
    const args = parseArgs(rest)
    const agentDefinitionId = args.agent
    const tenantId = args.tenant || process.env.OM_EVAL_TENANT_ID || undefined
    const organizationId = args.org || process.env.OM_EVAL_ORG_ID || undefined

    if (!agentDefinitionId || !tenantId || !organizationId) {
      console.error(EVAL_GATE_USAGE)
      process.exitCode = 2
      return
    }

    const gate = args.gate === 'true'
    const repeatCount = args.repeat ? Number.parseInt(args.repeat, 10) : 1
    if (!Number.isFinite(repeatCount) || repeatCount < 1) {
      console.error('--repeat must be a positive integer')
      process.exitCode = 2
      return
    }

    const reportDir = args.report
    const formats = parseEvalReportFormats(args.format)
    if (!formats) {
      console.error(`--format must be a comma-separated list of: ${EVAL_REPORT_FORMATS.join(', ')}`)
      process.exitCode = 2
      return
    }
    if (args.format !== undefined && !reportDir) {
      console.error('--format requires --report <dir>')
      process.exitCode = 2
      return
    }
    const includePayloads = parseOptionalBooleanFlag(args['include-payloads'])
    const failOnFlaky = parseOptionalBooleanFlag(args['fail-on-flaky'])
    if (includePayloads === null || failOnFlaky === null) {
      console.error('--include-payloads and --fail-on-flaky take true or false')
      process.exitCode = 2
      return
    }
    const minPassScore = parseMinPassScore(args['min-pass-score'])
    if (minPassScore === null) {
      console.error('--min-pass-score must be a number between 0 and 1')
      process.exitCode = 2
      return
    }

    const requireSnapshot = parseOptionalBooleanFlag(args['require-snapshot'])
    if (requireSnapshot === null) {
      console.error('--require-snapshot takes true or false')
      process.exitCode = 2
      return
    }
    const rawSnapshot = args.snapshot
    const parsedSnapshot = rawSnapshot === undefined ? null : evalSetSnapshotSchema.safeParse(rawSnapshot)
    if (parsedSnapshot && !parsedSnapshot.success) {
      console.error('--snapshot must be "latest" or sha256:<64 lowercase hex>')
      process.exitCode = 2
      return
    }
    const snapshot = parsedSnapshot?.success ? parsedSnapshot.data : undefined
    if (snapshot && args['eval-set-version'] !== undefined) {
      console.error('--snapshot and --eval-set-version are mutually exclusive: pin either a frozen manifest or a label')
      process.exitCode = 2
      return
    }
    if (requireSnapshot && !snapshot) {
      console.error(
        'Refusing a run without a frozen snapshot under --require-snapshot true: pass --snapshot <sha256:...|latest> instead of a label pin.',
      )
      process.exitCode = 2
      return
    }

    const scope = { tenantId, organizationId }
    const releaseId = args.release ?? null
    const evalSetVersion = snapshot ?? args['eval-set-version'] ?? null
    const errorReportInput = { agentDefinitionId, releaseId, evalSetVersion, repeatCount }

    const container = await createRequestContainer()
    let result: Awaited<ReturnType<typeof runEvalGate>>
    try {
      result = await runEvalGate(container, {
        agentDefinitionId,
        releaseId,
        ...(snapshot ? { snapshot } : { evalSetVersion }),
        baselineSuiteRunId: args.baseline ?? null,
        repeatCount,
        scope,
        triggeredBy: 'ci',
      })
    } catch (error) {
      const message = errorMessageOf(error)
      console.error(message)
      if (reportDir) writeEvalErrorReport(reportDir, { ...errorReportInput, message })
      process.exitCode = gate ? 1 : 2
      return
    }

    console.log(`Suite run:   ${result.suiteRunId}`)
    console.log(`Agent:       ${agentDefinitionId}`)
    console.log(`Case runs:   ${result.caseRunCount}${result.errorCount ? ` (${result.errorCount} errored)` : ''}`)
    console.log(`Pass score:  ${result.passScore === null ? 'n/a (nothing measurable)' : result.passScore.toFixed(3)}`)
    console.log(`Baseline:    ${result.baselineSuiteRunId ?? 'none — first run for this agent'}`)
    console.log(`Outcome:     ${result.outcome.toUpperCase()}`)

    if (result.safetyRegressions.length) {
      console.log('')
      console.log('Safety regressions vs baseline (these block promotion):')
      for (const key of result.safetyRegressions) console.log(`  - ${key}`)
    }

    let report: EvalReport | null = null
    let reportFailed = false
    if (reportDir || (gate && failOnFlaky)) {
      try {
        const em = (container.resolve('em') as EntityManager).fork()
        report = await buildEvalReport(em, scope, result.suiteRunId, { includePayloads })
        if (!report) throw new Error(`[internal] eval suite run ${result.suiteRunId} is not in scope`)
      } catch (error) {
        const message = errorMessageOf(error)
        console.error(`Could not build the eval report: ${message}`)
        reportFailed = true
        if (reportDir) {
          writeEvalErrorReport(reportDir, { ...errorReportInput, suiteRunId: result.suiteRunId, message })
        }
      }
    }
    if (report && reportDir) {
      try {
        const written = writeEvalReportFiles(reportDir, report, formats)
        console.log(`Report:      ${written.join(', ')}`)
      } catch (error) {
        console.error(`Could not write the eval report to ${reportDir}: ${errorMessageOf(error)}`)
        reportFailed = true
      }
    }

    if (!gate) {
      if (reportFailed) process.exitCode = 2
      return
    }

    if (result.outcome === 'advisory') {
      console.error('')
      console.error('Refusing to gate on an advisory run: pass --snapshot or --eval-set-version to pin the dataset, or drop --gate.')
      process.exitCode = 2
      return
    }
    if (result.outcome === 'failed') {
      process.exitCode = 1
      return
    }
    if (minPassScore !== undefined && (result.passScore === null || result.passScore < minPassScore)) {
      console.error('')
      console.error(
        `Pass score ${result.passScore === null ? 'n/a' : result.passScore.toFixed(3)} is below --min-pass-score ${minPassScore}.`,
      )
      process.exitCode = 1
      return
    }
    if (failOnFlaky && report && report.totals.flakyCases > 0) {
      console.error('')
      console.error(`${report.totals.flakyCases} flaky case(s) with --fail-on-flaky true.`)
      process.exitCode = 1
      return
    }
    if (reportFailed) process.exitCode = 2
  },
}

function padTokens(value: number): string {
  return value.toLocaleString('en-US').padStart(9)
}

function printTokenUsage(title: string, usage: AgentTokenUsage): void {
  const subTotal = usage.subAgents.reduce((sum, sub) => sum + sub.tokens, 0)
  console.log(`Token usage — ${title}`)
  console.log(
    `Total: ${usage.total.toLocaleString('en-US')} tokens ` +
      `(self ${usage.self.toLocaleString('en-US')}` +
      `${subTotal ? ` + sub-agents ${subTotal.toLocaleString('en-US')}` : ''}) · o200k_base estimate`,
  )
  console.log('')
  console.log(`${padTokens(usage.agent)}  AGENT.md`)
  console.log(`${padTokens(usage.outcome)}  OUTCOME.md`)
  if (usage.skills.length) {
    console.log('  Skills:')
    for (const skill of usage.skills) {
      console.log(`${padTokens(skill.tokens)}  ${skill.id}`)
      for (const file of skill.files) {
        console.log(`${padTokens(file.tokens)}    ${file.path.replace(`skills/${skill.id}/`, '')}`)
      }
    }
  }
  if (usage.tools.length) {
    console.log('  Tools:')
    for (const tool of usage.tools) console.log(`${padTokens(tool.tokens)}  ${tool.name}`)
  }
  if (usage.subAgents.length) {
    console.log('  Sub-agents:')
    for (const sub of usage.subAgents) console.log(`${padTokens(sub.tokens)}  ${sub.id}`)
  }
}

/**
 * Report the token cost of a file-defined agent's construction elements
 * (AGENT.md, OUTCOME.md, each skill + its subfiles, each tool, each sub-agent),
 * estimated with the shared o200k_base tokenizer.
 *
 *   yarn mercato agent_orchestrator token-usage --dir <path/to/agents/<id>> [--json]
 *   yarn mercato agent_orchestrator token-usage --agent <agentId> [--json]
 *
 * `--dir` counts the raw files live (works on any directory, even uncommitted);
 * `--agent` reads the value baked into the generated manifest at `yarn generate`.
 */
const tokenUsage: ModuleCli = {
  command: 'token-usage',
  async run(rest: string[]) {
    const args = parseArgs(rest)
    const asJson = rest.includes('--json')
    const dir = args.dir
    const agentId = args.agent
    if (!dir && !agentId) {
      console.error(
        'Usage: mercato agent_orchestrator token-usage --dir <agent-dir> | --agent <agentId> [--json]',
      )
      process.exitCode = 2
      return
    }

    let usage: AgentTokenUsage
    let title: string
    if (dir) {
      const resolved = path.resolve(dir)
      if (!fs.existsSync(path.join(resolved, 'AGENT.md'))) {
        console.error(`No AGENT.md found in ${resolved} — is this a file-agent directory?`)
        process.exitCode = 2
        return
      }
      const { computeAgentTokenUsageFromDir } = await import('./lib/tokens/computeAgentTokenUsage')
      usage = computeAgentTokenUsageFromDir(resolved)
      title = resolved
    } else {
      const manifest = await import('./generated/file-agents.generated')
      const descriptors = (manifest.fileAgentDescriptors ?? []).flatMap((descriptor) => [
        descriptor,
        ...(descriptor.subAgentDescriptors ?? []),
      ])
      const descriptor = descriptors.find((entry) => entry.id === agentId)
      if (!descriptor) {
        console.error(`Unknown file agent "${agentId}".`)
        process.exitCode = 2
        return
      }
      if (!descriptor.tokenUsage) {
        console.error(`Agent "${agentId}" has no baked token usage — re-run \`yarn generate\`.`)
        process.exitCode = 2
        return
      }
      usage = descriptor.tokenUsage
      title = agentId as string
    }

    if (asJson) {
      console.log(JSON.stringify(usage, null, 2))
      return
    }
    printTokenUsage(title, usage)
  },
}

const agentOrchestratorCliCommands = [rebuildProcesses, seedDemo, evalGate, tokenUsage]

export default agentOrchestratorCliCommands
