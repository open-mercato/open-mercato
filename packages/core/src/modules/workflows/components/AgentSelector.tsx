'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Bot, Loader2, Plus } from 'lucide-react'

/**
 * Agent registry entry as returned by `/api/agent_orchestrator/agents`.
 * agent_orchestrator is an optional peer module — when it is not installed the
 * endpoint 404s and the list stays empty.
 */
export interface AgentListItem {
  id: string
  label: string
  description: string
  runtime?: string
  resultKind?: string
}

type AgentsResponse = { items?: AgentListItem[] }

export interface AgentSelectorProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (agentId: string, agent: AgentListItem) => void
  title?: string
  description?: string
}

function normalizeAgents(items: AgentListItem[] | undefined): AgentListItem[] {
  if (!Array.isArray(items)) return []
  return items.filter((item) => typeof item?.id === 'string' && item.id.length > 0)
}

/**
 * AgentSelector - Searchable dialog for picking an agent from the registry.
 *
 * Mirrors WorkflowSelector: client-side search over id, label and description,
 * card list with runtime/result-kind badges, loading and empty states.
 */
export function AgentSelector({ isOpen, onClose, onSelect, title, description }: AgentSelectorProps) {
  const t = useT()
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    apiCall<AgentsResponse>('/api/agent_orchestrator/agents', undefined, { fallback: { items: [] } })
      .then((res) => {
        if (cancelled) return
        setAgents(res.ok ? normalizeAgents(res.result?.items) : [])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const handleClose = useCallback(() => {
    setSearchQuery('')
    onClose()
  }, [onClose])

  const query = searchQuery.trim().toLowerCase()
  const filteredAgents = query
    ? agents.filter((agent) =>
        [agent.id, agent.label, agent.description]
          .filter((part): part is string => typeof part === 'string')
          .some((part) => part.toLowerCase().includes(query)),
      )
    : agents

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title ?? t('workflows.fieldEditors.agentSelector.selectAgent')}</DialogTitle>
          <DialogDescription>
            {description ?? t('workflows.fieldEditors.agentSelector.selectAgentDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('workflows.fieldEditors.agentSelector.searchPlaceholder')}
            autoFocus
            disabled={loading}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-[320px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="size-10 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground text-sm">{t('workflows.fieldEditors.agentSelector.loading')}</p>
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Bot className="size-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-sm mb-2">
                {query
                  ? t('workflows.fieldEditors.agentSelector.noMatches')
                  : t('workflows.fieldEditors.agentSelector.noAgents')}
              </p>
              {query ? (
                <Button variant="link" size="sm" onClick={() => setSearchQuery('')}>
                  {t('workflows.fieldEditors.agentSelector.clearSearch')}
                </Button>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {t('workflows.fieldEditors.agentSelector.noAgentsHint')}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    onSelect(agent.id, agent)
                    setSearchQuery('')
                  }}
                  className="text-left p-4 border-2 border-border rounded-lg hover:border-primary hover:bg-accent transition-all group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold group-hover:text-primary truncate">
                        {agent.label || agent.id}
                      </h4>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{agent.id}</p>
                    </div>
                    <Plus className="size-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                  </div>

                  {(agent.runtime || agent.resultKind) && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {agent.runtime && (
                        <Badge variant="secondary" className="text-xs">
                          {agent.runtime}
                        </Badge>
                      )}
                      {agent.resultKind && (
                        <Badge variant="outline" className="text-xs">
                          {agent.resultKind}
                        </Badge>
                      )}
                    </div>
                  )}

                  {agent.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {t('workflows.common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
