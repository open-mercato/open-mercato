"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { buildMemberScheduleItems } from '@open-mercato/core/modules/staff/lib/memberSchedule'
import { TeamMemberForm, buildTeamMemberPayload, type TeamMemberFormValues } from '@open-mercato/core/modules/staff/components/TeamMemberForm'
import { NotesSection } from '@open-mercato/ui/backend/detail'
import { ActivitiesSection, type SectionAction } from '@open-mercato/ui/backend/detail'
import { AddressesSection as SharedAddressesSection } from '@open-mercato/ui/backend/detail'
import { renderDictionaryColor, renderDictionaryIcon, ICON_SUGGESTIONS } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { createStaffNotesAdapter } from '@open-mercato/core/modules/staff/components/detail/notesAdapter'
import { createStaffActivitiesAdapter } from '@open-mercato/core/modules/staff/components/detail/activitiesAdapter'
import { createStaffAddressAdapter, createStaffAddressTypesAdapter } from '@open-mercato/core/modules/staff/components/detail/addressesAdapter'
import { loadStaffDictionaryEntries, createStaffDictionaryEntry } from '@open-mercato/core/modules/staff/components/detail/dictionaries'
import type { DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'

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
  roleNames?: string[]
  tags?: string[]
  isActive?: boolean
  is_active?: boolean
  availabilityRuleSetId?: string | null
  availability_rule_set_id?: string | null
  user?: { id?: string; email?: string | null } | null
  team?: { id?: string; name?: string | null } | null
  customFields?: Record<string, unknown> | null
} & Record<string, unknown>

type TeamMemberResponse = {
  items?: TeamMemberRecord[]
}

export default function StaffTeamMemberDetailPage({ params }: { params?: { id?: string } }) {
  const memberId = params?.id
  const t = useT()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const router = useRouter()
  const searchParams = useSearchParams()
  const [initialValues, setInitialValues] = React.useState<TeamMemberFormValues | null>(null)
  const [memberRecord, setMemberRecord] = React.useState<TeamMemberRecord | null>(null)
  const [availabilityRuleSetId, setAvailabilityRuleSetId] = React.useState<string | null>(null)
  const [activePanel, setActivePanel] = React.useState<'details' | 'availability'>('details')
  const [activeTab, setActiveTab] = React.useState<'notes' | 'activities' | 'addresses'>('notes')
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const flashShownRef = React.useRef(false)

  const notesAdapter = React.useMemo(() => createStaffNotesAdapter(detailTranslator), [detailTranslator])
  const activitiesAdapter = React.useMemo(() => createStaffActivitiesAdapter(detailTranslator), [detailTranslator])
  const addressesAdapter = React.useMemo(() => createStaffAddressAdapter(detailTranslator), [detailTranslator])
  const addressTypesAdapter = React.useMemo(() => createStaffAddressTypesAdapter(detailTranslator), [detailTranslator])

  const activityTypeLabels = React.useMemo<DictionarySelectLabels>(() => ({
    placeholder: t('staff.teamMembers.detail.activities.dictionary.placeholder', 'Select an activity type'),
    addLabel: t('staff.teamMembers.detail.activities.dictionary.add', 'Add type'),
    addPrompt: t('staff.teamMembers.detail.activities.dictionary.prompt', 'Name the type'),
    dialogTitle: t('staff.teamMembers.detail.activities.dictionary.dialogTitle', 'Add activity type'),
    valueLabel: t('staff.teamMembers.detail.activities.dictionary.valueLabel', 'Name'),
    valuePlaceholder: t('staff.teamMembers.detail.activities.dictionary.valuePlaceholder', 'Name'),
    labelLabel: t('staff.teamMembers.detail.activities.dictionary.labelLabel', 'Label'),
    labelPlaceholder: t('staff.teamMembers.detail.activities.dictionary.labelPlaceholder', 'Display name shown in UI'),
    emptyError: t('staff.teamMembers.detail.activities.dictionary.emptyError', 'Please enter a name'),
    cancelLabel: t('staff.teamMembers.detail.activities.dictionary.cancel', 'Cancel'),
    saveLabel: t('staff.teamMembers.detail.activities.dictionary.save', 'Save'),
    saveShortcutHint: t('staff.teamMembers.detail.activities.dictionary.saveShortcut', '⌘/Ctrl + Enter'),
    errorLoad: t('staff.teamMembers.detail.activities.dictionary.errorLoad', 'Failed to load options'),
    errorSave: t('staff.teamMembers.detail.activities.dictionary.errorSave', 'Failed to save option'),
    loadingLabel: t('staff.teamMembers.detail.activities.dictionary.loading', 'Loading…'),
    manageTitle: t('staff.teamMembers.detail.activities.dictionary.manage', 'Manage dictionary'),
  }), [t])

  const loadActivityOptions = React.useCallback(async () => {
    return await loadStaffDictionaryEntries('activityTypes')
  }, [])

  const createActivityOption = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const entry = await createStaffDictionaryEntry('activityTypes', input)
      if (!entry) {
        throw new Error(t('staff.teamMembers.detail.activities.dictionary.errorSave', 'Failed to save option'))
      }
      return entry
    },
    [t],
  )

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('staff.teamMembers.detail.activities.appearance.colorLabel', 'Color'),
    colorHelp: t('staff.teamMembers.detail.activities.appearance.colorHelp', 'Pick a highlight color for this entry.'),
    colorClearLabel: t('staff.teamMembers.detail.activities.appearance.colorClear', 'Remove color'),
    iconLabel: t('staff.teamMembers.detail.activities.appearance.iconLabel', 'Icon or emoji'),
    iconPlaceholder: t('staff.teamMembers.detail.activities.appearance.iconPlaceholder', 'Type an emoji or pick one of the suggestions.'),
    iconPickerTriggerLabel: t('staff.teamMembers.detail.activities.appearance.iconBrowse', 'Browse icons and emojis'),
    iconSearchPlaceholder: t('staff.teamMembers.detail.activities.appearance.iconSearchPlaceholder', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('staff.teamMembers.detail.activities.appearance.iconSearchEmpty', 'No icons match your search.'),
    iconSuggestionsLabel: t('staff.teamMembers.detail.activities.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('staff.teamMembers.detail.activities.appearance.iconClear', 'Remove icon'),
    previewEmptyLabel: t('staff.teamMembers.detail.activities.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

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
          { errorMessage: t('staff.teamMembers.form.errors.load', 'Failed to load team member.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('staff.teamMembers.form.errors.notFound', 'Team member not found.'))
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
          setMemberRecord(record)
          setAvailabilityRuleSetId(
            typeof record.availabilityRuleSetId === 'string'
              ? record.availabilityRuleSetId
              : typeof record.availability_rule_set_id === 'string'
                ? record.availability_rule_set_id
                : null,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('staff.teamMembers.form.errors.load', 'Failed to load team member.')
        flash(message, 'error')
      }
    }
    void loadMember()
    return () => { cancelled = true }
  }, [memberId, t])

  React.useEffect(() => {
    if (!searchParams) return
    const created = searchParams.get('created') === '1'
    if (created && !flashShownRef.current) {
      flashShownRef.current = true
      flash(t('staff.teamMembers.flash.createdAvailability', 'Saved. You can now set availability.'), 'success')
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete('created')
      const nextQuery = nextParams.toString()
      const nextPath = memberId
        ? `/backend/staff/team-members/${encodeURIComponent(memberId)}${nextQuery ? `?${nextQuery}` : ''}`
        : `/backend/staff/team-members${nextQuery ? `?${nextQuery}` : ''}`
      router.replace(nextPath)
    }
  }, [memberId, router, searchParams, t])

  const handleSubmit = React.useCallback(async (values: TeamMemberFormValues) => {
    if (!memberId) return
    const payload = buildTeamMemberPayload(values, { id: memberId })
    await updateCrud('staff/team-members', payload, {
      errorMessage: t('staff.teamMembers.form.errors.update', 'Failed to update team member.'),
    })
    flash(t('staff.teamMembers.form.flash.updated', 'Team member updated.'), 'success')
    router.push('/backend/staff/team-members')
  }, [memberId, router, t])

  const handleDelete = React.useCallback(async () => {
    if (!memberId) return
    await deleteCrud('staff/team-members', memberId, {
      errorMessage: t('staff.teamMembers.form.errors.delete', 'Failed to delete team member.'),
    })
    flash(t('staff.teamMembers.form.flash.deleted', 'Team member deleted.'), 'success')
    router.push('/backend/staff/team-members')
  }, [memberId, router, t])

  const handleRulesetChange = React.useCallback(async (nextId: string | null) => {
    if (!memberId) return
    await updateCrud('staff/team-members', { id: memberId, availabilityRuleSetId: nextId }, {
      errorMessage: t('staff.teamMembers.availability.ruleset.updateError', 'Failed to update schedule.'),
    })
    setAvailabilityRuleSetId(nextId)
    flash(t('staff.teamMembers.availability.ruleset.updateSuccess', 'Schedule updated.'), 'success')
  }, [memberId, t])

  const panelTabs = React.useMemo(() => ([
    { id: 'details' as const, label: t('staff.teamMembers.detail.tabs.details', 'Details') },
    { id: 'availability' as const, label: t('staff.teamMembers.detail.tabs.availability', 'Availability') },
  ]), [t])

  const tabs = React.useMemo(() => ([
    { id: 'notes' as const, label: t('staff.teamMembers.detail.tabs.notes', 'Notes') },
    { id: 'activities' as const, label: t('staff.teamMembers.detail.tabs.activities', 'Activities') },
    { id: 'addresses' as const, label: t('staff.teamMembers.detail.tabs.addresses', 'Addresses') },
  ]), [t])

  const resolvedInitialValues = initialValues ?? {
    roleIds: [],
    isActive: true,
  }

  const displayName = memberRecord?.displayName ?? memberRecord?.display_name ?? resolvedInitialValues.displayName ?? ''
  const teamLabel = memberRecord?.team?.name ?? t('staff.teamMembers.detail.team.unassigned', 'Unassigned team')
  const roleLabels = Array.isArray(memberRecord?.roleNames) && memberRecord?.roleNames.length
    ? memberRecord?.roleNames
    : [t('staff.teamMembers.detail.roles.unassigned', 'No roles assigned')]
  const userEmail = memberRecord?.user?.email ?? null

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link
                href="/backend/staff/team-members"
                className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
              >
                <span aria-hidden className="mr-1 text-base">←</span>
                <span className="sr-only">{t('staff.teamMembers.detail.back', 'Back to team members')}</span>
              </Link>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold text-foreground">
                  {displayName || t('staff.teamMembers.detail.untitled', 'Unnamed team member')}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t('staff.teamMembers.detail.subtitle', 'Team member profile and activity')}
                </p>
              </div>
            </div>
          </div>

          <div className="border-b">
            <nav
              className="flex flex-wrap items-center gap-5 text-sm"
              aria-label={t('staff.teamMembers.detail.tabs.label', 'Team member sections')}
            >
              {panelTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activePanel === tab.id}
                  onClick={() => setActivePanel(tab.id)}
                  className={`relative -mb-px border-b-2 px-0 py-2 text-sm font-medium transition-colors ${
                    activePanel === tab.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {activePanel === 'details' ? (
            <>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr),minmax(0,1.1fr)]">
                <div className="space-y-6">
                  <div className="rounded-lg border bg-card p-4">
                    <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
                      {t('staff.teamMembers.detail.highlights', 'Highlights')}
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          {t('staff.teamMembers.detail.fields.team', 'Team')}
                        </p>
                        <p className="text-base text-foreground">{teamLabel}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          {t('staff.teamMembers.detail.fields.roles', 'Roles')}
                        </p>
                        <p className="text-base text-foreground">{roleLabels.join(', ')}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          {t('staff.teamMembers.detail.fields.user', 'User')}
                        </p>
                        <p className="text-base text-foreground">
                          {userEmail ?? t('staff.teamMembers.detail.fields.userEmpty', 'No user linked')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          {t('staff.teamMembers.detail.fields.status', 'Status')}
                        </p>
                        <p className="text-base text-foreground">
                          {memberRecord?.isActive ?? memberRecord?.is_active
                            ? t('staff.teamMembers.detail.status.active', 'Active')
                            : t('staff.teamMembers.detail.status.inactive', 'Inactive')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex gap-2">
                        {tabs.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative -mb-px border-b-2 px-0 py-1 text-sm font-medium transition-colors ${
                              activeTab === tab.id
                                ? 'border-primary text-foreground'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      {sectionAction ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={sectionAction.disabled}
                          onClick={() => sectionAction.onClick()}
                        >
                          {sectionAction.label}
                        </Button>
                      ) : null}
                    </div>
                    {activeTab === 'notes' ? (
                      <NotesSection
                        entityId={memberId ?? null}
                        emptyLabel={t('staff.teamMembers.detail.notes.empty', 'No notes yet.')}
                        viewerUserId={null}
                        viewerName={null}
                        viewerEmail={null}
                        addActionLabel={t('staff.teamMembers.detail.notes.add', 'Add note')}
                        emptyState={{
                          title: t('staff.teamMembers.detail.notes.emptyTitle', 'Keep everyone in the loop'),
                          actionLabel: t('staff.teamMembers.detail.notes.emptyAction', 'Add a note'),
                        }}
                        onActionChange={setSectionAction}
                        translator={detailTranslator}
                        labelPrefix="staff.teamMembers.detail.notes"
                        inlineLabelPrefix="staff.teamMembers.detail.inline"
                        dataAdapter={notesAdapter}
                        renderIcon={renderDictionaryIcon}
                        renderColor={renderDictionaryColor}
                        iconSuggestions={ICON_SUGGESTIONS}
                      />
                    ) : null}
                    {activeTab === 'activities' ? (
                      <ActivitiesSection
                        entityId={memberId ?? null}
                        addActionLabel={t('staff.teamMembers.detail.activities.add', 'Log activity')}
                        emptyState={{
                          title: t('staff.teamMembers.detail.activities.emptyTitle', 'No activities yet'),
                          actionLabel: t('staff.teamMembers.detail.activities.emptyAction', 'Add an activity'),
                        }}
                        onActionChange={setSectionAction}
                        dataAdapter={activitiesAdapter}
                        activityTypeLabels={activityTypeLabels}
                        loadActivityOptions={loadActivityOptions}
                        createActivityOption={createActivityOption}
                        labelPrefix="staff.teamMembers.detail.activities"
                        renderIcon={renderDictionaryIcon}
                        renderColor={renderDictionaryColor}
                        appearanceLabels={appearanceLabels}
                      />
                    ) : null}
                    {activeTab === 'addresses' ? (
                      <SharedAddressesSection
                        entityId={memberId ?? null}
                        emptyLabel={t('staff.teamMembers.detail.addresses.empty', 'No addresses yet.')}
                        addActionLabel={t('staff.teamMembers.detail.addresses.add', 'Add address')}
                        emptyState={{
                          title: t('staff.teamMembers.detail.addresses.emptyTitle', 'No addresses yet'),
                          actionLabel: t('staff.teamMembers.detail.addresses.emptyAction', 'Add an address'),
                        }}
                        onActionChange={setSectionAction}
                        dataAdapter={addressesAdapter}
                        addressTypesAdapter={addressTypesAdapter}
                        labelPrefix="staff.teamMembers.detail.addresses"
                      />
                    ) : null}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-lg border bg-card p-4">
                    <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
                      {t('staff.teamMembers.detail.details', 'Member details')}
                    </h2>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {memberRecord?.description ? (
                        <p>{memberRecord.description}</p>
                      ) : (
                        <p>{t('staff.teamMembers.detail.descriptionEmpty', 'No description provided.')}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <TeamMemberForm
                title={t('staff.teamMembers.form.editTitle', 'Edit team member')}
                backHref="/backend/staff/team-members"
                cancelHref="/backend/staff/team-members"
                initialValues={resolvedInitialValues}
                onSubmit={handleSubmit}
                onDelete={handleDelete}
                isLoading={!initialValues}
                loadingMessage={t('staff.teamMembers.form.loading', 'Loading team member...')}
              />
            </>
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
