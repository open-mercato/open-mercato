'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { formatPasswordRequirements, getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { onboardingStartSchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'

type SubmissionState = 'idle' | 'loading' | 'success'
type FieldErrors = Partial<Record<
  'email' | 'firstName' | 'lastName' | 'organizationName' | 'password' | 'confirmPassword' | 'termsAccepted' | 'marketingConsent',
  string
>>

type Props = {
  onboardingEnabled: boolean
}

export default function OnboardingPageClient({ onboardingEnabled }: Props) {
  const t = useT()
  const translate = (key: string, fallback: string, params?: Record<string, string | number>) =>
    translateWithFallback(t, key, fallback, params)
  const locale = useLocale()
  const [state, setState] = useState<SubmissionState>('idle')
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [emailSubmitted, setEmailSubmitted] = useState<string | null>(null)
  const passwordPolicy = getPasswordPolicy()
  const passwordRequirements = formatPasswordRequirements(passwordPolicy, translate, 'onboarding.password.requirements')
  const passwordDescription = passwordRequirements
    ? translate(
        'onboarding.password.requirements.help',
        'Password requirements: {requirements}',
        { requirements: passwordRequirements },
      )
    : ''

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onboardingEnabled) return

    setState('loading')
    setGlobalError(null)
    setFieldErrors({})

    const form = new FormData(event.currentTarget)
    const payload = {
      email: String(form.get('email') ?? '').trim(),
      firstName: String(form.get('firstName') ?? '').trim(),
      lastName: String(form.get('lastName') ?? '').trim(),
      organizationName: String(form.get('organizationName') ?? '').trim(),
      password: String(form.get('password') ?? ''),
      confirmPassword: String(form.get('confirmPassword') ?? ''),
      termsAccepted,
      marketingConsent,
      locale,
    }

    const parsed = onboardingStartSchema.safeParse(payload)
    if (!parsed.success) {
      const issueMap: FieldErrors = {}
      parsed.error.issues.forEach((issue) => {
        const path = issue.path[0]
        if (!path) return
        switch (path) {
          case 'email':
            issueMap.email = translate('onboarding.errors.emailInvalid', 'Enter a valid work email.')
            break
          case 'firstName':
            issueMap.firstName = translate('onboarding.errors.firstNameRequired', 'First name is required.')
            break
          case 'lastName':
            issueMap.lastName = translate('onboarding.errors.lastNameRequired', 'Last name is required.')
            break
          case 'organizationName':
            issueMap.organizationName = translate('onboarding.errors.organizationNameRequired', 'Organization name is required.')
            break
          case 'password':
            issueMap.password = translate(
              'onboarding.errors.passwordRequired',
              'Password must meet the requirements: {requirements}.',
              { requirements: passwordRequirements },
            )
            break
          case 'confirmPassword':
            issueMap.confirmPassword = translate('onboarding.errors.passwordMismatch', 'Passwords must match.')
            break
          case 'termsAccepted':
            issueMap.termsAccepted = translate('onboarding.form.termsRequired', 'Please accept the terms to continue.')
            break
          default:
            break
        }
      })
      if (!issueMap.termsAccepted && !termsAccepted) {
        issueMap.termsAccepted = translate('onboarding.form.termsRequired', 'Please accept the terms to continue.')
      }
      setFieldErrors(issueMap)
      setState('idle')
      return
    }

    try {
      const call = await apiCall<{ ok?: boolean; error?: string; email?: string; fieldErrors?: Record<string, string> }>(
        '/api/onboarding/onboarding',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...parsed.data, termsAccepted: true, marketingConsent }),
        },
      )
      const data = call.result ?? {}
      if (!call.ok || data.ok === false) {
        if (data.fieldErrors && typeof data.fieldErrors === 'object') {
          const mapped: FieldErrors = {}
          for (const key of Object.keys(data.fieldErrors)) {
            const value = data.fieldErrors[key]
            if (typeof value === 'string' && value.trim()) {
              mapped[key as keyof FieldErrors] = value
            }
          }
          setFieldErrors(mapped)
        }
        const message = typeof data.error === 'string' && data.error.trim()
          ? data.error
          : translate('onboarding.form.genericError', 'Something went wrong. Please try again.')
        setGlobalError(message)
        setState('idle')
        return
      }
      setEmailSubmitted(data.email ?? parsed.data.email)
      setState('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setGlobalError(message || translate('onboarding.form.genericError', 'Something went wrong. Please try again.'))
      setState('idle')
    }
  }

  const onboardingDisabled = !onboardingEnabled
  const submitting = state === 'loading'
  const disabled = onboardingDisabled || submitting || state === 'success'

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/40 px-4 pb-24">
      <Card className="relative w-full max-w-lg overflow-hidden shadow-lg">
        {onboardingDisabled ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70 p-6 backdrop-blur-[2px]">
            <div
              className="max-w-sm rounded-xl border border-border/70 bg-background/95 px-5 py-4 text-center shadow-sm"
              role="alert"
              aria-live="polite"
            >
              <p className="text-base font-semibold text-foreground">
                {translate('onboarding.disabled.title', 'Self-service onboarding is currently unavailable')}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {translate(
                  'onboarding.disabled.description',
                  'Workspace creation is currently handled manually. Contact the Open Mercato team or your administrator to request access before continuing.',
                )}
              </p>
              <div className="mt-4 flex justify-center">
                <Button asChild variant="outline">
                  <Link href="/login">
                    {translate('onboarding.disabled.cta', 'Go to login')}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        <CardHeader className="flex flex-col gap-4 p-10 text-center">
          <div className="flex flex-col items-center gap-3">
            <Image alt="Open Mercato" src="/open-mercato.svg" width={120} height={120} priority />
            <CardTitle className="text-2xl font-semibold">
              {translate('onboarding.title', 'Create your Open Mercato workspace')}
            </CardTitle>
            <CardDescription>
              {translate('onboarding.subtitle', 'Tell us a bit about you and we will set everything up.')}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className={onboardingDisabled ? 'pb-10 opacity-45' : 'pb-10'}>
          {state === 'success' && emailSubmitted && (
            <div className="mb-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status" aria-live="polite">
              <strong className="block text-sm font-medium">
                {translate('onboarding.form.successTitle', 'Check your inbox')}
              </strong>
              <p>
                {translate('onboarding.form.successBody', 'We sent a verification link to {email}. Confirm it within 24 hours to activate your workspace.', { email: emailSubmitted })}
              </p>
            </div>
          )}
          {state !== 'success' && globalError && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert" aria-live="assertive">
              {globalError}
            </div>
          )}
          <form className="grid gap-4" onSubmit={onSubmit} noValidate>
            <div className="grid gap-1">
              <Label htmlFor="email">{translate('onboarding.form.email', 'Work email')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                disabled={disabled}
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                className={fieldErrors.email ? 'border-red-500 focus-visible:ring-red-500' : undefined}
              />
              {fieldErrors.email && (
                <p id="email-error" className="text-xs text-red-600">{fieldErrors.email}</p>
              )}
            </div>
            <div className="grid gap-1 sm:grid-cols-2 sm:gap-4">
              <div className="grid gap-1">
                <Label htmlFor="firstName">{translate('onboarding.form.firstName', 'First name')}</Label>
                <Input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  disabled={disabled}
                  autoComplete="given-name"
                  aria-invalid={Boolean(fieldErrors.firstName)}
                  aria-describedby={fieldErrors.firstName ? 'firstName-error' : undefined}
                  className={fieldErrors.firstName ? 'border-red-500 focus-visible:ring-red-500' : undefined}
                />
                {fieldErrors.firstName && (
                  <p id="firstName-error" className="text-xs text-red-600">{fieldErrors.firstName}</p>
                )}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="lastName">{translate('onboarding.form.lastName', 'Last name')}</Label>
                <Input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  disabled={disabled}
                  autoComplete="family-name"
                  aria-invalid={Boolean(fieldErrors.lastName)}
                  aria-describedby={fieldErrors.lastName ? 'lastName-error' : undefined}
                  className={fieldErrors.lastName ? 'border-red-500 focus-visible:ring-red-500' : undefined}
                />
                {fieldErrors.lastName && (
                  <p id="lastName-error" className="text-xs text-red-600">{fieldErrors.lastName}</p>
                )}
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="organizationName">{translate('onboarding.form.organizationName', 'Organization name')}</Label>
              <Input
                id="organizationName"
                name="organizationName"
                type="text"
                required
                disabled={disabled}
                autoComplete="organization"
                aria-invalid={Boolean(fieldErrors.organizationName)}
                aria-describedby={fieldErrors.organizationName ? 'organizationName-error' : undefined}
                className={fieldErrors.organizationName ? 'border-red-500 focus-visible:ring-red-500' : undefined}
              />
              {fieldErrors.organizationName && (
                <p id="organizationName-error" className="text-xs text-red-600">{fieldErrors.organizationName}</p>
              )}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="password">{translate('onboarding.form.password', 'Password')}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                disabled={disabled}
                autoComplete="new-password"
                minLength={passwordPolicy.minLength}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                className={fieldErrors.password ? 'border-red-500 focus-visible:ring-red-500' : undefined}
              />
              {passwordDescription ? (
                <p className="text-xs text-muted-foreground">{passwordDescription}</p>
              ) : null}
              {fieldErrors.password && (
                <p id="password-error" className="text-xs text-red-600">{fieldErrors.password}</p>
              )}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="confirmPassword">{translate('onboarding.form.confirmPassword', 'Confirm password')}</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                disabled={disabled}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                aria-describedby={fieldErrors.confirmPassword ? 'confirmPassword-error' : undefined}
                className={fieldErrors.confirmPassword ? 'border-red-500 focus-visible:ring-red-500' : undefined}
              />
              {fieldErrors.confirmPassword && (
                <p id="confirmPassword-error" className="text-xs text-red-600">{fieldErrors.confirmPassword}</p>
              )}
            </div>
            <label className="flex items-start gap-3 text-sm text-muted-foreground">
              <Checkbox
                id="terms"
                checked={termsAccepted}
                disabled={disabled}
                onCheckedChange={(value: boolean | 'indeterminate') => {
                  setTermsAccepted(value === true)
                  if (value === true) {
                    setFieldErrors((prev) => {
                      const next = { ...prev }
                      delete next.termsAccepted
                      return next
                    })
                  }
                }}
                aria-invalid={Boolean(fieldErrors.termsAccepted)}
              />
              <span>
                {translate('onboarding.form.termsLabel', 'I have read and accept the ')}
                <a className="underline hover:text-foreground" href="/terms" target="_blank" rel="noreferrer">
                  {translate('onboarding.form.termsLink', 'Terms of Service')}
                </a>
                {translate('onboarding.form.termsAnd', ' and ')}
                <a className="underline hover:text-foreground" href="/privacy" target="_blank" rel="noreferrer">
                  {translate('onboarding.form.privacyLink', 'Privacy Policy')}
                </a>
                {fieldErrors.termsAccepted && (
                  <span className="mt-1 block text-xs text-red-600">{fieldErrors.termsAccepted}</span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-muted-foreground">
              <Checkbox
                id="marketingConsent"
                checked={marketingConsent}
                disabled={disabled}
                onCheckedChange={(value: boolean | 'indeterminate') => {
                  setMarketingConsent(value === true)
                }}
              />
              <span>
                {translate(
                  'onboarding.form.marketingLabel',
                  "I consent to receiving direct marketing from CT Tornado by email at the address I provide. I'm aware that I can withdraw my consent at any time (e.g., via the unsubscribe link), and that CT Tornado may also process my email address under its legitimate interests to manage its mailing list, keep proof of my consent, and record opt-outs. See our {termsLink} and {privacyLink}.",
                )
                  .split(/{termsLink}|{privacyLink}/)
                  .map((part, index, parts) => (
                    <span key={index}>
                      {part}
                      {index < parts.length - 1 && (
                        index === 0 ? (
                          <a className="underline hover:text-foreground" href="/terms" target="_blank" rel="noreferrer">
                            {translate('onboarding.form.termsLink', 'Terms of Service')}
                          </a>
                        ) : (
                          <a className="underline hover:text-foreground" href="/privacy" target="_blank" rel="noreferrer">
                            {translate('onboarding.form.privacyLink', 'Privacy Policy')}
                          </a>
                        )
                      )}
                    </span>
                  ))}
              </span>
            </label>
            <Button
              type="submit"
              disabled={disabled}
              className="mt-2 h-11 bg-foreground text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? translate('onboarding.form.loading', 'Sending...')
                : translate('onboarding.form.submit', 'Send verification email')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
