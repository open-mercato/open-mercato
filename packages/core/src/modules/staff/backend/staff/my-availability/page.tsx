"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { buildMemberScheduleItems } from '@open-mercato/core/modules/staff/lib/memberSchedule'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SelfMemberResponse = {
  member?: {
    id?: string
    displayName?: string
    availabilityRuleSetId?: string | null
  } | null
}

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
}

export default function StaffMyAvailabilityPage() {
  const t = useT()
  const [member, setMember] = React.useState<SelfMemberResponse['member']>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canManageAvailability, setCanManageAvailability] = React.useState(false)
  const [canManageUnavailability, setCanManageUnavailability] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const memberCall = await apiCall<SelfMemberResponse>('/api/staff/team-members/self')
        const featureCall = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            features: [
              'planner.manage_availability',
              'staff.my_availability.manage',
              'staff.my_availability.unavailability',
            ],
          }),
        })
        if (!cancelled) {
          setMember(memberCall.result?.member ?? null)
          const granted = Array.isArray(featureCall.result?.granted) ? featureCall.result?.granted ?? [] : []
          const hasPlannerManage = granted.includes('planner.manage_availability')
          const hasSelfManage = granted.includes('staff.my_availability.manage')
          const hasSelfUnavailability = granted.includes('staff.my_availability.unavailability')
          const canManage = hasPlannerManage || hasSelfManage
          setCanManageAvailability(canManage)
          setCanManageUnavailability(canManage && (hasPlannerManage || hasSelfUnavailability))
        }
      } catch (err) {
        if (!cancelled) {
          setError(t('staff.myAvailability.errors.load', 'Failed to load availability.'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('staff.myAvailability.loading', 'Loading availability...')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  if (!member?.id) {
    return (
      <Page>
        <PageBody>
          <div className="space-y-3 rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            <p>{t('staff.myAvailability.empty.profileRequired', 'Create your team member profile to manage availability.')}</p>
            <Button asChild size="sm">
              <Link href="/backend/staff/profile/create">
                {t('staff.leaveRequests.actions.createProfile', 'Create my profile')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          {!canManageAvailability ? (
            <div className="space-y-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {t('staff.myAvailability.readOnly.title', 'Only an administrator can manage your availability.')}
              </p>
              <p>
                {t('staff.myAvailability.readOnly.body', 'Use leave requests to request changes.')}
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/backend/staff/my-leave-requests">
                  {t('staff.leaveRequests.my.title', 'My leave requests')}
                </Link>
              </Button>
            </div>
          ) : null}
          <AvailabilityRulesEditor
            subjectType="member"
            subjectId={member.id}
            labelPrefix="staff.teamMembers"
            mode="availability"
            rulesetId={member.availabilityRuleSetId ?? null}
            buildScheduleItems={({ availabilityRules, translate }) => (
              buildMemberScheduleItems({ availabilityRules, translate })
            )}
            readOnly={!canManageAvailability}
            allowUnavailability={canManageUnavailability}
          />
        </div>
      </PageBody>
    </Page>
  )
}
