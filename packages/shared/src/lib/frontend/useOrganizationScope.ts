"use client"
import * as React from 'react'
import { subscribeOrganizationScopeChanged, type OrganizationScopeChangedDetail } from './organizationEvents'

export function useOrganizationScopeVersion(): number {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    return subscribeOrganizationScopeChanged(() => {
      setVersion((prev) => prev + 1)
    })
  }, [])
  return version
}

export function useOrganizationScopeDetail(): OrganizationScopeChangedDetail {
  const [detail, setDetail] = React.useState<OrganizationScopeChangedDetail>({ organizationId: null, tenantId: null })
  React.useEffect(() => {
    return subscribeOrganizationScopeChanged((next) => {
      setDetail(next)
    })
  }, [])
  return detail
}
