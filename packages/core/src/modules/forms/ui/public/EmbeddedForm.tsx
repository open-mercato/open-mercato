"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FormRunner } from './FormRunner'
import {
  createAnonymousRuntimeClient,
  type PublicFormContext,
  type PublicStartResponse,
  type RuntimeClient,
} from './state/runtime-client'

/**
 * Single rendering primitive for every forms surface (spec
 * `2026-05-21-forms-render-surfaces.md`, D1/D2). It resolves the served form,
 * picks the right {@link RuntimeClient}, and mounts the shared `<FormRunner>`:
 *
 *  - `portal`       → authenticated portal customer; `FormRunner` builds its own
 *                     auth client (no bootstrap network round-trip).
 *  - `distribution` → anonymous open link (`/f/:slug`); resolve context → start
 *                     → anonymous token client.
 *  - `invitation`   → anonymous personal invite (`/i/:token`); same bootstrap.
 *
 * `<EmbeddedForm>` renders layout-free: it owns the loading / unavailable /
 * error / auth-required states but not the page chrome. Each surface (portal
 * page, public runner page, iframe host, dialog, injected widget) supplies its
 * own container.
 */
export type EmbeddedFormSource =
  | { kind: 'portal'; formKey: string; subjectType: string; subjectId: string }
  | { kind: 'distribution'; slug: string }
  | { kind: 'invitation'; token: string }

export type EmbeddedFormProps = {
  source: EmbeddedFormSource
  /** Optional "return to start" affordance forwarded to the completion screen. */
  onReturnHome?: () => void
  /** Optional wrapper class applied to the mounted runner. */
  className?: string
}

type BootstrapState =
  | { phase: 'loading' }
  | { phase: 'auth_required' }
  | { phase: 'unavailable'; message: string }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      context: PublicFormContext
      client: RuntimeClient
      subjectId: string
    }

function anonymousContextUrl(source: EmbeddedFormSource): string {
  if (source.kind === 'distribution') {
    return `/api/forms/public/distributions/${encodeURIComponent(source.slug)}`
  }
  if (source.kind === 'invitation') {
    return `/api/forms/public/invitations/${encodeURIComponent(source.token)}`
  }
  return ''
}

export function EmbeddedForm({ source, onReturnHome, className }: EmbeddedFormProps) {
  const t = useT()
  const isAnonymous = source.kind !== 'portal'
  const [state, setState] = React.useState<BootstrapState>({ phase: 'loading' })

  const bootstrapKey =
    source.kind === 'distribution'
      ? source.slug
      : source.kind === 'invitation'
        ? source.token
        : ''

  React.useEffect(() => {
    if (!isAnonymous) return
    if (!bootstrapKey) return
    let cancelled = false
    setState({ phase: 'loading' })

    async function bootstrap() {
      const contextResp = await apiCall<PublicFormContext>(anonymousContextUrl(source))
      if (cancelled) return
      if (contextResp.status === 410 || !contextResp.ok || !contextResp.result) {
        setState({
          phase: 'unavailable',
          message: t('forms.public.unavailable', {
            fallback: 'This form is no longer available.',
          }),
        })
        return
      }
      const context = contextResp.result
      if (context.requires_customer_auth) {
        setState({ phase: 'auth_required' })
        return
      }

      const startBody =
        source.kind === 'distribution'
          ? { slug: source.slug, locale: context.default_locale }
          : { token: (source as { token: string }).token, locale: context.default_locale }
      const startResp = await apiCall<PublicStartResponse>('/api/forms/public/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(startBody),
      })
      if (cancelled) return
      if (startResp.status === 409) {
        setState({ phase: 'auth_required' })
        return
      }
      if (startResp.status === 410) {
        setState({
          phase: 'unavailable',
          message: t('forms.public.unavailable', {
            fallback: 'This form is no longer available.',
          }),
        })
        return
      }
      if (!startResp.ok || !startResp.result) {
        setState({
          phase: 'error',
          message: t('forms.public.start_failed', {
            fallback: 'We could not open this form. Please try again later.',
          }),
        })
        return
      }

      const started = startResp.result
      const client = createAnonymousRuntimeClient({
        context,
        started,
        accessToken: started.access_token,
        mode: source.kind === 'distribution' ? 'open' : 'personal',
        slug: source.kind === 'distribution' ? source.slug : undefined,
        token: source.kind === 'invitation' ? source.token : undefined,
      })
      setState({
        phase: 'ready',
        context,
        client,
        subjectId: context.invitation?.id ?? started.submission.subjectId ?? '',
      })
    }

    bootstrap().catch((error) => {
      if (cancelled) return
      setState({
        phase: 'error',
        message:
          error instanceof Error
            ? error.message
            : t('forms.public.start_failed', {
                fallback: 'We could not open this form. Please try again later.',
              }),
      })
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapKey, isAnonymous])

  // ── Portal (authenticated) — no network bootstrap; FormRunner builds the
  // default auth client itself. Behaviour matches the pre-refactor portal page.
  if (source.kind === 'portal') {
    if (!source.subjectId) {
      return <LoadingState label={t('forms.runner.loading', { fallback: 'Loading form…' })} />
    }
    return (
      <div className={className}>
        <FormRunner
          formKey={source.formKey}
          subjectType={source.subjectType}
          subjectId={source.subjectId}
          onReturnHome={onReturnHome}
        />
      </div>
    )
  }

  if (state.phase === 'loading') {
    return <LoadingState label={t('forms.runner.loading', { fallback: 'Loading form…' })} />
  }

  if (state.phase === 'auth_required') {
    return (
      <Alert>
        <AlertTitle>{t('forms.public.auth_required.title', { fallback: 'Please sign in' })}</AlertTitle>
        <AlertDescription>
          {t('forms.public.auth_required.body', {
            fallback: 'This form requires a signed-in account. Please sign in to continue.',
          })}
        </AlertDescription>
      </Alert>
    )
  }

  if (state.phase === 'unavailable') {
    return (
      <Alert>
        <AlertTitle>{t('forms.public.unavailable.title', { fallback: 'Form unavailable' })}</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    )
  }

  if (state.phase === 'error') {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('forms.public.error.title', { fallback: 'Something went wrong' })}</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className={className}>
      <FormRunner
        formKey={state.context.form.key}
        subjectType="forms_invitation"
        subjectId={state.subjectId}
        client={state.client}
        onReturnHome={onReturnHome}
        completionTitle={state.context.completion?.title}
        completionMessage={state.context.completion?.message}
        redirectUrl={state.context.redirect_url}
      />
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Spinner className="h-5 w-5" />
      <span className="ml-2 text-sm">{label}</span>
    </div>
  )
}
