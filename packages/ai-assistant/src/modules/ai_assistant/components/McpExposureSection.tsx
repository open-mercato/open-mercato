'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Badge } from '@open-mercato/ui/primitives/badge'

type McpMutationMode = 'direct' | 'deny' | 'approval'

type McpHiddenReason =
  | 'expose_false'
  | 'denylist'
  | 'not_allowlisted'
  | 'mutation_mode'
  | 'agent_tools_off'
  | 'agent_unavailable'

export type McpExposureTool = {
  name: string
  module: string
  exposed: boolean
  hiddenReason: McpHiddenReason | null
  isMutation: boolean
  agentRef: { agentId: string; engine: string } | null
}

export type McpExposureView = {
  mutationMode: McpMutationMode
  allowlist: string[] | null
  denylist: string[]
  agentToolsEnabled: boolean
  tools: McpExposureTool[]
}

type TranslateFn = ReturnType<typeof useT>

async function fetchMcpExposure(): Promise<McpExposureView> {
  const result = await apiCall<McpExposureView>('/api/ai_assistant/tools?view=mcp')
  if (!result.ok || !result.result) throw new Error('[internal] Failed to fetch MCP exposure')
  return result.result
}

function mutationModeLabel(t: TranslateFn, mode: McpMutationMode): string {
  switch (mode) {
    case 'deny':
      return t('ai_assistant.mcp.exposure.mutationMode.deny', 'Deny: mutation tools are hidden and refused')
    case 'approval':
      return t('ai_assistant.mcp.exposure.mutationMode.approval', 'Approval: mutation calls wait for human approval')
    default:
      return t('ai_assistant.mcp.exposure.mutationMode.direct', 'Direct: mutation tools run without approval')
  }
}

function hiddenReasonLabel(t: TranslateFn, reason: McpHiddenReason | null): string {
  switch (reason) {
    case 'expose_false':
      return t('ai_assistant.mcp.exposure.hiddenReason.exposeFalse', 'Opted out of MCP by the tool')
    case 'denylist':
      return t('ai_assistant.mcp.exposure.hiddenReason.denylist', 'Matched by the denylist')
    case 'not_allowlisted':
      return t('ai_assistant.mcp.exposure.hiddenReason.notAllowlisted', 'Not on the allowlist')
    case 'mutation_mode':
      return t('ai_assistant.mcp.exposure.hiddenReason.mutationMode', 'Hidden by the mutation mode')
    case 'agent_tools_off':
      return t('ai_assistant.mcp.exposure.hiddenReason.agentToolsOff', 'Agent tools are disabled')
    case 'agent_unavailable':
      return t('ai_assistant.mcp.exposure.hiddenReason.agentUnavailable', 'The agent is unavailable')
    default:
      return t('ai_assistant.mcp.exposure.hidden', 'Hidden')
  }
}

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value}</dd>
    </div>
  )
}

export function McpExposureSectionContent({ view }: { view: McpExposureView }) {
  const t = useT()
  const none = t('ai_assistant.mcp.exposure.listNone', 'None')
  return (
    <div className="space-y-4">
      <dl className="space-y-2 rounded-md border bg-muted/30 p-3">
        <ConfigRow
          label={t('ai_assistant.mcp.exposure.mutationModeLabel', 'Mutation mode')}
          value={mutationModeLabel(t, view.mutationMode)}
        />
        <ConfigRow
          label={t('ai_assistant.mcp.exposure.allowlistLabel', 'Allowlist')}
          value={
            view.allowlist === null
              ? t('ai_assistant.mcp.exposure.allowlistAll', 'All tools')
              : view.allowlist.length > 0
                ? <code className="text-xs">{view.allowlist.join(', ')}</code>
                : none
          }
        />
        <ConfigRow
          label={t('ai_assistant.mcp.exposure.denylistLabel', 'Denylist')}
          value={view.denylist.length > 0 ? <code className="text-xs">{view.denylist.join(', ')}</code> : none}
        />
        <ConfigRow
          label={t('ai_assistant.mcp.exposure.agentToolsLabel', 'Agent tools')}
          value={
            view.agentToolsEnabled
              ? t('ai_assistant.mcp.exposure.agentToolsOn', 'Enabled')
              : t('ai_assistant.mcp.exposure.agentToolsOff', 'Disabled')
          }
        />
      </dl>
      {view.tools.length === 0 ? (
        <EmptyState title={t('ai_assistant.mcp.exposure.empty', 'No tools are available to you.')} />
      ) : (
        <ul className="divide-y rounded-md border">
          {view.tools.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              data-mcp-exposure-tool={tool.name}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{tool.name}</p>
                <p className="text-xs text-muted-foreground">{tool.module}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {tool.agentRef ? (
                  <Badge variant="outline" title={tool.agentRef.agentId}>
                    {t('ai_assistant.mcp.exposure.agentTool', 'Agent')}
                  </Badge>
                ) : null}
                {tool.isMutation ? (
                  <Badge variant="outline">{t('ai_assistant.mcp.exposure.mutationTool', 'Mutation')}</Badge>
                ) : null}
                {tool.exposed ? (
                  <StatusBadge variant="success" dot>
                    {t('ai_assistant.mcp.exposure.exposed', 'Exposed')}
                  </StatusBadge>
                ) : (
                  <StatusBadge variant="neutral" dot>
                    {hiddenReasonLabel(t, tool.hiddenReason)}
                  </StatusBadge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function McpExposureSection() {
  const t = useT()
  const exposureQuery = useQuery({
    queryKey: ['ai-assistant', 'tools', 'mcp-exposure'],
    queryFn: fetchMcpExposure,
    staleTime: 60000,
  })
  const view = exposureQuery.data
  const exposedCount = view ? view.tools.filter((tool) => tool.exposed).length : undefined

  return (
    <div className="rounded-lg border bg-card p-6" data-ai-assistant-mcp-exposure="">
      <CollapsibleSection
        title={t('ai_assistant.mcp.exposure.title', 'MCP exposure')}
        count={exposedCount}
        defaultCollapsed
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t(
              'ai_assistant.mcp.exposure.description',
              'Tools you can use and whether an MCP client sees them, as resolved by this app from the OM_MCP_* environment variables. An MCP server started with its own CLI flags can differ.',
            )}
          </p>
          {exposureQuery.isLoading ? (
            <LoadingMessage label={t('ai_assistant.mcp.exposure.loading', 'Loading MCP exposure...')} />
          ) : exposureQuery.isError || !view ? (
            <ErrorMessage label={t('ai_assistant.mcp.exposure.error', 'Failed to load MCP exposure.')} />
          ) : (
            <McpExposureSectionContent view={view} />
          )}
        </div>
      </CollapsibleSection>
    </div>
  )
}

export default McpExposureSection
