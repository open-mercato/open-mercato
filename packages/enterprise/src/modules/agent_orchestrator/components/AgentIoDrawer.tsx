"use client"

import * as React from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
} from '@open-mercato/ui/primitives/drawer'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { RunView } from './types'

export type AgentIoDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  run: RunView | null
  tools?: string[]
}

/**
 * Right-side panel showing the agent run's Input / Output / Tools used.
 * Drawer (Radix Dialog under the hood) handles Escape-to-close and
 * outside-click dismissal natively.
 */
export function AgentIoDrawer({ open, onOpenChange, run, tools }: AgentIoDrawerProps) {
  const t = useT()
  const toolList = tools && tools.length > 0 ? tools : []

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right">
        <DrawerHeader>
          <span className="text-xs font-medium uppercase tracking-wide text-brand-violet">
            {t('agent_orchestrator.proposal.drawer.agentLane')}
          </span>
          <DrawerTitle>{t('agent_orchestrator.proposal.drawer.title')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="space-y-6">
          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.proposal.io.input')} />
            {run?.input != null ? (
              <JsonDisplay data={run.input} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('agent_orchestrator.proposal.drawer.noInput')}
              </p>
            )}
          </section>

          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.proposal.io.output')} />
            {run?.output != null ? (
              <JsonDisplay data={run.output} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('agent_orchestrator.proposal.drawer.noOutput')}
              </p>
            )}
          </section>

          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.proposal.io.tools')} count={toolList.length} />
            {toolList.length > 0 ? (
              <ul className="space-y-1">
                {toolList.map((tool) => (
                  <li key={tool} className="flex items-center gap-2 text-sm">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-violet" />
                    <span className="font-mono text-xs">{tool}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('agent_orchestrator.proposal.drawer.noTools')}
              </p>
            )}
          </section>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}

export default AgentIoDrawer
