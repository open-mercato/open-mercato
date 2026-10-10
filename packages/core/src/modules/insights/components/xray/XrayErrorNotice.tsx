"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { XrayRequestError } from '../../lib/client/xray/api'

/** Error codes of the X-Ray routes that have a translated message (`insights.xray.errors.<code>`). */
export const XRAY_KNOWN_ERROR_CODES = new Set([
  'busy',
  'command_forbidden',
  'conformance_model_missing',
  'conformance_workflow_not_found',
  'disabled',
  'drafted_artifact_not_found',
  'filter_too_narrow',
  'individuals_denied',
  'internal_error',
  'invalid_request',
  'invalid_window',
  'organization_required',
  'process_not_found',
  'projection_incomplete',
  'query_timeout',
  'result_too_large',
  'suggestion_not_found',
  'suggestion_superseded',
  'tenant_required',
  'too_many_models',
  'unauthorized',
  'variant_not_draftable',
  'variant_not_found',
  'window_too_large',
  'workflow_draft_invalid',
  'workflows_unavailable',
])

const ERROR_CODE_KEYS: Record<string, string> = {
  no_processes: 'insights.xray.errors.noProcesses',
}

const BACKGROUND_ANALYSIS_CODES = new Set(['window_too_large', 'query_timeout', 'result_too_large'])

/** The translated message of an X-Ray error: the code's own text, else a generic failure. */
export function describeXrayError(error: XrayRequestError | null | undefined, t: TranslateFn, fallbackKey = 'insights.xray.ui.errors.loadFailed'): string {
  if (error?.code && ERROR_CODE_KEYS[error.code]) return t(ERROR_CODE_KEYS[error.code])
  if (error?.code && XRAY_KNOWN_ERROR_CODES.has(error.code)) return t(`insights.xray.errors.${error.code}`)
  if (error?.httpStatus === 403) return t('insights.xray.ui.errors.forbidden')
  return t(fallbackKey)
}

export type XrayErrorNoticeProps = {
  error: XrayRequestError
  onClearActorFilters?: () => void
  onRetry?: () => void
}

/**
 * Explains why an analytics read was refused. Privacy refusals are shown as guidance, not as
 * failures: a role / team filter that would single out a small group (`filter_too_narrow`)
 * offers to clear it, per-person refusals name the reason, and over-large windows suggest a
 * shorter window or a background analysis. No counts are ever part of these answers.
 */
export function XrayErrorNotice({ error, onClearActorFilters, onRetry }: XrayErrorNoticeProps) {
  const t = useT()
  if (error.code === 'filter_too_narrow') {
    return (
      <Alert
        status="warning"
        size="default"
        data-testid="xray-filter-too-narrow"
        footer={onClearActorFilters ? (
          <Button type="button" size="sm" variant="outline" onClick={onClearActorFilters}>
            {t('insights.xray.ui.errors.clearActorFilters')}
          </Button>
        ) : undefined}
      >
        <AlertTitle>{t('insights.xray.ui.errors.filterTooNarrowTitle')}</AlertTitle>
        <AlertDescription>{t('insights.xray.ui.errors.filterTooNarrowDescription')}</AlertDescription>
      </Alert>
    )
  }
  if (error.code === 'individuals_denied') {
    return (
      <Alert status="information" size="default" data-testid="xray-individuals-denied">
        <AlertTitle>{t('insights.xray.errors.individuals_denied')}</AlertTitle>
        <AlertDescription>{t('insights.xray.ui.errors.individualsDeniedReason')}</AlertDescription>
      </Alert>
    )
  }
  if (error.code && BACKGROUND_ANALYSIS_CODES.has(error.code)) {
    return (
      <Alert status="warning" size="default" data-testid={`xray-error-${error.code}`}>
        <AlertTitle>{t(`insights.xray.errors.${error.code}`)}</AlertTitle>
        <AlertDescription>{t('insights.xray.ui.errors.backgroundAnalysisHint')}</AlertDescription>
      </Alert>
    )
  }
  return (
    <ErrorMessage
      label={describeXrayError(error, t)}
      action={onRetry ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {t('insights.xray.ui.actions.retry')}
        </Button>
      ) : undefined}
    />
  )
}
