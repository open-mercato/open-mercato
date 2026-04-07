'use client'

import * as React from 'react'

type AiAssistantIntegrationComponent = React.ComponentType<{
  tenantId: string | null
  organizationId: string | null
  children: React.ReactNode
}>

type AiAssistantShellIntegrationProps = {
  tenantId: string | null
  organizationId: string | null
  children: React.ReactNode
}

export function AiAssistantShellIntegration({
  tenantId,
  organizationId,
  children,
}: AiAssistantShellIntegrationProps) {
  const [IntegrationComponent, setIntegrationComponent] = React.useState<AiAssistantIntegrationComponent | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void import('@open-mercato/ai-assistant/frontend').then((module) => {
      if (cancelled) return
      setIntegrationComponent(() => module.AiAssistantIntegration)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!IntegrationComponent) return null

  return (
    <IntegrationComponent tenantId={tenantId} organizationId={organizationId}>
      {children}
    </IntegrationComponent>
  )
}
