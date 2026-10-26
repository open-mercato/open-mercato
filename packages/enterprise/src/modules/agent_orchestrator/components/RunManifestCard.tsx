"use client"

import * as React from 'react'
import { z } from 'zod'
import { Copy } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SpanView } from './types'

const MANIFEST_SPAN_NAME = 'run.manifest'
const MANIFEST_SPAN_KIND = 'system'
const HASH_PREFIX = 'sha256:'
const HASH_VISIBLE_CHARS = 12

const optionalString = z.string().min(1).optional().catch(undefined)
const nullableId = z.string().nullable().optional().catch(undefined)

const runManifestSchema = z.object({
  'om.manifest.version': z.number().optional().catch(undefined),
  'om.runtime': optionalString,
  'om.agent.id': optionalString,
  'om.agent.definition_hash': optionalString,
  'om.agent.source': optionalString,
  'om.prompt.override': z.object({ id: z.string(), version: z.number() }).optional().catch(undefined),
  'om.prompt.system.sha256': optionalString,
  'om.tools.sha256': optionalString,
  'om.tools.names': z.array(z.string()).optional().catch(undefined),
  'om.model.declared': optionalString,
  'om.model.resolved': optionalString,
  'om.provider': optionalString,
  'om.knowledge': z.record(z.string(), z.string()).optional().catch(undefined),
  'om.invoker': z
    .object({ kind: z.string(), userId: nullableId, apiKeyId: nullableId, ownerUserId: nullableId })
    .optional()
    .catch(undefined),
  'om.entry_point': optionalString,
  'om.channel': optionalString,
  'om.correlation_id': nullableId,
  'om.principal': z
    .object({ agentPrincipalId: nullableId, agentUserId: nullableId, onBehalfOfUserId: nullableId })
    .optional()
    .catch(undefined),
  'om.capture': z.object({ level: z.string() }).passthrough().optional().catch(undefined),
  'om.manifest.truncated': z.boolean().optional().catch(undefined),
})

export type RunManifestView = z.infer<typeof runManifestSchema>

export function findRunManifest(spans: readonly SpanView[]): RunManifestView | null {
  const span = spans.find((candidate) => candidate.name === MANIFEST_SPAN_NAME && candidate.kind === MANIFEST_SPAN_KIND)
  if (!span || span.attributes == null || typeof span.attributes !== 'object') return null
  const parsed = runManifestSchema.safeParse(span.attributes)
  return parsed.success ? parsed.data : null
}

export function shortenHash(value: string): string {
  const body = value.startsWith(HASH_PREFIX) ? value.slice(HASH_PREFIX.length) : value
  if (body.length <= HASH_VISIBLE_CHARS) return value
  return `${body.slice(0, HASH_VISIBLE_CHARS)}…`
}

function HashValue({ value }: { value: string }) {
  const t = useT()
  const copy = React.useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(value).then(
      () => flash(t('agent_orchestrator.traces.detail.manifest.copied'), 'success'),
      () => flash(t('agent_orchestrator.traces.detail.manifest.copyFailed'), 'error'),
    )
  }, [t, value])
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SimpleTooltip content={value}>
        <span className="truncate font-mono text-xs text-foreground">{shortenHash(value)}</span>
      </SimpleTooltip>
      <IconButton
        type="button"
        variant="ghost"
        size="xs"
        onClick={copy}
        aria-label={t('agent_orchestrator.traces.detail.manifest.copy')}
      >
        <Copy className="size-3.5" />
      </IconButton>
    </span>
  )
}

function MonoValue({ children }: { children: React.ReactNode }) {
  return <span className="break-all font-mono text-xs text-foreground">{children}</span>
}

type ManifestRow = { key: string; label: string; value: React.ReactNode }

function idPairs(entries: Array<[string, string | null | undefined]>): string | null {
  const present = entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
  if (present.length === 0) return null
  return present.map(([label, value]) => `${label}: ${value}`).join(' · ')
}

function buildRows(
  manifest: RunManifestView,
  t: ReturnType<typeof useT>,
): ManifestRow[] {
  const rows: ManifestRow[] = []
  const push = (labelKey: string, value: React.ReactNode | null | undefined) => {
    if (value == null || value === '') return
    rows.push({ key: labelKey, label: t(labelKey), value })
  }
  const definitionHash = manifest['om.agent.definition_hash']
  push('agent_orchestrator.traces.detail.manifest.definitionHash', definitionHash ? <HashValue value={definitionHash} /> : null)
  push('agent_orchestrator.traces.detail.manifest.runtime', manifest['om.runtime'] ? <MonoValue>{manifest['om.runtime']}</MonoValue> : null)
  push('agent_orchestrator.traces.detail.manifest.source', manifest['om.agent.source'] ? <MonoValue>{manifest['om.agent.source']}</MonoValue> : null)
  const override = manifest['om.prompt.override']
  push(
    'agent_orchestrator.traces.detail.manifest.promptOverride',
    override ? (
      <MonoValue>
        {t('agent_orchestrator.traces.detail.manifest.promptOverrideValue', undefined, {
          id: override.id,
          version: override.version,
        })}
      </MonoValue>
    ) : null,
  )
  const systemPromptHash = manifest['om.prompt.system.sha256']
  push('agent_orchestrator.traces.detail.manifest.systemPromptHash', systemPromptHash ? <HashValue value={systemPromptHash} /> : null)
  const toolNames = manifest['om.tools.names']
  const toolsHash = manifest['om.tools.sha256']
  if (toolNames || toolsHash) {
    push(
      'agent_orchestrator.traces.detail.manifest.tools',
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        {toolNames ? (
          <span className="text-sm tabular-nums text-foreground">
            {t('agent_orchestrator.traces.detail.manifest.toolsCount', undefined, { count: toolNames.length })}
          </span>
        ) : null}
        {toolsHash ? <HashValue value={toolsHash} /> : null}
      </span>,
    )
  }
  push('agent_orchestrator.traces.detail.manifest.modelDeclared', manifest['om.model.declared'] ? <MonoValue>{manifest['om.model.declared']}</MonoValue> : null)
  push('agent_orchestrator.traces.detail.manifest.modelResolved', manifest['om.model.resolved'] ? <MonoValue>{manifest['om.model.resolved']}</MonoValue> : null)
  push('agent_orchestrator.traces.detail.manifest.provider', manifest['om.provider'] ? <MonoValue>{manifest['om.provider']}</MonoValue> : null)
  const knowledgeEntries = Object.entries(manifest['om.knowledge'] ?? {})
  push(
    'agent_orchestrator.traces.detail.manifest.knowledge',
    knowledgeEntries.length > 0 ? (
      <ul className="space-y-0.5">
        {knowledgeEntries.map(([key, version]) => (
          <li key={key} className="break-all font-mono text-xs text-foreground">
            {key} → {version}
          </li>
        ))}
      </ul>
    ) : null,
  )
  const invoker = manifest['om.invoker']
  if (invoker) {
    const ids = idPairs([
      [t('agent_orchestrator.traces.detail.manifest.invokerUser'), invoker.userId],
      [t('agent_orchestrator.traces.detail.manifest.invokerApiKey'), invoker.apiKeyId],
      [t('agent_orchestrator.traces.detail.manifest.invokerOwner'), invoker.ownerUserId],
    ])
    push(
      'agent_orchestrator.traces.detail.manifest.invoker',
      <span className="block min-w-0">
        <MonoValue>{invoker.kind}</MonoValue>
        {ids ? <span className="block break-all font-mono text-xs text-muted-foreground">{ids}</span> : null}
      </span>,
    )
  }
  push('agent_orchestrator.traces.detail.manifest.entryPoint', manifest['om.entry_point'] ? <MonoValue>{manifest['om.entry_point']}</MonoValue> : null)
  push('agent_orchestrator.traces.detail.manifest.channel', manifest['om.channel'] ? <MonoValue>{manifest['om.channel']}</MonoValue> : null)
  push('agent_orchestrator.traces.detail.manifest.correlationId', manifest['om.correlation_id'] ? <MonoValue>{manifest['om.correlation_id']}</MonoValue> : null)
  const principal = manifest['om.principal']
  if (principal) {
    push(
      'agent_orchestrator.traces.detail.manifest.principal',
      idPairs([
        [t('agent_orchestrator.traces.detail.manifest.principalAgent'), principal.agentPrincipalId],
        [t('agent_orchestrator.traces.detail.manifest.principalAgentUser'), principal.agentUserId],
        [t('agent_orchestrator.traces.detail.manifest.principalOnBehalfOf'), principal.onBehalfOfUserId],
      ]),
    )
  }
  push('agent_orchestrator.traces.detail.manifest.capture', manifest['om.capture'] ? <MonoValue>{manifest['om.capture'].level}</MonoValue> : null)
  push(
    'agent_orchestrator.traces.detail.manifest.truncated',
    manifest['om.manifest.truncated'] ? (
      <StatusBadge variant="warning">{t('agent_orchestrator.traces.detail.manifest.truncatedValue')}</StatusBadge>
    ) : null,
  )
  return rows
}

export function RunManifestCard({
  spans,
  agentVersion,
}: {
  spans: readonly SpanView[]
  agentVersion: string | null
}) {
  const t = useT()
  const manifest = React.useMemo(() => findRunManifest(spans), [spans])
  const rows = manifest ? buildRows(manifest, t) : []
  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="run-manifest-card"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('agent_orchestrator.traces.detail.manifest.title')}</h2>
      </div>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-3">
        {agentVersion ? (
          <>
            <dt className="text-muted-foreground">{t('agent_orchestrator.traces.detail.manifest.agentVersion')}</dt>
            <dd className="min-w-0 sm:col-span-2">
              <MonoValue>{agentVersion}</MonoValue>
            </dd>
          </>
        ) : null}
        {rows.map((row) => (
          <React.Fragment key={row.key}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 sm:col-span-2">{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {manifest ? null : (
        <p className="mt-2 text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.manifest.notRecorded')}</p>
      )}
    </section>
  )
}
