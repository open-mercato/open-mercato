"use client"

import * as React from 'react'
import { Info } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter, DrawerClose } from '@open-mercato/ui/primitives/drawer'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AgentDetailView } from '../../../../components/types'
import { AutonomySegmented, ConfigField, NoticeBanner, SectionBand } from './workspacePrimitives'
import { autonomyHintFallback, type Autonomy } from './workspaceShared'

// Deliberately disabled (data-honesty spec §3.7): agents are defined in code for
// now, and autonomy/spend/rate governance has no persistence — the drawer shows
// the target UX without pretending to save.
export function AgentConfigDrawer({
  open,
  onOpenChange,
  agent,
  autonomy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AgentDetailView
  autonomy: Autonomy
}) {
  const t = useT()
  const defaultValue = t('agent_orchestrator.agentDetail.defaultValue', 'Default')
  const codeOnly = t('agent_orchestrator.agentDetail.actions.codeOnly', 'Managed in code for now — UI wiring needs backend.')
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right">
        <DrawerHeader>
          <DrawerTitle>{t('agent_orchestrator.agentDetail.config.title', 'Configure')}</DrawerTitle>
          <DrawerDescription>{agent.label || agent.id}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="p-0">
          <div className="px-6 pt-4 pb-2">
            <NoticeBanner icon={Info}>
              {t('agent_orchestrator.agentDetail.config.notice', 'Target UX — agents are defined in code for now; editing and saving need backend.')}
            </NoticeBanner>
          </div>

          <SectionBand>{t('agent_orchestrator.agentDetail.config.runtime', 'Runtime')}</SectionBand>
          <div className="space-y-4 px-6 py-4">
            <div className="grid grid-cols-2 gap-3">
              <ConfigField label={t('agent_orchestrator.agentDetail.fields.provider', 'Provider')}>
                <Input defaultValue={agent.defaultProvider ?? defaultValue} disabled />
              </ConfigField>
              <ConfigField label={t('agent_orchestrator.agentDetail.fields.model', 'Model')}>
                <Input defaultValue={agent.defaultModel ?? defaultValue} disabled />
              </ConfigField>
            </div>
            <ConfigField label={t('agent_orchestrator.agentDetail.fields.maxSteps', 'Max steps')}>
              <Input defaultValue={agent.loopMaxSteps != null ? String(agent.loopMaxSteps) : defaultValue} disabled />
            </ConfigField>
          </div>

          <SectionBand>{t('agent_orchestrator.agentDetail.config.governance', 'Governance')}</SectionBand>
          <div className="space-y-4 px-6 py-4">
            <ConfigField label={t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy')} pending>
              <AutonomySegmented value={autonomy} />
              <p className="mt-2 text-sm text-muted-foreground">{t(`agent_orchestrator.agentDetail.autonomy.${autonomy}Hint`, autonomyHintFallback(autonomy))}</p>
            </ConfigField>
            <ConfigField label={t('agent_orchestrator.agentDetail.config.spendCap', 'Spend cap / month')} pending>
              <Input placeholder="—" disabled />
            </ConfigField>
            <ConfigField label={t('agent_orchestrator.agentDetail.config.rateLimit', 'Rate limit / min')} pending>
              <Input placeholder="—" disabled />
            </ConfigField>
            <ConfigField label={t('agent_orchestrator.agentDetail.config.owner', 'Owner')} pending>
              <Input placeholder={t('agent_orchestrator.agentDetail.config.unassigned', 'Unassigned')} disabled />
            </ConfigField>
          </div>
        </DrawerBody>
        <DrawerFooter layout="equal">
          <DrawerClose asChild>
            <Button variant="outline">{t('agent_orchestrator.proposal.actions.cancelEdit', 'Cancel')}</Button>
          </DrawerClose>
          <Button disabled title={codeOnly}>{t('agent_orchestrator.agentDetail.config.save', 'Save')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
