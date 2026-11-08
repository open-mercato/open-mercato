import * as React from 'react'
import { FileText, Mail } from 'lucide-react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import type { InboxProposalActionSourceRef } from '../../data/entities'

function describeRef(t: TranslateFn, ref: InboxProposalActionSourceRef): string {
  if (ref.kind !== 'attachment') return t('inbox_ops.attachments.sourceRefs.emailBody', 'Email body')
  const location = [
    ref.page ? t('inbox_ops.attachments.sourceRefs.page', 'page {page}', { page: ref.page }) : null,
    ref.sheet ? t('inbox_ops.attachments.sourceRefs.sheet', 'sheet {sheet}', { sheet: ref.sheet }) : null,
    ref.row ? t('inbox_ops.attachments.sourceRefs.row', 'row {row}', { row: ref.row }) : null,
  ].filter(Boolean).join(', ')
  const name = ref.fileName || t('inbox_ops.attachments.sourceRefs.attachment', 'Attachment')
  return location ? `${name} (${location})` : name
}

/**
 * Where the values of a proposed action came from: the cited file with its page or sheet, or the
 * email body, with the quoted snippet in a tooltip. Rendered inside the client `ActionCard`, so it
 * carries no client directive of its own.
 */
export function SourceRefs({ refs }: { refs?: InboxProposalActionSourceRef[] | null }) {
  const t = useT()
  if (!Array.isArray(refs) || refs.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{t('inbox_ops.attachments.sourceRefs.label', 'Sources')}</span>
      {refs.map((ref, index) => {
        const Icon = ref.kind === 'attachment' ? FileText : Mail
        return (
          <SimpleTooltip
            key={`${ref.kind}-${ref.attachmentId ?? 'body'}-${index}`}
            content={t('inbox_ops.attachments.sourceRefs.tooltip', 'Quoted: "{snippet}"', { snippet: ref.snippet })}
          >
            <span
              tabIndex={0}
              className="inline-flex max-w-xs items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              <Icon className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{describeRef(t, ref)}</span>
            </span>
          </SimpleTooltip>
        )
      })}
    </div>
  )
}
