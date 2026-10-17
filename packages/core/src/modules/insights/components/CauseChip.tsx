import * as React from 'react'
import Link from 'next/link'
import {
  Bot,
  CalendarClock,
  CircleHelp,
  Cog,
  KeyRound,
  Radio,
  Redo2,
  RefreshCw,
  Scale,
  Sparkles,
  Undo2,
  User,
  Wand2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { CauseKind } from '@open-mercato/shared/lib/causation/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { isSafeInternalHref } from '../lib/client/explainApi'
import type { ExplainCauseFrameView } from '../lib/client/types'

export const CAUSE_KIND_ICONS: Record<CauseKind, LucideIcon> = {
  user: User,
  api_key: KeyRound,
  agent: Bot,
  workflow: Workflow,
  business_rule: Scale,
  ai_action: Sparkles,
  ai_tool: Wand2,
  sync_run: RefreshCw,
  schedule: CalendarClock,
  subscriber: Radio,
  undo: Undo2,
  redo: Redo2,
  system: Cog,
  unknown: CircleHelp,
}

export type CauseChipProps = {
  cause: ExplainCauseFrameView
  className?: string
}

export function CauseChip({ cause, className }: CauseChipProps) {
  const t = useT()
  const Icon = CAUSE_KIND_ICONS[cause.kind] ?? CircleHelp
  const kindLabel = t(`insights.explain.causeKinds.${cause.kind}`)
  const detailLabel = cause.available && typeof cause.label === 'string' && cause.label.trim().length > 0
    ? cause.label
    : null
  const text = detailLabel ? t('insights.why.cause.withLabel', { kind: kindLabel, label: detailLabel }) : kindLabel
  const href = cause.available && isSafeInternalHref(cause.href) ? cause.href : null
  return (
    <span
      data-cause-kind={cause.kind}
      data-cause-available={cause.available ? 'true' : 'false'}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-1 text-xs',
        cause.available ? 'bg-background text-foreground' : 'bg-muted/30 text-muted-foreground',
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {href ? (
        <LinkButton asChild variant="black" size="sm" underline="always" className="min-w-0 truncate">
          <Link href={href}>{text}</Link>
        </LinkButton>
      ) : (
        <span className="min-w-0 truncate">{text}</span>
      )}
      {cause.available ? null : (
        <span className="shrink-0">{t('insights.why.cause.unavailableNote')}</span>
      )}
    </span>
  )
}

export default CauseChip
