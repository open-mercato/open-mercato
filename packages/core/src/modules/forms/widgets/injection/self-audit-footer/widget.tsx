"use client"

/**
 * Phase 2b — SelfAuditFooter injection widget.
 *
 * Mounts into the submission drawer's `submission-drawer:footer` spot. Renders
 * the static informational note that opening this drawer is itself written to
 * the access-audit log (purpose: view). Purely informational — no I/O, no
 * mutation. Reuses the existing `forms.drawer.audit_note` i18n key.
 *
 * Feature-gated behind `forms.view` to match every other admin submission
 * surface.
 */

import * as React from 'react'
import { ShieldCheck } from 'lucide-react'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FormsDrawerWidgetContext } from '../context'

type SelfAuditFooterProps = {
  context: FormsDrawerWidgetContext
}

export function SelfAuditFooterWidget({ context }: SelfAuditFooterProps) {
  const t = useT()
  if (!context?.submissionId) return null
  return (
    <p
      className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
      data-forms-self-audit-footer=""
    >
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
      <span>
        {t('forms.drawer.audit_note', {
          fallback: 'This view is being written to the access audit log — purpose: view.',
        })}
      </span>
    </p>
  )
}

const widget: InjectionWidgetModule<FormsDrawerWidgetContext> = {
  metadata: {
    id: 'forms.injection.self-audit-footer',
    title: 'Forms Submission Self-Audit Footer',
    description:
      'Static "this view is logged" note mounted in the submission drawer footer (purpose: view).',
    features: ['forms.view'],
    priority: 100,
    enabled: true,
  },
  Widget: SelfAuditFooterWidget,
}

export default widget
