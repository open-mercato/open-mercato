"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Users, Trash2, Loader2, ArrowUpRightSquare } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { SectionAction, TabEmptyState, Translator } from './types'
import { useT } from '@/lib/i18n/context'
import { formatDate, formatTemplate } from './utils'

export type CompanyPersonSummary = {
  id: string
  displayName: string
  primaryEmail?: string | null
  primaryPhone?: string | null
  status?: string | null
  lifecycleStage?: string | null
  jobTitle?: string | null
  department?: string | null
  createdAt?: string | null
  organizationId?: string | null
}

export type CompanyPeopleSectionProps = {
  companyId: string
  initialPeople: CompanyPersonSummary[]
  addActionLabel: string
  emptyLabel: string
  emptyState: TabEmptyState
  onPeopleChange?: (next: CompanyPersonSummary[]) => void
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
  onLoadingChange?: (isLoading: boolean) => void
}

export function CompanyPeopleSection({
  companyId,
  initialPeople,
  addActionLabel,
  emptyLabel,
  emptyState,
  onPeopleChange,
  onActionChange,
  translator,
  onLoadingChange,
}: CompanyPeopleSectionProps) {
  const router = useRouter()
  const tHook = useT()
  const translate = React.useMemo<Translator>(
    () =>
      translator ??
      ((key, fallback, params) => {
        const value = tHook(key, params)
        if (value !== key) return value
        if (!fallback) return key
        return formatTemplate(fallback, params)
      }),
    [translator, tHook],
  )
  const [people, setPeople] = React.useState<CompanyPersonSummary[]>(initialPeople)
  const [removingId, setRemovingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const action: SectionAction = {
      label: addActionLabel,
      onClick: () => {
        router.push(`/backend/customers/people/create?companyId=${encodeURIComponent(companyId)}`)
      },
    }
    onActionChange?.(action)
    return () => {
      onActionChange?.(null)
    }
  }, [addActionLabel, companyId, onActionChange, router])

  React.useEffect(() => {
    setPeople(initialPeople)
  }, [initialPeople])

  const handleRemove = React.useCallback(
    async (personId: string) => {
      if (!personId || removingId) return
      setRemovingId(personId)
      onLoadingChange?.(true)
      try {
        const res = await apiFetch('/api/customers/people', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: personId, companyEntityId: null }),
        })
        if (!res.ok) {
          const details = await res.json().catch(() => ({}))
          const message =
            typeof details?.error === 'string'
              ? details.error
              : translate('customers.companies.detail.people.removeError', 'Failed to unlink person from company.')
          throw new Error(message)
        }
        setPeople((prev) => {
          const next = prev.filter((entry) => entry.id !== personId)
          onPeopleChange?.(next)
          return next
        })
        flash(translate('customers.companies.detail.people.removeSuccess', 'Person unlinked from company.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : translate('customers.companies.detail.people.removeError', 'Failed to unlink person from company.')
        flash(message, 'error')
      } finally {
        setRemovingId(null)
        onLoadingChange?.(false)
      }
    },
    [onLoadingChange, onPeopleChange, removingId, translate],
  )

  if (!people.length) {
    return (
      <EmptyState
        icon={<Users className="h-10 w-10 text-muted-foreground" />}
        title={emptyState.title}
        actionLabel={emptyState.actionLabel}
        onAction={() => router.push(`/backend/customers/people/create?companyId=${encodeURIComponent(companyId)}`)}
      >
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded border bg-muted/20">
        {people.map((person) => (
          <div
            key={person.id}
            className="flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">{person.displayName}</p>
                {person.jobTitle ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {person.jobTitle}
                  </span>
                ) : null}
                {person.status ? (
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {person.status}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {person.primaryEmail ? <span>{person.primaryEmail}</span> : null}
                {person.primaryPhone ? <span>{person.primaryPhone}</span> : null}
                {person.lifecycleStage ? <span>{person.lifecycleStage}</span> : null}
                {(() => {
                  const linkedDate = formatDate(person.createdAt ?? null)
                  return linkedDate
                    ? (
                      <span>
                        {translate('customers.companies.detail.people.linkedOn', 'Linked on {{date}}', {
                          date: linkedDate,
                        })}
                      </span>
                    )
                    : null
                })()}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push(`/backend/customers/people/${encodeURIComponent(person.id)}`)}
              >
                <ArrowUpRightSquare className="mr-1.5 h-4 w-4" />
                {translate('customers.companies.detail.people.open', 'Open person')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(person.id)}
                disabled={removingId === person.id}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {removingId === person.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                {translate('customers.companies.detail.people.remove', 'Unlink')}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {translate(
          'customers.companies.detail.people.helper',
          'People linked to this company appear here and can be opened or unlinked without leaving the page.',
        )}
      </p>
    </div>
  )
}

export default CompanyPeopleSection
