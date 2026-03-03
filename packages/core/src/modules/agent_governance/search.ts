import type {
  SearchBuildContext,
  SearchModuleConfig,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'

function snippet(value: unknown, max = 140): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3)}...`
}

function joinParts(parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter((part) => part.length > 0)
  if (text.length === 0) return undefined
  return text.join(' · ')
}

function buildDecisionPresenter(ctx: SearchBuildContext): SearchResultPresenter {
  const title = `${ctx.record.action_type ?? ctx.record.actionType ?? 'decision'} → ${ctx.record.target_entity ?? ctx.record.targetEntity ?? 'target'}`
  return {
    title: String(title),
    subtitle: joinParts([
      ctx.record.status,
      ctx.record.control_path ?? ctx.record.controlPath,
      ctx.record.risk_score ?? ctx.record.riskScore,
    ]),
    icon: 'lucide:activity',
    badge: 'Decision',
  }
}

function buildPrecedentPresenter(ctx: SearchBuildContext): SearchResultPresenter {
  return {
    title: String(ctx.record.signature ?? 'precedent'),
    subtitle: joinParts([
      snippet(ctx.record.summary),
      ctx.record.score,
    ]),
    icon: 'lucide:library',
    badge: 'Precedent',
  }
}

function buildSkillPresenter(ctx: SearchBuildContext): SearchResultPresenter {
  return {
    title: String(ctx.record.name ?? 'skill'),
    subtitle: joinParts([
      ctx.record.status,
      ctx.record.source_type ?? ctx.record.sourceType,
      snippet(ctx.record.description),
    ]),
    icon: 'lucide:brain-circuit',
    badge: 'Skill',
  }
}

function buildSource(
  ctx: SearchBuildContext,
  lines: string[],
  presenter: SearchResultPresenter,
): SearchIndexSource | null {
  if (lines.length === 0) return null
  return {
    text: lines,
    presenter,
    checksumSource: {
      record: ctx.record,
      customFields: ctx.customFields,
    },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'agent_governance:agent_governance_decision_event',
      enabled: true,
      priority: 9,
      buildSource: async (ctx) => {
        const lines: string[] = []
        lines.push(`Action: ${ctx.record.action_type ?? ctx.record.actionType ?? ''}`)
        lines.push(`Target: ${ctx.record.target_entity ?? ctx.record.targetEntity ?? ''}`)
        lines.push(`Status: ${ctx.record.status ?? ''}`)
        lines.push(`Control path: ${ctx.record.control_path ?? ctx.record.controlPath ?? ''}`)
        lines.push(`Signature: ${ctx.record.signature ?? ''}`)
        const summary = snippet(ctx.record.error_code ?? ctx.record.errorCode)
        if (summary) lines.push(`Error: ${summary}`)

        return buildSource(ctx, lines, buildDecisionPresenter(ctx))
      },
      formatResult: async (ctx) => buildDecisionPresenter(ctx),
      resolveUrl: async (ctx) => `/backend/agent-governance/runs/${encodeURIComponent(String(ctx.record.run_id ?? ctx.record.runId ?? ''))}`,
      fieldPolicy: {
        searchable: ['action_type', 'target_entity', 'status', 'control_path', 'signature', 'error_code'],
        hashOnly: ['target_id'],
        excluded: ['write_set', 'input_evidence', 'approver_ids', 'exception_ids', 'immutable_hash'],
      },
    },
    {
      entityId: 'agent_governance:agent_governance_precedent_index',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const lines: string[] = []
        lines.push(`Signature: ${ctx.record.signature ?? ''}`)
        if (typeof ctx.record.summary === 'string') lines.push(`Summary: ${ctx.record.summary}`)
        lines.push(`Score: ${ctx.record.score ?? ''}`)

        return buildSource(ctx, lines, buildPrecedentPresenter(ctx))
      },
      formatResult: async (ctx) => buildPrecedentPresenter(ctx),
      resolveUrl: async (ctx) => `/api/agent_governance/precedents/explain?eventId=${encodeURIComponent(String(ctx.record.decision_event_id ?? ctx.record.decisionEventId ?? ''))}`,
      fieldPolicy: {
        searchable: ['signature', 'summary', 'score'],
        excluded: ['checksum'],
      },
    },
    {
      entityId: 'agent_governance:agent_governance_skill',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const lines: string[] = []
        lines.push(`Name: ${ctx.record.name ?? ''}`)
        lines.push(`Status: ${ctx.record.status ?? ''}`)
        lines.push(`Source: ${ctx.record.source_type ?? ctx.record.sourceType ?? ''}`)
        const summary = snippet(ctx.record.description)
        if (summary) lines.push(`Description: ${summary}`)

        return buildSource(ctx, lines, buildSkillPresenter(ctx))
      },
      formatResult: async (ctx) => buildSkillPresenter(ctx),
      resolveUrl: async () => '/backend/agent-governance/skills',
      fieldPolicy: {
        searchable: ['name', 'description', 'status', 'source_type'],
        excluded: ['framework_json'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
