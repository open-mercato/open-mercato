"use client"

import { useState } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useT, useLocale } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { onboardingStartSchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'

type SubmissionState = 'idle' | 'loading' | 'success'
type FieldErrors = Partial<Record<
  'email' | 'firstName' | 'lastName' | 'organizationName' | 'password' | 'confirmPassword' | 'termsAccepted',
  string
>>

export default function INFOnboardingPage() {
  const t = useT()
  const translate = (key: string, fallback: string, params?: Record<string, string | number>) =>
    translateWithFallback(t, key, fallback, params)
  const locale = useLocale()
  const [state, setState] = useState<SubmissionState>('idle')
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [emailSubmitted, setEmailSubmitted] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
      termsAccepted: termsAccepted,
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
            issueMap.password = translate('onboarding.errors.passwordRequired', 'Password must be at least 6 characters.')
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
          body: JSON.stringify({ ...parsed.data, termsAccepted: true }),
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

  const submitting = state === 'loading'
  const disabled = submitting || state === 'success'

  return (
    <div className="min-h-svh w-full bg-[#0f0f0f]">
      <div className="flex min-h-svh items-center justify-center px-4 py-12">
        <Card className="w-full max-w-lg border-0 bg-[#1c1c1c] shadow-2xl">
          <CardHeader className="flex flex-col items-center gap-4 px-10 pt-10 pb-4">
            <div className="flex flex-col items-center gap-3">
              <Image
                src="/fms/inf-logo.svg"
                alt="INF Shipping Solutions"
                width={96}
                height={96}
              />
              <CardTitle className="text-2xl font-semibold flex justify-center text-white">
                {translate('onboarding.title', 'Create your workspace')}
              </CardTitle>
              <CardDescription className="flex justify-center text-gray-400">
                {translate('onboarding.subtitle', 'Tell us a bit about you and we will set everything up.')}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-10 pb-10">
            {state === 'success' && emailSubmitted && (
              <div className="mb-6 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400" role="status" aria-live="polite">
                <strong className="block text-sm font-medium">
                  {translate('onboarding.form.successTitle', 'Check your inbox')}
                </strong>
                <p>
                  {translate('onboarding.form.successBody', 'We sent a verification link to {email}. Confirm it within 24 hours to activate your workspace.', { email: emailSubmitted })}
                </p>
              </div>
            )}
            {state !== 'success' && globalError && (
              <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert" aria-live="assertive">
                {globalError}
              </div>
            )}
            <form className="grid gap-4" onSubmit={onSubmit} noValidate>
              <div className="grid gap-1">
                <Label htmlFor="email" className="text-gray-300">{translate('onboarding.form.email', 'Work email')}<span className="text-[#E67E5E]">*</span></Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  disabled={disabled}
                  autoComplete="email"
                  aria-invalid={Boolean(fieldErrors.email)}
                  className={`border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E] ${fieldErrors.email ? 'border-red-500 focus:ring-red-500' : ''}`}
                />
                {fieldErrors.email && (
                  <p className="text-xs text-red-400">{fieldErrors.email}</p>
                )}
              </div>
              <div className="grid gap-1 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-1">
                  <Label htmlFor="firstName" className="text-gray-300">{translate('onboarding.form.firstName', 'First name')}<span className="text-[#E67E5E]">*</span></Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    type="text"
                    required
                    disabled={disabled}
                    autoComplete="given-name"
                    className={`border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E] ${fieldErrors.firstName ? 'border-red-500 focus:ring-red-500' : ''}`}
                  />
                  {fieldErrors.firstName && (
                    <p className="text-xs text-red-400">{fieldErrors.firstName}</p>
                  )}
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="lastName" className="text-gray-300">{translate('onboarding.form.lastName', 'Last name')}<span className="text-[#E67E5E]">*</span></Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    type="text"
                    required
                    disabled={disabled}
                    autoComplete="family-name"
                    className={`border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E] ${fieldErrors.lastName ? 'border-red-500 focus:ring-red-500' : ''}`}
                  />
                  {fieldErrors.lastName && (
                    <p className="text-xs text-red-400">{fieldErrors.lastName}</p>
                  )}
                </div>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="organizationName" className="text-gray-300">{translate('onboarding.form.organizationName', 'Organization name')}<span className="text-[#E67E5E]">*</span></Label>
                <Input
                  id="organizationName"
                  name="organizationName"
                  type="text"
                  required
                  disabled={disabled}
                  autoComplete="organization"
                  className={`border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E] ${fieldErrors.organizationName ? 'border-red-500 focus:ring-red-500' : ''}`}
                />
                {fieldErrors.organizationName && (
                  <p className="text-xs text-red-400">{fieldErrors.organizationName}</p>
                )}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="password" className="text-gray-300">{translate('onboarding.form.password', 'Password')}<span className="text-[#E67E5E]">*</span></Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  disabled={disabled}
                  autoComplete="new-password"
                  className={`border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E] ${fieldErrors.password ? 'border-red-500 focus:ring-red-500' : ''}`}
                />
                {fieldErrors.password && (
                  <p className="text-xs text-red-400">{fieldErrors.password}</p>
                )}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="confirmPassword" className="text-gray-300">{translate('onboarding.form.confirmPassword', 'Confirm password')}<span className="text-[#E67E5E]">*</span></Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  disabled={disabled}
                  autoComplete="new-password"
                  className={`border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E] ${fieldErrors.confirmPassword ? 'border-red-500 focus:ring-red-500' : ''}`}
                />
                {fieldErrors.confirmPassword && (
                  <p className="text-xs text-red-400">{fieldErrors.confirmPassword}</p>
                )}
              </div>
              <label className="flex items-start gap-3 text-sm text-gray-400">
                <Checkbox
                  id="terms"
                  checked={termsAccepted}
                  disabled={disabled}
                  onCheckedChange={(value) => {
                    setTermsAccepted(value === true)
                    if (value === true) {
                      setFieldErrors((prev) => {
                        const next = { ...prev }
                        delete next.termsAccepted
                        return next
                      })
                    }
                  }}
                  className="border-gray-600 data-[state=checked]:bg-[#E67E5E] data-[state=checked]:border-[#E67E5E]"
                />
                <span>
                  {translate('onboarding.form.termsLabel', 'I have read and accept the')}{' '}
                  <a className="underline hover:text-gray-300" href="/terms" target="_blank" rel="noreferrer">
                    {translate('onboarding.form.termsLink', 'terms of service')}
                  </a>
                  {fieldErrors.termsAccepted && (
                    <span className="mt-1 block text-xs text-red-400">{fieldErrors.termsAccepted}</span>
                  )}
                </span>
              </label>
              <button
                type="submit"
                disabled={disabled}
                className="mt-2 h-11 rounded-full bg-[#E67E5E] text-white font-medium transition hover:bg-[#d9705a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? translate('onboarding.form.loading', 'Sending...')
                  : translate('onboarding.form.submit', 'Send verification email')}
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
