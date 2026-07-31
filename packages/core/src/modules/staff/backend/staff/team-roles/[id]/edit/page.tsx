"use client"

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { buildRecordInjectionContext, useSetCurrentRecordInjectionContext } from '@open-mercato/ui/backend/injection/recordContext'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TeamRoleForm, type TeamRoleFormValues, type TeamRoleOption, buildTeamRolePayload } from '@open-mercato/core/modules/staff/components/TeamRoleForm'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type TeamRoleRecord = {
  id: string
  name: string
  description?: string | null
  teamId?: string | null
  team_id?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
  appearance_icon?: string | null
  appearance_color?: string | null
  updatedAt?: string | null
  updated_at?: string | null
  team?: { id?: string | null; name?: string | null } | null
} & Record<string, unknown>

type TeamRoleResponse = {
  items?: TeamRoleRecord[]
}

type TeamsResponse = {
  items?: Array<{ id?: string; name?: string }>
}

export default function StaffTeamRoleEditPage({ params }: { params?: { id?: string } }) {
  const roleId = params?.id
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const scopeVersion = useOrganizationScopeVersion()
  // optimistic-lock: TeamRoleForm forwards optimisticLockUpdatedAt from initialValues.updatedAt (wrapper auto-derives the header on save + delete).
  const [initialValues, setInitialValues] = React.useState<TeamRoleFormValues | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [teams, setTeams] = React.useState<TeamRoleOption[]>([])
  const selectedTeamId = typeof initialValues?.teamId === 'string' && initialValues.teamId.trim().length
    ? initialValues.teamId.trim()
    : null

  React.useEffect(() => {
    if (!roleId) return
    const roleIdValue = roleId
    let cancelled = false
    async function loadRole() {
      if (!cancelled) {
        setError(null)
        setIsNotFound(false)
      }
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: roleIdValue })
        const payload = await readApiResultOrThrow<TeamRoleResponse>(
          `/api/staff/team-roles?${params.toString()}`,
          undefined,
          { errorMessage: t('staff.teamRoles.errors.load', 'Failed to load team role.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const customFields = extractCustomFieldEntries(record)
        const appearanceIcon = typeof record.appearanceIcon === 'string'
          ? record.appearanceIcon
          : typeof record.appearance_icon === 'string'
            ? record.appearance_icon
            : null
        const appearanceColor = typeof record.appearanceColor === 'string'
          ? record.appearanceColor
          : typeof record.appearance_color === 'string'
            ? record.appearance_color
            : null
        if (!cancelled) {
          const teamId = typeof record.teamId === 'string'
            ? record.teamId
            : typeof record.team_id === 'string'
              ? record.team_id
              : null
          const teamName = typeof record.team?.name === 'string' ? record.team.name : null
          if (teamId && teamName) {
            setTeams((previous) => {
              if (previous.some((team) => team.id === teamId)) return previous
              return [{ id: teamId, name: teamName }, ...previous]
            })
          }
          setInitialValues({
            id: record.id,
            teamId,
            name: record.name ?? '',
            description: record.description ?? '',
            appearance: { icon: appearanceIcon, color: appearanceColor },
            updatedAt: typeof record.updatedAt === 'string'
              ? record.updatedAt
              : typeof record.updated_at === 'string'
                ? record.updated_at
                : null,
            ...customFields,
          })
        }
      } catch (err) {
        if (!cancelled) {
          if ((err as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            const message = err instanceof Error ? err.message : t('staff.teamRoles.errors.load', 'Failed to load team role.')
            setError(message)
          }
        }
      }
    }
    loadRole()
    return () => { cancelled = true }
  }, [roleId, t])

  React.useEffect(() => {
    let cancelled = false
    async function loadTeams() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        const call = await apiCall<TeamsResponse>(`/api/staff/teams?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const options = items
          .map((team) => {
            const id = typeof team.id === 'string' ? team.id : null
            const name = typeof team.name === 'string' ? team.name : null
            if (!id || !name) return null
            return { id, name }
          })
          .filter((entry): entry is TeamRoleOption => entry !== null)
        if (!cancelled) {
          setTeams((previous) => {
            if (!previous.length) return options
            const seen = new Set(options.map((team) => team.id))
            const preservedSelected = previous.filter((team) => !seen.has(team.id))
            return [...preservedSelected, ...options]
          })
        }
      } catch {
        if (!cancelled) setTeams([])
      }
    }
    loadTeams()
    return () => { cancelled = true }
  }, [scopeVersion])

  React.useEffect(() => {
    if (!selectedTeamId) return
    if (teams.some((team) => team.id === selectedTeamId)) return
    const lookupId = selectedTeamId
    let cancelled = false
    async function loadSelectedTeam() {
      try {
        const call = await apiCall<TeamsResponse>(
          `/api/staff/teams?ids=${encodeURIComponent(lookupId)}&pageSize=1`,
        )
        const entry = Array.isArray(call.result?.items) ? call.result.items[0] : null
        const id = typeof entry?.id === 'string' ? entry.id : null
        const name = typeof entry?.name === 'string' ? entry.name : null
        if (!id || !name) return
        if (!cancelled) {
          setTeams((previous) => {
            if (previous.some((team) => team.id === id)) return previous
            return [{ id, name }, ...previous]
          })
        }
      } catch {
        if (!cancelled) setTeams((previous) => previous)
      }
    }
    loadSelectedTeam()
    return () => { cancelled = true }
  }, [selectedTeamId, teams])

  const handleSubmit = React.useCallback(async (values: TeamRoleFormValues) => {
    if (!roleId) return
    const payload = buildTeamRolePayload(values, { id: roleId })
    await updateCrud('staff/team-roles', payload, {
      errorMessage: t('staff.teamRoles.errors.save', 'Failed to save team role.'),
    })
    flash(t('staff.teamRoles.messages.saved', 'Team role saved.'), 'success')
    router.push('/backend/staff/team-roles')
  }, [roleId, router, t])

  const handleDelete = React.useCallback(async () => {
    if (!roleId) return
    await deleteCrud('staff/team-roles', roleId, {
      errorMessage: t('staff.teamRoles.errors.delete', 'Failed to delete team role.'),
    })
    flash(t('staff.teamRoles.messages.deleted', 'Team role deleted.'), 'success')
    router.push('/backend/staff/team-roles')
  }, [roleId, router, t])

  // Publish page-load record context to the AppShell-owned `backend:record:current`
  // mount so the enterprise record_locks widget resolves `staff.teamRole` + id
  // explicitly. The resourceKind mirrors the TeamRoleForm `versionHistory` so the held
  // lock matches the save-time conflict surface for the same team role.
  useSetCurrentRecordInjectionContext(
    buildRecordInjectionContext({
      resourceKind: 'staff.teamRole',
      resourceId: roleId || null,
      updatedAt: initialValues?.updatedAt ?? null,
      data: initialValues as Record<string, unknown> | null,
      path: pathname,
    }),
  )

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('staff.teamRoles.errors.notFound', 'Team role not found.')}
            backHref="/backend/staff/team-roles"
            backLabel={t('staff.teamRoles.actions.backToList', 'Back to team roles')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error && !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <TeamRoleForm
          title={t('staff.teamRoles.form.editTitle', 'Edit team role')}
          backHref="/backend/staff/team-roles"
          cancelHref="/backend/staff/team-roles"
          initialValues={initialValues ?? { name: '', description: '', appearance: { icon: null, color: null }, teamId: null }}
          teamOptions={teams}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          isLoading={!initialValues}
          loadingMessage={t('staff.teamRoles.form.loading', 'Loading team role...')}
          extraActions={roleId ? (
            <SendObjectMessageDialog
              object={{
                entityModule: 'staff',
                entityType: 'team_role',
                entityId: roleId,
                previewData: { title: initialValues?.name ?? ''},
              }}
              viewHref={`/backend/staff/team-roles/${roleId}/edit`}
            />
          ) : undefined}
        />
      </PageBody>
    </Page>
  )
}
