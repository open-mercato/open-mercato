import { randomUUID } from 'node:crypto'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AgentCorrection,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
  type AgentProposalDisposition,
  type AgentSpanKind,
} from './data/entities'
import { recomputeAgentProcess } from './lib/processes/agentProcessProjection'

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
 * Rebuilds the `agent_processes` read-model from the module's own proposals +
 * runs (process projection spec, 2026-06-25): every distinct
 * `(tenant, org, processId)` with agent activity is recomputed through the same
 * idempotent upsert the event subscribers use, so re-running is a no-op. Used
 * for first rollout and drift repair. Terminal statuses latched from prior
 * `workflows.instance.*` events are preserved on existing rows; rows created
 * fresh here re-derive from agent data alone (tier A) until the next lifecycle
 * event arrives.
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
        { ...tenantFilter, processId: { $ne: null }, deletedAt: null },
        { fields: ['id', 'tenantId', 'organizationId', 'processId'] },
      ),
      em.find(
        AgentRun,
        { ...tenantFilter, processId: { $ne: null }, deletedAt: null },
        { fields: ['id', 'tenantId', 'organizationId', 'processId'] },
      ),
    ])

    const seen = new Map<string, { tenantId: string; organizationId: string; processId: string }>()
    for (const row of [...proposalKeys, ...runKeys]) {
      if (!row.processId) continue
      const key = `${row.tenantId}:${row.organizationId}:${row.processId}`
      if (!seen.has(key)) {
        seen.set(key, {
          tenantId: row.tenantId,
          organizationId: row.organizationId,
          processId: row.processId,
        })
      }
    }

    console.log(`Rebuilding ${seen.size} agent process projection row(s)…`)
    let rebuilt = 0
    for (const scope of seen.values()) {
      const result = await recomputeAgentProcess(
        em.fork(),
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
        scope.processId,
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
  kind: 'actionable' | 'informative'
  runCount: number
  actionType: string
  subjects: string[]
  rationales: string[]
  buildInput: (subject: string) => Record<string, unknown>
  buildActionPayload: (subject: string) => Record<string, unknown>
  buildInformativeOutput: (subject: string) => Record<string, unknown>
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
    kind: 'actionable',
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
    buildInformativeOutput: (subject) => ({ summary: `Deal ${subject} reviewed` }),
    withProcess: true,
  },
  {
    id: 'deals.health_check_file',
    runtime: 'opencode',
    model: 'claude-sonnet-4-5',
    kind: 'actionable',
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
    buildInformativeOutput: (subject) => ({ summary: `Deal ${subject} reviewed` }),
    withProcess: true,
  },
  {
    id: 'support.ticket_triage',
    runtime: 'in-process',
    model: 'claude-haiku-4-5',
    kind: 'informative',
    runCount: 16,
    actionType: 'classify_ticket',
    subjects: DEMO_TICKET_SUBJECTS,
    rationales: [],
    buildInput: (subject) => ({ ticket: { subject, channel: 'email' } }),
    buildActionPayload: (subject) => ({ subject }),
    buildInformativeOutput: (subject) => ({
      category: ['billing', 'shipping', 'account', 'technical'][Math.floor(Math.random() * 4)],
      priority: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
      summary: `Triage for: ${subject}`,
    }),
  },
  {
    id: 'support.resolution_advisor',
    runtime: 'opencode',
    model: 'claude-sonnet-4-5',
    kind: 'actionable',
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
    buildInformativeOutput: (subject) => ({ summary: `Advice for ${subject}` }),
  },
  {
    id: 'deals.web_researcher',
    runtime: 'opencode',
    model: 'claude-sonnet-4-5',
    kind: 'informative',
    runCount: 8,
    actionType: 'research',
    subjects: DEMO_DEAL_SUBJECTS,
    rationales: [],
    buildInput: (subject) => ({ deal: { name: subject } }),
    buildActionPayload: (subject) => ({ subject }),
    buildInformativeOutput: (subject) => ({
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
        const isPending = spec.kind === 'actionable' && pendingBudget > 0 && index < 3
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
        const confidence = spec.kind === 'actionable' ? randomBetween(55, 97) / 100 : null
        const evalScore = isError || isRunning ? null : randomBetween(72, 99) / 100
        const processId = spec.withProcess && !isRunning ? randomUUID() : null
        if (processId) processIds.add(processId)
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
          processId,
          stepId: processId ? 'assess' : null,
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
            : spec.kind === 'informative'
              ? { kind: 'informative', data: spec.buildInformativeOutput(subject) }
              : {
                  kind: 'actionable',
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

        if (spec.kind === 'actionable' && !isRunning && !isError) {
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
            processId,
            stepId: processId ? 'assess' : null,
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
              processId,
              stepId: processId ? 'assess' : null,
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
    for (const processId of processIds) {
      const result = await recomputeAgentProcess(
        em.fork(),
        { tenantId: tenantId!, organizationId: organizationId! },
        processId,
      )
      if (result) processTotal += 1
    }

    console.log(
      `Done. Seeded ${runTotal} runs, ${proposalTotal} proposals, ${correctionTotal} corrections, ${spanTotal} spans, ${processTotal} process rows.`,
    )
    console.log('Re-run with --clean true to remove the demo rows (add --seed true to reseed in the same call).')
  },
}

const agentOrchestratorCliCommands = [rebuildProcesses, seedDemo]

export default agentOrchestratorCliCommands
