import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentEvalAssertion, type AgentEvalAssertionType, type AgentEvalSeverity } from '../../data/entities'

type DefaultAssertion = {
  key: string
  title: string
  description: string
  type: AgentEvalAssertionType
  severity: AgentEvalSeverity
  config: Record<string, unknown> | null
  /** Defaults to true. The llm_judge example ships disabled so it does not silently activate the model judge. */
  enabled?: boolean
}

/**
 * Tenant-scoped default deterministic assertions applied to every agent (`*`).
 * Seeded idempotently so a stock tenant evaluates runs out of the box. These are
 * real per-(tenant, org) rows — NOT the global `module_configs` store — so they
 * respect tenant scoping (unlike the auto-approve threshold, see setup.ts).
 */
const DEFAULT_ASSERTIONS: DefaultAssertion[] = [
  {
    key: 'output_present',
    title: 'Output present',
    description: 'The run produced a non-empty output.',
    type: 'deterministic',
    severity: 'gate',
    config: null,
  },
  {
    key: 'min_confidence',
    title: 'Minimum confidence',
    description: 'Run confidence is at or above the configured threshold.',
    type: 'deterministic',
    severity: 'warn',
    config: { threshold: 0.5 },
  },
  {
    key: 'no_pii',
    title: 'No PII in output',
    description: 'No PII-shaped substring detected in the run output.',
    type: 'deterministic',
    severity: 'warn',
    config: null,
  },
  // A ready-to-enable model-judge example. Shipped DISABLED so the sampled
  // llm_judge tier stays dormant until an engineer flips `enabled` on via the
  // eval-assertions CRUD route. `config.rubric` is the string consumed by
  // `runLlmJudgeForRun` (`rubricFor`). Always `warn` — the judge never blocks.
  {
    key: 'llm_judge_helpfulness',
    title: 'LLM judge — helpfulness',
    description: 'A sampled model judge scores how helpful, complete, and on-task the agent output is.',
    type: 'llm_judge',
    severity: 'warn',
    enabled: false,
    config: {
      rubric:
        'Rate whether the agent output is helpful: it directly addresses the request, is complete, ' +
        'accurate, and on-task, with no hallucinated or contradictory claims. Pass when it is clearly ' +
        'helpful; fail when it is off-topic, incomplete, or misleading.',
    },
  },
]

export async function seedDefaultEvalAssertions(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  for (const def of DEFAULT_ASSERTIONS) {
    const existing = await em.findOne(AgentEvalAssertion, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      appliesTo: '*',
      key: def.key,
    })
    if (existing) continue
    em.persist(
      em.create(AgentEvalAssertion, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        key: def.key,
        title: def.title,
        description: def.description,
        appliesTo: '*',
        type: def.type,
        severity: def.severity,
        config: def.config,
        enabled: def.enabled ?? true,
        deletedAt: null,
      }),
    )
  }
  await em.flush()
}
