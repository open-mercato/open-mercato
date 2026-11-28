"use client"

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useLiveRefetch } from '@open-mercato/ui/backend/injection/useLiveRefetch'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import type { SectionAction, TabEmptyStateConfig, Translator } from './types'
import { CreatePersonDialog } from './CreatePersonDialog'
import { coerceDisplayName } from '../../lib/displayName'
import { DecisionMakersFooter } from './DecisionMakersFooter'
import { EndEmploymentDialog } from './EndEmploymentDialog'
import { FormerEmployeesSection } from './FormerEmployeesSection'
import { RolesSection } from './RolesSection'
import {
  LinkedPeopleSection,
  type LinkedPeoplePage,
  type LinkedPeopleSortMode,
  type LinkedPersonSummary,
} from './LinkedPeopleSection'
import type { LinkEntityOption } from '../linking/LinkEntityDialog'
import { createPersonLinkAdapter } from '../linking/adapters/personAdapter'

type GuardedMutationRunner = <T>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export type CompanyPersonSummary = LinkedPersonSummary

type EmploymentEndTarget = Pick<CompanyPersonSummary, 'id' | 'displayName'> & { updatedAt: string }

export type CompanyPeopleSectionProps = {
  companyId: string
  companyName?: string
  initialPeople: CompanyPersonSummary[]
  activePeopleCount?: number
  addActionLabel: string
  emptyLabel: string
  emptyState: TabEmptyStateConfig
  onPeopleChange?: (next: CompanyPersonSummary[]) => void
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
  onLoadingChange?: (isLoading: boolean) => void
  onDataRefresh?: () => Promise<void> | void
  runGuardedMutation?: GuardedMutationRunner
}

function normalizeCompanyPerson(record: Record<string, unknown>): CompanyPersonSummary | null {
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? record.display_name.trim()
        : null
  if (!displayName) return null
  return {
    id,
    displayName,
    primaryEmail:
      typeof record.primaryEmail === 'string'
        ? record.primaryEmail
        : typeof record.primary_email === 'string'
          ? record.primary_email
          : null,
    primaryPhone:
      typeof record.primaryPhone === 'string'
        ? record.primaryPhone
        : typeof record.primary_phone === 'string'
          ? record.primary_phone
          : null,
    status:
      typeof record.status === 'string'
        ? record.status
        : null,
    lifecycleStage:
      typeof record.lifecycleStage === 'string'
        ? record.lifecycleStage
        : typeof record.lifecycle_stage === 'string'
          ? record.lifecycle_stage
          : null,
    jobTitle:
      typeof record.jobTitle === 'string'
        ? record.jobTitle
        : typeof record.job_title === 'string'
          ? record.job_title
          : null,
    department:
      typeof record.department === 'string'
        ? record.department
        : null,
    createdAt:
      typeof record.createdAt === 'string'
        ? record.createdAt
        : typeof record.created_at === 'string'
          ? record.created_at
          : null,
    organizationId:
      typeof record.organizationId === 'string'
        ? record.organizationId
        : typeof record.organization_id === 'string'
          ? record.organization_id
          : null,
    temperature:
      typeof record.temperature === 'string'
        ? record.temperature
        : null,
    source:
      typeof record.source === 'string'
        ? record.source
        : null,
    linkedAt:
      typeof record.linkedAt === 'string'
        ? record.linkedAt
        : typeof record.linked_at === 'string'
          ? record.linked_at
          : null,
  }
}

function mergeCompanyPeople(items: CompanyPersonSummary[]): CompanyPersonSummary[] {
  const merged = new Map<string, CompanyPersonSummary>()
  items.forEach((item) => merged.set(item.id, item))
  return Array.from(merged.values())
}

function matchesCompanyPersonSearch(person: CompanyPersonSummary, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery.length) return true
  const haystack = [
    person.displayName,
    person.jobTitle ?? '',
    person.primaryEmail ?? '',
    person.primaryPhone ?? '',
    person.department ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(normalizedQuery)
}

function sortCompanyPeople(
  items: CompanyPersonSummary[],
  sortMode: LinkedPeopleSortMode,
): CompanyPersonSummary[] {
  return [...items].sort((left, right) => {
    if (sortMode === 'recent') {
      const leftTimestamp = Date.parse(left.linkedAt ?? left.createdAt ?? '') || 0
      const rightTimestamp = Date.parse(right.linkedAt ?? right.createdAt ?? '') || 0
      return rightTimestamp - leftTimestamp
    }
    const leftLabel = coerceDisplayName(left.displayName).trim().toLowerCase()
    const rightLabel = coerceDisplayName(right.displayName).trim().toLowerCase()
    if (sortMode === 'name-desc') return rightLabel.localeCompare(leftLabel)
    return leftLabel.localeCompare(rightLabel)
  })
}

export function CompanyPeopleSection({
  companyId,
  companyName,
  initialPeople,
  activePeopleCount,
  addActionLabel,
  emptyLabel,
  emptyState,
  onPeopleChange,
  onActionChange,
  translator,
  onLoadingChange,
  onDataRefresh,
  runGuardedMutation,
}: CompanyPeopleSectionProps) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(
    () => createTranslatorWithFallback(tHook),
    [tHook],
  )
  const translate: Translator = translator ?? fallbackTranslator
  const { payload: chrome } = useBackendChrome()
  const canEndEmployment = hasFeature(chrome?.grantedFeatures ?? [], 'customers.people.manage')
  const canViewEmploymentHistory = hasFeature(chrome?.grantedFeatures ?? [], 'customers.people.view')
  const [people, setPeople] = React.useState<CompanyPersonSummary[]>(initialPeople)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false)
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [historyRefreshKey, setHistoryRefreshKey] = React.useState(0)
  const [endTarget, setEndTarget] = React.useState<EmploymentEndTarget | null>(null)
  const pendingPeopleChangeRef = React.useRef(false)

  const requestRefresh = React.useCallback(() => {
    setRefreshKey((current) => current + 1)
  }, [])

  const refreshPeopleAndHistory = React.useCallback(() => {
    requestRefresh()
    setHistoryRefreshKey((current) => current + 1)
    void onDataRefresh?.()
  }, [onDataRefresh, requestRefresh])

  const runWriteMutation = React.useCallback(
    async <T,>(
      operation: () => Promise<T>,
      mutationPayload?: Record<string, unknown>,
    ): Promise<T> => {
      if (!runGuardedMutation) {
        return operation()
      }
      return runGuardedMutation(operation, mutationPayload)
    },
    [runGuardedMutation],
  )

  React.useEffect(() => {
    onActionChange?.(null)
    return () => onActionChange?.(null)
  }, [onActionChange])

  React.useEffect(() => {
    pendingPeopleChangeRef.current = false
    setPeople(initialPeople)
  }, [initialPeople])

  React.useEffect(() => {
    if (!pendingPeopleChangeRef.current) return
    pendingPeopleChangeRef.current = false
    onPeopleChange?.(people)
  }, [onPeopleChange, people])

  const loadPage = React.useCallback(
    async ({
      page,
      pageSize,
      sort,
      search,
    }: {
      page: number
      pageSize: number
      sort: LinkedPeopleSortMode
      search: string
    }): Promise<LinkedPeoplePage> => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
      })
      if (search.length > 0) {
        params.set('search', search)
      }
      return readApiResultOrThrow<LinkedPeoplePage>(
        `/api/customers/companies/${encodeURIComponent(companyId)}/people?${params.toString()}`,
        undefined,
        {
          errorMessage: translate(
            'customers.companies.detail.people.loadError',
            'Failed to load people.',
          ),
        },
      )
    },
    [companyId, translate],
  )

  const isCompanyLinkEvent = React.useCallback((event: AppEventPayload) => {
    const payload = event.payload as { companyEntityId?: string | null } | null | undefined
    return payload?.companyEntityId === companyId
  }, [companyId])

  useLiveRefetch('customers.person_company_link.*', refreshPeopleAndHistory, { filter: isCompanyLinkEvent })
  // Legacy profile-only assignments have no link row, so their detach broadcasts this sibling
  // event instead of `customers.person_company_link.deleted` (#5114). Without it, other viewers
  // of the same company keep listing a person who is already gone.
  useAppEvent('customers.person.company_assignment.detached', (event) => {
    if (isCompanyLinkEvent(event)) refreshPeopleAndHistory()
  })

  const applyPeopleChange = React.useCallback(
    (updater: (current: CompanyPersonSummary[]) => CompanyPersonSummary[]) => {
      setPeople((current) => {
        const next = updater(current)
        if (next !== current) {
          pendingPeopleChangeRef.current = true
        }
        return next
      })
    },
    [],
  )

  const handleLinkConfirm = React.useCallback(
    async ({
      addedIds,
      optionsById,
    }: {
      addedIds: string[]
      optionsById: Record<string, LinkEntityOption>
    }) => {
      if (!addedIds.length) return
      try {
        for (const personId of addedIds) {
          await runWriteMutation(
            () =>
              // optimistic-lock-exempt: person-company link add/remove
              apiCallOrThrow(
                `/api/customers/people/${encodeURIComponent(personId)}/companies`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ companyId }),
                },
                {
                  errorMessage: translate(
                    'customers.companies.detail.people.linkError',
                    'Failed to link person to company.',
                  ),
                },
              ),
            {
              personId,
              companyId,
            },
          )
        }
        const optimisticPeople: CompanyPersonSummary[] = addedIds
          .map((personId): CompanyPersonSummary | null => {
            const option = optionsById[personId]
            if (!option) return null
            return {
              id: option.id,
              displayName: option.label,
              primaryEmail: null,
              primaryPhone: null,
              jobTitle: option.subtitle ?? null,
            }
          })
          .filter((entry): entry is CompanyPersonSummary => entry !== null)
        if (optimisticPeople.length > 0) {
          applyPeopleChange((current) => mergeCompanyPeople([...current, ...optimisticPeople]))
        }
        setHistoryRefreshKey((current) => current + 1)
        void onDataRefresh?.()
        flash(
          addedIds.length === 1
            ? translate(
                'customers.companies.detail.people.linkSuccess',
                'Person linked to company.',
              )
            : translate(
                'customers.companies.detail.people.linkSuccessMultiple',
                '{{count}} people linked to company.',
                { count: String(addedIds.length) },
              ),
          'success',
        )
      } catch (err) {
        requestRefresh()
        setHistoryRefreshKey((current) => current + 1)
        try {
          await onDataRefresh?.()
        } catch {
          // preserve original linking error for the user
        }
        const message =
          err instanceof Error
            ? err.message
            : translate(
                'customers.companies.detail.people.linkError',
                'Failed to link person to company.',
              )
        flash(message, 'error')
        throw err
      }
    },
    [applyPeopleChange, companyId, onDataRefresh, requestRefresh, runWriteMutation, translate],
  )

  const personLinkAdapter = React.useMemo(
    () =>
      createPersonLinkAdapter({
        dialogTitle: translate('customers.linking.person.dialogTitle', 'Link person'),
        dialogSubtitle: companyName
          ? translate(
              'customers.linking.person.dialogSubtitleFor',
              'Link an existing contact to {{name}}',
              { name: companyName },
            )
          : translate(
              'customers.linking.person.dialogSubtitle',
              'Link an existing contact to this company',
            ),
        sectionLabel: translate('customers.linking.person.sectionLabel', 'MATCHING CONTACTS'),
        searchPlaceholder: translate(
          'customers.linking.person.searchPlaceholder',
          'Search all people…',
        ),
        searchEmptyHint: translate(
          'customers.linking.person.searchEmpty',
          'No matching people found.',
        ),
        selectedEmptyHint: translate(
          'customers.linking.person.selectedEmpty',
          'No people selected.',
        ),
        confirmButtonLabel: translate('customers.linking.person.confirmButton', 'Link person'),
        showLinkSettings: true,
        roleOptions: [
          {
            id: 'decision_maker',
            label: translate('customers.linking.person.role.decisionMaker', 'Decision maker'),
          },
          {
            id: 'budget_holder',
            label: translate('customers.linking.person.role.budgetHolder', 'Budget holder'),
          },
          {
            id: 'stakeholder',
            label: translate('customers.linking.person.role.stakeholder', 'Stakeholder'),
          },
          {
            id: 'contact',
            label: translate('customers.linking.person.role.contact', 'Contact'),
          },
        ],
        allFilterLabel: translate('customers.linking.person.role.all', 'All'),
        excludeLinkedCompanyId: companyId,
        addNew: {
          title: translate('customers.linking.person.addNew', 'Add new contact'),
          subtitle: translate(
            'customers.linking.person.addNewSubtitle',
            'Company will be filled in automatically',
          ),
          render: ({ onCancel }) => (
            <CreatePersonDialog
              open
              onClose={onCancel}
              companyId={companyId}
              companyName={companyName ?? companyId}
              runGuardedMutation={runWriteMutation}
              onPersonCreated={() => {
                // CreatePersonDialog already created and linked the person to this company
                // via the companyEntityId payload field. Refresh the on-page list and close
                // both the nested and outer dialogs so the user can see the new entry.
                requestRefresh()
                void onDataRefresh?.()
                setLinkDialogOpen(false)
                onCancel()
              }}
            />
          ),
        },
      }),
    [companyId, companyName, onDataRefresh, requestRefresh, runWriteMutation, translate],
  )

  const handleRemove = React.useCallback(
    async (personId: string) => {
      try {
        await runWriteMutation(
          () =>
            // optimistic-lock-exempt: person-company link add/remove
            apiCallOrThrow(
              `/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(companyId)}`,
              { method: 'DELETE' },
              {
                errorMessage: translate(
                  'customers.companies.detail.people.removeError',
                  'Failed to unlink person from company.',
                ),
              },
            ),
          {
            personId,
            companyId,
          },
        )
        flash(
          translate(
            'customers.companies.detail.people.removeSuccess',
            'Person unlinked from company.',
          ),
          'success',
        )
        void onDataRefresh?.()
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : translate(
                'customers.companies.detail.people.removeError',
                'Failed to unlink person from company.',
              )
        flash(message, 'error')
      }
    },
    [companyId, onDataRefresh, runWriteMutation, translate],
  )

  const additionalRowActions = React.useCallback((person: LinkedPersonSummary): RowActionItem[] => {
    const { id, displayName, updatedAt } = person
    if (!canEndEmployment || !updatedAt) return []
    return [{
      id: 'end-employment',
      label: translate('customers.companies.detail.employment.end', 'End employment'),
      onSelect: () => setEndTarget({ id, displayName, updatedAt }),
    }]
  }, [canEndEmployment, translate])

  const handleEmploymentEnded = (personId: string) => {
    setEndTarget((current) => current?.id === personId ? null : current)
    setPeople((current) => current.filter((person) => person.id !== personId))
    refreshPeopleAndHistory()
    flash(translate('customers.companies.detail.employment.endSuccess', 'Employment ended.'), 'success')
  }

  return (
    <>
      <LinkedPeopleSection
        scopeId={companyId}
        fallbackPeople={people}
        loadPage={loadPage}
        onUnlink={handleRemove}
        additionalRowActions={additionalRowActions}
        linkedPeopleTotal={activePeopleCount}
        linkAdapter={personLinkAdapter}
        linkDialogOpen={linkDialogOpen}
        onLinkDialogOpenChange={setLinkDialogOpen}
        onLinkConfirm={handleLinkConfirm}
        sectionTitle={translate('customers.companies.detail.people.sectionTitle', 'People')}
        searchPlaceholder={translate(
          'customers.companies.detail.people.searchPlaceholder',
          'Search by name, role, email...',
        )}
        linkActionLabel={translate(
          'customers.companies.detail.people.linkAction',
          'Link existing person',
        )}
        addActionLabel={addActionLabel}
        onAddPerson={() => setCreateDialogOpen(true)}
        emptyLabel={emptyLabel}
        emptyState={emptyState}
        refreshKey={refreshKey}
        translator={translate}
        runGuardedMutation={runWriteMutation}
        onLoadingChange={onLoadingChange}
        header={
          <RolesSection
            entityType="company"
            entityId={companyId}
            entityName={companyName ?? null}
          />
        }
        renderFooter={({ people: visible, starredIds }) => (
          <DecisionMakersFooter
            names={visible
              .filter((person) => starredIds.has(person.id))
              .map((person) => person.displayName)}
            onSendInvitation={() => {
              const starredEmails = visible
                .filter((person) => starredIds.has(person.id) && person.primaryEmail)
                .map((person) => person.primaryEmail!)
              if (starredEmails.length > 0) {
                window.open(`mailto:${starredEmails.join(',')}`, '_blank')
              }
            }}
          />
        )}
      />

      {canViewEmploymentHistory ? (
        <FormerEmployeesSection key={companyId} companyId={companyId} refreshKey={historyRefreshKey} translate={translate} />
      ) : null}

      {canEndEmployment && endTarget ? (
        <EndEmploymentDialog
          companyId={companyId}
          personId={endTarget.id}
          personName={endTarget.displayName}
          updatedAt={endTarget.updatedAt}
          onClose={() => setEndTarget(null)}
          onEnded={() => handleEmploymentEnded(endTarget.id)}
        />
      ) : null}

      <CreatePersonDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        companyId={companyId}
        companyName={companyName ?? companyId}
        runGuardedMutation={runWriteMutation}
        onPersonCreated={() => {
          setCreateDialogOpen(false)
          requestRefresh()
          void onDataRefresh?.()
        }}
      />
    </>
  )
}

export default CompanyPeopleSection

export { mergeCompanyPeople, matchesCompanyPersonSearch, sortCompanyPeople, normalizeCompanyPerson }
