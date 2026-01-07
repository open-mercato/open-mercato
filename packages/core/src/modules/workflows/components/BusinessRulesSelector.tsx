'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Plus, Loader2, AlertCircle } from 'lucide-react'

export interface BusinessRule {
  id: string
  ruleId: string
  ruleName: string
  description: string | null
  ruleType: string
  ruleCategory: string | null
  entityType: string
  eventType: string | null
  enabled: boolean
}

export interface BusinessRulesSelectorProps {
  /** Whether the dialog is open */
  isOpen: boolean

  /** Callback when dialog is closed */
  onClose: () => void

  /** Callback when a rule is selected */
  onSelect: (ruleId: string, rule: BusinessRule) => void

  /** Array of rule IDs to exclude from the list (already selected) */
  excludeRuleIds?: string[]

  /** Dialog title */
  title?: string

  /** Dialog description */
  description?: string

  /** Filter rules by entity type */
  filterEntityType?: string

  /** Filter rules by rule type */
  filterRuleType?: string

  /** Filter rules by category */
  filterCategory?: string

  /** Whether to show only enabled rules */
  onlyEnabled?: boolean

  /** Custom empty state message */
  emptyMessage?: string

  /** Custom search placeholder */
  searchPlaceholder?: string
}

/**
 * BusinessRulesSelector - Reusable dialog for searching and selecting business rules
 *
 * Features:
 * - Search/filter business rules by name, ID, type, category, description
 * - Filter by entity type, rule type, category
 * - Display rule details (badges, description)
 * - Exclude already-selected rules
 * - Loading and error states
 * - Responsive grid layout
 */
export function BusinessRulesSelector({
  isOpen,
  onClose,
  onSelect,
  excludeRuleIds = [],
  title = 'Select Business Rule',
  description = 'Choose a business rule from the list',
  filterEntityType,
  filterRuleType,
  filterCategory,
  onlyEnabled = false,
  emptyMessage,
  searchPlaceholder = 'Search by name, ID, type, category, or description...',
}: BusinessRulesSelectorProps) {
  const [businessRules, setBusinessRules] = useState<BusinessRule[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch business rules on mount
  useEffect(() => {
    if (isOpen) {
      fetchBusinessRules()
    }
  }, [isOpen])

  const fetchBusinessRules = async () => {
    setLoading(true)
    setError(null)
    try {
      // Build query params - only include defined values
      const params = new URLSearchParams()
      params.set('pageSize', '100') // Max allowed by API (business_rules route has max 100)

      if (filterEntityType) {
        params.set('entityType', filterEntityType)
      }
      if (filterRuleType) {
        params.set('ruleType', filterRuleType)
      }
      if (filterCategory) {
        params.set('ruleCategory', filterCategory) // Correct parameter name
      }
      if (onlyEnabled) {
        params.set('enabled', 'true')
      }

      const url = `/api/business_rules/rules?${params.toString()}`
      const response = await apiFetch(url)

      if (response.ok) {
        const data = await response.json()
        setBusinessRules(data.items || [])
      } else {
        let errorMessage = `Failed to load business rules (${response.status})`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch {
          // If response is not JSON, use status code message
          errorMessage = `Failed to load business rules (${response.status})`
        }
        console.error('Failed to fetch business rules:', {
          url,
          status: response.status,
          error: errorMessage,
        })
        setError(errorMessage)
      }
    } catch (err) {
      console.error('Failed to fetch business rules:', err)
      const errorMessage = err instanceof Error ? err.message : 'Network error loading business rules'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // Filter rules based on search query and exclusions
  const getFilteredRules = (): BusinessRule[] => {
    return businessRules
      .filter(rule => !excludeRuleIds.includes(rule.ruleId))
      .filter(rule => {
        if (!searchQuery) return true
        const query = searchQuery.toLowerCase()
        return (
          rule.ruleName.toLowerCase().includes(query) ||
          rule.ruleId.toLowerCase().includes(query) ||
          rule.description?.toLowerCase().includes(query) ||
          rule.ruleType.toLowerCase().includes(query) ||
          rule.ruleCategory?.toLowerCase().includes(query) ||
          rule.entityType.toLowerCase().includes(query)
        )
      })
  }

  const handleSelect = (rule: BusinessRule) => {
    onSelect(rule.ruleId, rule)
    setSearchQuery('') // Clear search on select
  }

  const handleClose = () => {
    setSearchQuery('')
    onClose()
  }

  const filteredRules = getFilteredRules()

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Search Input */}
        <div className="px-6">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
            disabled={loading}
          />
        </div>

        {/* Rules List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-[400px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground text-sm">Loading business rules...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-16 w-16 text-destructive mb-4" />
              <p className="text-destructive text-sm font-medium mb-2">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchBusinessRules}
              >
                Retry
              </Button>
            </div>
          ) : filteredRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <svg className="w-16 h-16 text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-muted-foreground text-sm mb-2">
                {emptyMessage || (
                  searchQuery
                    ? 'No business rules found matching your search'
                    : businessRules.length === 0
                    ? 'No business rules exist yet'
                    : 'All business rules have already been added'
                )}
              </p>
              <p className="text-muted-foreground text-xs mb-3">
                {businessRules.length === 0
                  ? 'Create business rules in the Business Rules module first'
                  : searchQuery
                  ? `Showing 0 of ${businessRules.length} total rules`
                  : `${businessRules.length} rules already added`
                }
              </p>
              {searchQuery && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                >
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="mb-3 text-sm text-muted-foreground">
                {filteredRules.length} rule{filteredRules.length !== 1 ? 's' : ''} available
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredRules.map((rule) => (
                  <button
                    key={rule.id}
                    onClick={() => handleSelect(rule)}
                    className="text-left p-4 border-2 border-border rounded-lg hover:border-primary hover:bg-accent transition-all group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold group-hover:text-primary truncate">
                          {rule.ruleName}
                        </h4>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                          {rule.ruleId}
                        </p>
                      </div>
                      <Plus className="size-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                    </div>

                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {rule.ruleType}
                      </Badge>
                      {rule.ruleCategory && (
                        <Badge variant="outline" className="text-xs">
                          {rule.ruleCategory}
                        </Badge>
                      )}
                      {rule.enabled ? (
                        <Badge variant="default" className="bg-emerald-500 text-xs">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          Disabled
                        </Badge>
                      )}
                    </div>

                    {rule.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                        {rule.description}
                      </p>
                    )}

                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="font-medium">Entity:</span>
                        <span className="font-mono text-xs">{rule.entityType}</span>
                      </div>
                      {rule.eventType && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Event:</span>
                          <span>{rule.eventType}</span>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
