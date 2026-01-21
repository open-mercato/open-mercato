"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { buildMemberScheduleItems } from '@open-mercato/core/modules/staff/lib/memberSchedule'
import { TeamMemberForm, buildTeamMemberPayload, type TeamMemberFormValues } from '@open-mercato/core/modules/staff/components/TeamMemberForm'

type TeamMemberRecord = {
  id: string
  teamId?: string | null
  team_id?: string | null
  displayName: string
  display_name?: string
  description?: string | null
  userId?: string | null
  user_id?: string | null
  roleIds?: string[]
  role_ids?: string[]
  tags?: string[]
  isActive?: boolean
  is_active?: boolean
  availabilityRuleSetId?: string | null
  availability_rule_set_id?: string | null
  user?: { id?: string; email?: string | null } | null
  customFields?: Record<string, unknown> | null
} & Record<string, unknown>

type TeamMemberResponse = {
  items?: TeamMemberRecord[]
}

export default function StaffTeamMemberDetailPage({ params }: { params?: { id?: string } }) {
  const memberId = params?.id
  const translate = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [initialValues, setInitialValues] = React.useState<TeamMemberFormValues | null>(null)
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')
  const [availabilityRuleSetId, setAvailabilityRuleSetId] = React.useState<string | null>(null)
  const flashShownRef = React.useRef(false)

  React.useEffect(() => {
    if (!memberId) return
    const memberIdValue = memberId
    let cancelled = false
    async function loadMember() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: memberIdValue })
        const payload = await readApiResultOrThrow<TeamMemberResponse>(
          `/api/staff/team-members?${params.toString()}`,
          undefined,
          { errorMessage: translate('staff.teamMembers.form.errors.load', 'Failed to load team member.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(translate('staff.teamMembers.form.errors.notFound', 'Team member not found.'))
        const customFields = extractCustomFieldEntries(record)
        if (!cancelled) {
          const resolvedTeamId = record.teamId ?? record.team_id ?? null
          const normalizedRoleIds = normalizeStringList(resolvePreferredArray(record.roleIds, record.role_ids))
          setInitialValues({
            id: record.id,
            teamId: resolvedTeamId,
            userId: record.userId ?? record.user_id ?? null,
            displayName: record.displayName ?? record.display_name ?? '',
            description: record.description ?? '',
            roleIds: normalizedRoleIds,
            tags: normalizeStringList(record.tags),
            isActive: record.isActive ?? record.is_active ?? true,
            ...customFields,
          })
          setAvailabilityRuleSetId(
            typeof record.availabilityRuleSetId === 'string'
              ? record.availabilityRuleSetId
              : typeof record.availability_rule_set_id === 'string'
                ? record.availability_rule_set_id
                : null,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : translate('staff.teamMembers.form.errors.load', 'Failed to load team member.')
        flash(message, 'error')
      }
    }
    loadMember()
    return () => { cancelled = true }
  }, [memberId, translate])

  React.useEffect(() => {
    if (!searchParams) return
    const tabParam = searchParams.get('tab')
    if (tabParam === 'availability') {
      setActiveTab('availability')
    }
    const created = searchParams.get('created') === '1'
    if (created && !flashShownRef.current) {
      flashShownRef.current = true
      flash(translate('staff.teamMembers.flash.createdAvailability', 'Saved. You can now set availability.'), 'success')
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete('created')
      const nextQuery = nextParams.toString()
      const nextPath = memberId
        ? `/backend/staff/team-members/${encodeURIComponent(memberId)}${nextQuery ? `?${nextQuery}` : ''}`
        : `/backend/staff/team-members${nextQuery ? `?${nextQuery}` : ''}`
      router.replace(nextPath)
    }
  }, [memberId, router, searchParams, translate])

  const handleSubmit = React.useCallback(async (values: TeamMemberFormValues) => {
    if (!memberId) return
    const payload = buildTeamMemberPayload(values, { id: memberId })
    await updateCrud('staff/team-members', payload, {
      errorMessage: translate('staff.teamMembers.form.errors.update', 'Failed to update team member.'),
    })
    flash(translate('staff.teamMembers.form.flash.updated', 'Team member updated.'), 'success')
    router.push('/backend/staff/team-members')
  }, [memberId, router, translate])

  const handleDelete = React.useCallback(async () => {
    if (!memberId) return
    await deleteCrud('staff/team-members', memberId, {
      errorMessage: translate('staff.teamMembers.form.errors.delete', 'Failed to delete team member.'),
    })
    flash(translate('staff.teamMembers.form.flash.deleted', 'Team member deleted.'), 'success')
    router.push('/backend/staff/team-members')
  }, [memberId, router, translate])

  const handleRulesetChange = React.useCallback(async (nextId: string | null) => {
    if (!memberId) return
    await updateCrud('staff/team-members', { id: memberId, availabilityRuleSetId: nextId }, {
      errorMessage: translate('staff.teamMembers.availability.ruleset.updateError', 'Failed to update schedule.'),
    })
    setAvailabilityRuleSetId(nextId)
    flash(translate('staff.teamMembers.availability.ruleset.updateSuccess', 'Schedule updated.'), 'success')
  }, [memberId, translate])

  const tabs = React.useMemo(() => ([
    { id: 'details', label: translate('staff.teamMembers.tabs.details', 'Details') },
    { id: 'availability', label: translate('staff.teamMembers.tabs.availability', 'Availability') },
  ]), [translate])

  const resolvedInitialValues = initialValues ?? {
    roleIds: [],
    isActive: true,
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="border-b">
            <nav className="flex flex-wrap items-center gap-5 text-sm" aria-label={translate('staff.teamMembers.tabs.label', 'Team member sections')}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id as 'details' | 'availability')}
                  className={`relative -mb-px border-b-2 px-0 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {activeTab === 'details' ? (
            <TeamMemberForm
              title={translate('staff.teamMembers.form.editTitle', 'Edit team member')}
              backHref="/backend/staff/team-members"
              cancelHref="/backend/staff/team-members"
              initialValues={resolvedInitialValues}
              onSubmit={handleSubmit}
              onDelete={handleDelete}
              isLoading={!initialValues}
              loadingMessage={translate('staff.teamMembers.form.loading', 'Loading team member...')}
            />
          ) : (
            <AvailabilityRulesEditor
              subjectType="member"
              subjectId={memberId ?? ''}
              labelPrefix="staff.teamMembers"
              mode="availability"
              rulesetId={availabilityRuleSetId}
              onRulesetChange={handleRulesetChange}
              buildScheduleItems={({ availabilityRules, translate: translateLabel }) => (
                buildMemberScheduleItems({ availabilityRules, translate: translateLabel })
              )}
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}

function resolvePreferredArray<T>(primary?: T[] | null, fallback?: T[] | null): T[] | undefined {
  if (Array.isArray(primary) && primary.length) return primary
  if (Array.isArray(fallback) && fallback.length) return fallback
  return Array.isArray(primary) ? primary : Array.isArray(fallback) ? fallback : undefined
}
