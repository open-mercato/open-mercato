"use client"

/**
 * Surface S3 — generic, parameterized form-embed injection widget
 * (spec `2026-05-21-forms-render-surfaces.md`, D3).
 *
 * Mounts the shared `<EmbeddedForm>` rendering primitive into ANY spot a host
 * module declares it against, so a runnable form can be dropped onto a customer
 * record, a deal page, a portal screen, etc. — without forking `<FormRunner>`.
 *
 * Host prop contract (passed through the `<InjectionSpot>` context bag):
 *
 *   context.source       (required) — an `EmbeddedFormSource` discriminator:
 *     • { kind: 'portal', formKey, subjectType, subjectId }  → authenticated
 *       in-app / portal placement (uses the auth runtime client).
 *     • { kind: 'distribution', slug }                       → anonymous open
 *       link (uses the anonymous runtime client).
 *     • { kind: 'invitation', token }                        → anonymous
 *       personal invite.
 *   context.onReturnHome (optional) — forwarded to the completion screen.
 *   context.className    (optional) — wrapper class for the mounted runner.
 *
 * Props are validated defensively at runtime (no `any`): a malformed or absent
 * `source` renders nothing (returns `null`) rather than crashing the host page.
 * The widget itself adds no feature gate beyond `forms.view`; the host page's
 * own guard governs who can place/see it (spec § Security S3-admin).
 */

import * as React from 'react'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { EmbeddedForm } from '../../../ui/public'
import type { EmbeddedFormSource } from '../../../ui/public'

export type EmbeddedFormWidgetContext = {
  source?: unknown
  onReturnHome?: unknown
  className?: unknown
  sharedState?: Record<string, unknown>
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function narrowSource(value: unknown): EmbeddedFormSource | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'portal') {
    if (
      isNonEmptyString(candidate.formKey) &&
      isNonEmptyString(candidate.subjectType) &&
      isNonEmptyString(candidate.subjectId)
    ) {
      return {
        kind: 'portal',
        formKey: candidate.formKey,
        subjectType: candidate.subjectType,
        subjectId: candidate.subjectId,
      }
    }
    return null
  }
  if (candidate.kind === 'distribution') {
    return isNonEmptyString(candidate.slug) ? { kind: 'distribution', slug: candidate.slug } : null
  }
  if (candidate.kind === 'invitation') {
    return isNonEmptyString(candidate.token) ? { kind: 'invitation', token: candidate.token } : null
  }
  return null
}

type EmbeddedFormWidgetProps = {
  context: EmbeddedFormWidgetContext
}

export function EmbeddedFormWidget({ context }: EmbeddedFormWidgetProps) {
  const source = narrowSource(context?.source)
  if (!source) return null

  const onReturnHome =
    typeof context?.onReturnHome === 'function'
      ? (context.onReturnHome as () => void)
      : undefined
  const className = isNonEmptyString(context?.className) ? context.className : undefined

  return <EmbeddedForm source={source} onReturnHome={onReturnHome} className={className} />
}

const widget: InjectionWidgetModule<EmbeddedFormWidgetContext> = {
  metadata: {
    id: 'forms.injection.embedded-form',
    title: 'Forms Embedded Form',
    description:
      'Generic, parameterized widget that renders a runnable form anywhere via the shared <EmbeddedForm> primitive. The host supplies an EmbeddedFormSource through the injection context.',
    features: ['forms.view'],
    priority: 100,
    enabled: true,
  },
  Widget: EmbeddedFormWidget,
}

export default widget
