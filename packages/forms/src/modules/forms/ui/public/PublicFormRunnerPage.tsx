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
 * Shared bootstrap for the two public runner entry points (`/f/:slug` open
 * links and `/i/:token` personal invitations). It resolves the served form
 * context, begins an anonymous submission to obtain an access token, builds an
 * anonymous {@link RuntimeClient}, and renders the same `<FormRunner>` the
 * authenticated portal uses. No portal auth; minimal centered layout.
 */
export type PublicFormRunnerPageProps =
  | { mode: 'open'; slug: string }
  | { mode: 'personal'; token: string }

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

function contextUrl(props: PublicFormRunnerPageProps): string {
  return props.mode === 'open'
    ? `/api/forms/public/distributions/${encodeURIComponent(props.slug)}`
    : `/api/forms/public/invitations/${encodeURIComponent(props.token)}`
}

export function PublicFormRunnerPage(props: PublicFormRunnerPageProps) {
  const t = useT()
  const [state, setState] = React.useState<BootstrapState>({ phase: 'loading' })

  const key = props.mode === 'open' ? props.slug : props.token

  React.useEffect(() => {
    let cancelled = false
    if (!key) return

    async function bootstrap() {
      const contextResp = await apiCall<PublicFormContext>(contextUrl(props))
      if (cancelled) return
      if (contextResp.status === 410) {
        setState({
          phase: 'unavailable',
          message: t('forms.public.unavailable', {
            fallback: 'This form is no longer available.',
          }),
        })
        return
      }
      if (!contextResp.ok || !contextResp.result) {
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
        props.mode === 'open'
          ? { slug: props.slug, locale: context.default_locale }
          : { token: props.token, locale: context.default_locale }
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
        mode: props.mode,
        slug: props.mode === 'open' ? props.slug : undefined,
        token: props.mode === 'personal' ? props.token : undefined,
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
  }, [key])

  if (state.phase === 'loading') {
    return (
      <PublicLayout>
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Spinner className="h-5 w-5" />
          <span className="ml-2 text-sm">
            {t('forms.runner.loading', { fallback: 'Loading form…' })}
          </span>
        </div>
      </PublicLayout>
    )
  }

  if (state.phase === 'auth_required') {
    return (
      <PublicLayout>
        <Alert>
          <AlertTitle>
            {t('forms.public.auth_required.title', { fallback: 'Please sign in' })}
          </AlertTitle>
          <AlertDescription>
            {t('forms.public.auth_required.body', {
              fallback: 'This form requires a signed-in account. Please sign in to continue.',
            })}
          </AlertDescription>
        </Alert>
      </PublicLayout>
    )
  }

  if (state.phase === 'unavailable') {
    return (
      <PublicLayout>
        <Alert>
          <AlertTitle>
            {t('forms.public.unavailable.title', { fallback: 'Form unavailable' })}
          </AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </PublicLayout>
    )
  }

  if (state.phase === 'error') {
    return (
      <PublicLayout>
        <Alert variant="destructive">
          <AlertTitle>
            {t('forms.public.error.title', { fallback: 'Something went wrong' })}
          </AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <FormRunner
        formKey={state.context.form.key}
        subjectType="forms_invitation"
        subjectId={state.subjectId}
        client={state.client}
        completionTitle={state.context.completion?.title}
        completionMessage={state.context.completion?.message}
        redirectUrl={state.context.redirect_url}
      />
    </PublicLayout>
  )
}

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </main>
  )
}
