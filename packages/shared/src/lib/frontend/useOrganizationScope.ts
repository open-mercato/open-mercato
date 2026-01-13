"use client"
import * as React from 'react'
import { 
  subscribeOrganizationScopeChanged, 
  getCurrentOrganizationScope,
  getCurrentOrganizationScopeVersion,
  type OrganizationScopeChangedDetail 
} from './organizationEvents'

export function useOrganizationScopeVersion(): number {
  const [version, setVersion] = React.useState(getCurrentOrganizationScopeVersion)
  React.useEffect(() => {
    return subscribeOrganizationScopeChanged(() => {
      setVersion(getCurrentOrganizationScopeVersion())
    })
  }, [])
  return version
}

export function useOrganizationScopeDetail(): OrganizationScopeChangedDetail {
  const [detail, setDetail] = React.useState<OrganizationScopeChangedDetail>(
    getCurrentOrganizationScope
  )
  React.useEffect(() => {
    return subscribeOrganizationScopeChanged((next) => {
      setDetail(next)
    })
  }, [])
  return detail
}
