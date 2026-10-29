"use client"

import * as React from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
} from '@open-mercato/ui/primitives/drawer'
import { Brain } from 'lucide-react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SkillDetailView } from './types'

export type SkillDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: SkillDetailView | null
}

/**
 * Right-side panel showing a skill's full instructions (rendered as markdown —
 * skills are authored as SKILL.md files) plus the read-only tools it contributes.
 */
export function SkillDrawer({ open, onOpenChange, skill }: SkillDrawerProps) {
  const t = useT()

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right">
        <DrawerHeader leading={<Brain className="size-5" />}>
          <span className="text-xs font-medium uppercase tracking-wide text-brand-violet">
            {t('agent_orchestrator.agentDetail.fields.skills')}
          </span>
          <DrawerTitle>{skill?.label ?? t('agent_orchestrator.agentDetail.title')}</DrawerTitle>
          {skill ? <p className="font-mono text-xs text-muted-foreground">{skill.id}</p> : null}
        </DrawerHeader>
        <DrawerBody className="space-y-6">
          {skill?.description ? (
            <p className="text-sm text-muted-foreground">{skill.description}</p>
          ) : null}

          {skill && skill.tools.length ? (
            <section className="space-y-2">
              <SectionHeader title={t('agent_orchestrator.agentDetail.skillTools')} count={skill.tools.length} />
              <div className="flex flex-wrap gap-1">
                {skill.tools.map((tool) => (
                  <Tag key={tool} variant="neutral">{tool}</Tag>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.agentDetail.fields.instructions')} />
            {skill?.instructions ? (
              <MarkdownContent
                body={skill.instructions}
                format="markdown"
                className="text-sm leading-relaxed text-foreground [&>*:first-child]:mt-0 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:hidden [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:border-t [&_h2]:border-border [&_h2]:pt-5 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-muted-foreground [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2.5 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:marker:text-muted-foreground"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.defaultValue')}</p>
            )}
          </section>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}

export default SkillDrawer
