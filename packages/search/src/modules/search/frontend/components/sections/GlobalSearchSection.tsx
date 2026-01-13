'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type GlobalSearchSectionProps = {
  loading: boolean
  saving: boolean
  strategies: Set<string>
  fulltextConfigured: boolean
  vectorConfigured: boolean
  onToggleStrategy: (strategyId: string) => void
}

export function GlobalSearchSection({
  loading,
  saving,
  strategies,
  fulltextConfigured,
  vectorConfigured,
  onToggleStrategy,
}: GlobalSearchSectionProps) {
  const t = useT()

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold mb-2">
        {t('search.settings.globalSearch.title', 'Global Search (Cmd+K)')}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t('search.settings.globalSearch.description', 'Configure which search methods are used when searching with Cmd+K.')}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner size="sm" />
          <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Full-Text Search Toggle */}
          <label
            className={`flex items-start gap-3 p-3 rounded-md border border-border hover:bg-muted/50 cursor-pointer transition-colors ${saving ? 'opacity-60' : ''}`}
          >
            <input
              type="checkbox"
              checked={strategies.has('fulltext')}
              onChange={() => onToggleStrategy('fulltext')}
              disabled={saving || (strategies.has('fulltext') && strategies.size === 1)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {t('search.settings.globalSearch.fulltext', 'Full-Text Search')}
                </span>
                {!fulltextConfigured && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    {t('search.settings.globalSearch.notConfigured', '(Not configured)')}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('search.settings.globalSearch.fulltextDescription', 'Fast, typo-tolerant search across all text fields.')}
              </p>
            </div>
          </label>

          {/* Semantic Search Toggle */}
          <label
            className={`flex items-start gap-3 p-3 rounded-md border border-border hover:bg-muted/50 cursor-pointer transition-colors ${saving ? 'opacity-60' : ''}`}
          >
            <input
              type="checkbox"
              checked={strategies.has('vector')}
              onChange={() => onToggleStrategy('vector')}
              disabled={saving || (strategies.has('vector') && strategies.size === 1)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {t('search.settings.globalSearch.vector', 'Semantic Search (AI)')}
                </span>
                {!vectorConfigured && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    {t('search.settings.globalSearch.notConfigured', '(Not configured)')}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('search.settings.globalSearch.vectorDescription', 'AI-powered search that understands meaning and finds related content.')}
              </p>
            </div>
          </label>

          {/* Keyword Search Toggle */}
          <label
            className={`flex items-start gap-3 p-3 rounded-md border border-border hover:bg-muted/50 cursor-pointer transition-colors ${saving ? 'opacity-60' : ''}`}
          >
            <input
              type="checkbox"
              checked={strategies.has('tokens')}
              onChange={() => onToggleStrategy('tokens')}
              disabled={saving || (strategies.has('tokens') && strategies.size === 1)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <span className="font-medium">
                {t('search.settings.globalSearch.tokens', 'Keyword Search')}
              </span>
              <p className="text-sm text-muted-foreground">
                {t('search.settings.globalSearch.tokensDescription', 'Exact word matching in the database.')}
              </p>
            </div>
          </label>
        </div>
      )}
    </div>
  )
}
