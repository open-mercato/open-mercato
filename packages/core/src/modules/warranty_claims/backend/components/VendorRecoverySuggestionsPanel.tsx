"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type VendorRecoveryClaim = {
  id: string
  claimType: string | null
  status: string | null
}

type VendorRecoverySuggestion = {
  lineId: string
  vendorName: string
  policyId: string
  recoveryRatePct: string | null
  causalFault: string | null
  estimatedRecovery: string | null
}

type SuggestionsResponse = {
  ok?: boolean
  result?: {
    claimId?: string
    suggestions?: VendorRecoverySuggestion[]
  }
}

type SuggestionGroup = {
  id: string
  vendorName: string
  suggestions: VendorRecoverySuggestion[]
}

type VendorRecoverySuggestionsPanelProps = {
  claim: VendorRecoveryClaim
  canManage: boolean
  onGenerateSupplierRecovery: (input: { lineIds: string[]; vendorName: string }) => Promise<void>
}

function groupSuggestions(suggestions: VendorRecoverySuggestion[]): SuggestionGroup[] {
  const byVendor = new Map<string, SuggestionGroup>()
  for (const suggestion of suggestions) {
    const key = suggestion.vendorName.trim()
    if (!key) continue
    const current = byVendor.get(key)
    if (current) {
      current.suggestions.push(suggestion)
      continue
    }
    byVendor.set(key, {
      id: key,
      vendorName: key,
      suggestions: [suggestion],
    })
  }
  return Array.from(byVendor.values())
}

export function VendorRecoverySuggestionsPanel({
  claim,
  canManage,
  onGenerateSupplierRecovery,
}: VendorRecoverySuggestionsPanelProps) {
  const t = useT()
  const [suggestions, setSuggestions] = React.useState<VendorRecoverySuggestion[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [generatingVendor, setGeneratingVendor] = React.useState<string | null>(null)

  const eligible = canManage
    && claim.claimType === 'warranty'
    && (claim.status === 'resolved' || claim.status === 'closed')

  React.useEffect(() => {
    if (!eligible) {
      setSuggestions([])
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    readApiResultOrThrow<SuggestionsResponse>(
      `/api/warranty_claims/vendor-recovery-suggestions?claimId=${encodeURIComponent(claim.id)}`,
      undefined,
      {
        fallback: { ok: true, result: { claimId: claim.id, suggestions: [] } },
        errorMessage: t('warranty_claims.vendorRecoverySuggestions.error.load', 'Failed to load supplier recovery suggestions.'),
      },
    )
      .then((payload) => {
        if (cancelled) return
        setSuggestions(Array.isArray(payload.result?.suggestions) ? payload.result.suggestions : [])
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error && err.message
          ? err.message
          : t('warranty_claims.vendorRecoverySuggestions.error.load', 'Failed to load supplier recovery suggestions.')
        setError(message)
        flash(message, 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [claim.id, eligible, t])

  if (!eligible) return null

  const groups = groupSuggestions(suggestions)

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t('warranty_claims.vendorRecoverySuggestions.loading', 'Loading supplier recovery suggestions...')}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <ErrorMessage label={error} />
      </div>
    )
  }

  if (!groups.length) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t('warranty_claims.vendorRecoverySuggestions.title', 'Supplier recovery suggestions')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('warranty_claims.vendorRecoverySuggestions.description', 'Resolved warranty lines match active supplier recovery policies.')}
          </p>
        </div>
        <StatusBadge variant="info">
          {t('warranty_claims.vendorRecoverySuggestions.count', '{count} suggested', { count: suggestions.length })}
        </StatusBadge>
      </div>
      <div className="mt-3 space-y-3">
        {groups.map((group) => (
          <div key={group.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{group.vendorName}</div>
                <div className="mt-2 space-y-2">
                  {group.suggestions.map((suggestion) => (
                    <div key={`${suggestion.policyId}:${suggestion.lineId}`} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {t('warranty_claims.vendorRecoverySuggestions.line', 'Line {lineId}', { lineId: suggestion.lineId })}
                      </span>
                      {suggestion.causalFault ? (
                        <span>
                          {' '}
                          {t('warranty_claims.vendorRecoverySuggestions.causalFault', 'Fault: {fault}', {
                            fault: suggestion.causalFault,
                          })}
                        </span>
                      ) : null}
                      {suggestion.estimatedRecovery ? (
                        <span>
                          {' '}
                          {t('warranty_claims.vendorRecoverySuggestions.estimatedRecovery', 'Estimated recovery: {amount}', {
                            amount: suggestion.estimatedRecovery,
                          })}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={generatingVendor !== null}
                onClick={() => {
                  setGeneratingVendor(group.vendorName)
                  void onGenerateSupplierRecovery({
                    lineIds: group.suggestions.map((suggestion) => suggestion.lineId),
                    vendorName: group.vendorName,
                  }).finally(() => setGeneratingVendor(null))
                }}
              >
                {generatingVendor === group.vendorName ? <Spinner size="sm" /> : null}
                {t('warranty_claims.vendorRecoverySuggestions.actions.generate', 'Generate supplier recovery')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
