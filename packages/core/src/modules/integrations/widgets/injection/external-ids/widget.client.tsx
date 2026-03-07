"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { ExternalIdMapping } from '@open-mercato/shared/modules/integrations/types'
import { getIntegrationTitle } from '@open-mercato/shared/modules/integrations/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

type IntegrationsData = Record<string, ExternalIdMapping>

const SYNC_STATUS_STYLES: Record<ExternalIdMapping['syncStatus'], { dot: string; label: string }> = {
  synced: { dot: 'bg-green-500', label: 'integrations.syncStatus.synced' },
  pending: { dot: 'bg-yellow-500', label: 'integrations.syncStatus.pending' },
  error: { dot: 'bg-red-500', label: 'integrations.syncStatus.error' },
  not_synced: { dot: 'bg-gray-400', label: 'integrations.syncStatus.notSynced' },
}

function SyncStatusBadge({ status, lastSynced }: { status: ExternalIdMapping['syncStatus']; lastSynced?: string }) {
  const t = useT()
  const config = SYNC_STATUS_STYLES[status]
  const label = t(config.label, status)

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className={cn('inline-block size-1.5 rounded-full', config.dot)} aria-hidden="true" />
      <span>{label}</span>
      {lastSynced && (
        <span title={lastSynced}>
          {new Date(lastSynced).toLocaleDateString()}
        </span>
      )}
    </span>
  )
}

function ExternalLinkIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6.5 3.5H3a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 2h4.5v4.5M14 2 7.5 8.5" />
    </svg>
  )
}

export default function ExternalIdsWidget({ data }: InjectionWidgetComponentProps) {
  const t = useT()
  const integrations = (data as Record<string, unknown>)?._integrations as IntegrationsData | undefined

  if (!integrations || Object.keys(integrations).length === 0) return null

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">
        {t('integrations.externalIds.title', 'External IDs')}
      </h3>
      <div className="space-y-2">
        {Object.entries(integrations).map(([integrationId, mapping]) => (
          <div
            key={integrationId}
            className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium truncate">
                {getIntegrationTitle(integrationId)}
              </span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                {mapping.externalId}
              </code>
              {mapping.externalUrl && (
                <a
                  href={mapping.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t('integrations.externalIds.openExternal', 'Open in external system')}
                >
                  <ExternalLinkIcon />
                </a>
              )}
            </div>
            <SyncStatusBadge status={mapping.syncStatus} lastSynced={mapping.lastSyncedAt} />
          </div>
        ))}
      </div>
    </div>
  )
}

ExternalIdsWidget.metadata = {
  id: 'integrations.injection.external-ids',
  title: 'External IDs',
  features: ['integrations.view'],
}
