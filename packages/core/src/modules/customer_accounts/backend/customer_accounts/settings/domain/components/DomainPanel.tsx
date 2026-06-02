"use client"

import * as React from 'react'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DefaultStepper, type StepperProps } from './Stepper'
import { DefaultStatusBadge, type StatusBadgeSectionProps } from './StatusBadgeSection'
import { DefaultDnsConfig, type DnsConfigProps } from './DnsConfig'
import { DefaultActions, type ActionsProps } from './Actions'
import { DnsDiagnostics, TlsDiagnostics } from './Diagnostics'
import type { DomainMappingRow } from './types'

export type DomainPanelProps = {
  mapping: DomainMappingRow
  isReplacement: boolean
  cnameTarget: string | null
  aRecordTarget: string | null
  busy?: boolean
  onCheckNow: () => void
  onRetryTls: () => void
  onChangeDomain: () => void
  onRemove: () => void
}

export function DomainPanel(props: DomainPanelProps) {
  const t = useT()
  const Stepper = useRegisteredComponent<StepperProps>(
    'section:customer_accounts.domain-settings:stepper',
    DefaultStepper,
  )
  const StatusBadgeSection = useRegisteredComponent<StatusBadgeSectionProps>(
    'section:customer_accounts.domain-settings:status',
    DefaultStatusBadge,
  )
  const DnsConfig = useRegisteredComponent<DnsConfigProps>(
    'section:customer_accounts.domain-settings:dns-config',
    DefaultDnsConfig,
  )
  const Actions = useRegisteredComponent<ActionsProps>(
    'section:customer_accounts.domain-settings:actions',
    DefaultActions,
  )

  const { mapping, isReplacement, cnameTarget, aRecordTarget } = props
  const showDnsConfig = mapping.status !== 'active'

  return (
    <section className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">{mapping.hostname}</h3>
            {isReplacement ? (
              <Tag variant="info" dot>
                {t('customer_accounts.domainMapping.replacement.label', 'Replacement (waiting to activate)')}
              </Tag>
            ) : null}
          </div>
          <StatusBadgeSection mapping={mapping} />
        </div>
      </div>

      <Stepper status={mapping.status} />

      <DnsDiagnostics mapping={mapping} />
      <TlsDiagnostics mapping={mapping} />

      {showDnsConfig ? (
        <DnsConfig
          hostname={mapping.hostname}
          cnameTarget={mapping.cnameTarget ?? cnameTarget}
          aRecordTarget={mapping.aRecordTarget ?? aRecordTarget}
        />
      ) : null}

      <Actions
        mapping={mapping}
        isReplacement={isReplacement}
        busy={props.busy}
        onCheckNow={props.onCheckNow}
        onRetryTls={props.onRetryTls}
        onChangeDomain={props.onChangeDomain}
        onRemove={props.onRemove}
      />
    </section>
  )
}

export default DomainPanel
