"use client"

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useT, useLocale } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { onboardingStartSchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import { Footer } from '../components/Footer'

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
            issueMap.email = translate('onboarding.errors.emailInvalid', 'Wprowadź poprawny adres e-mail.')
            break
          case 'firstName':
            issueMap.firstName = translate('onboarding.errors.firstNameRequired', 'Imię jest wymagane.')
            break
          case 'lastName':
            issueMap.lastName = translate('onboarding.errors.lastNameRequired', 'Nazwisko jest wymagane.')
            break
          case 'organizationName':
            issueMap.organizationName = translate('onboarding.errors.organizationNameRequired', 'Nazwa firmy jest wymagana.')
            break
          case 'password':
            issueMap.password = translate('onboarding.errors.passwordRequired', 'Hasło musi mieć co najmniej 6 znaków.')
            break
          case 'confirmPassword':
            issueMap.confirmPassword = translate('onboarding.errors.passwordMismatch', 'Hasła muszą być takie same.')
            break
          case 'termsAccepted':
            issueMap.termsAccepted = translate('onboarding.form.termsRequired', 'Proszę zaakceptować regulamin.')
            break
          default:
            break
        }
      })
      if (!issueMap.termsAccepted && !termsAccepted) {
        issueMap.termsAccepted = translate('onboarding.form.termsRequired', 'Proszę zaakceptować regulamin.')
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
          : translate('onboarding.form.genericError', 'Coś poszło nie tak. Spróbuj ponownie.')
        setGlobalError(message)
        setState('idle')
        return
      }
      setEmailSubmitted(data.email ?? parsed.data.email)
      setState('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setGlobalError(message || translate('onboarding.form.genericError', 'Coś poszło nie tak. Spróbuj ponownie.'))
      setState('idle')
    }
  }

  const submitting = state === 'loading'
  const disabled = submitting || state === 'success'

  return (
    <main className="min-h-svh w-full bg-white">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-[#1B4D5C] to-[#2a6a7a] py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              {translate('onboarding.heroTitle', 'Dołącz do INF Shipping')}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              {translate('onboarding.heroSubtitle', 'Stwórz konto i zacznij korzystać z naszych usług transportowych i logistycznych')}
            </p>
          </div>
        </div>
        {/* Decorative wave */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg className="w-full h-12 text-gray-50" viewBox="0 0 1440 48" fill="currentColor" preserveAspectRatio="none">
            <path d="M0,48 L1440,48 L1440,0 C1200,32 960,48 720,48 C480,48 240,32 0,0 L0,48 Z" />
          </svg>
        </div>
      </section>

      {/* Form Section */}
      <section className="bg-gray-50 py-16 lg:py-24">
        <div className="mx-auto max-w-xl px-6 lg:px-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm lg:p-10">
            <div className="mb-8 flex flex-col items-center gap-4">
              <Link href="/inf">
                <Image
                  src="/fms/inf-logo.svg"
                  alt="INF Shipping Solutions"
                  width={80}
                  height={80}
                />
              </Link>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-[#1B4D5C]">
                  {translate('onboarding.title', 'Utwórz konto')}
                </h2>
                <p className="mt-2 text-gray-600">
                  {translate('onboarding.subtitle', 'Wypełnij formularz, a my zajmiemy się resztą.')}
                </p>
              </div>
            </div>

            {state === 'success' && emailSubmitted && (
              <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800" role="status" aria-live="polite">
                <strong className="block font-semibold">
                  {translate('onboarding.form.successTitle', 'Sprawdź swoją skrzynkę')}
                </strong>
                <p className="mt-1">
                  {translate('onboarding.form.successBody', 'Wysłaliśmy link weryfikacyjny na {email}. Potwierdź go w ciągu 24 godzin, aby aktywować konto.', { email: emailSubmitted })}
                </p>
              </div>
            )}

            {state !== 'success' && globalError && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800" role="alert" aria-live="assertive">
                {globalError}
              </div>
            )}

            <form className="grid gap-5" onSubmit={onSubmit} noValidate>
              <div className="grid gap-1.5">
                <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                  {translate('onboarding.form.email', 'Adres e-mail')}<span className="text-[#EB5C2E]">*</span>
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  disabled={disabled}
                  autoComplete="email"
                  placeholder="jan.kowalski@firma.pl"
                  aria-invalid={Boolean(fieldErrors.email)}
                  className={`h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#1B4D5C] focus:ring-[#1B4D5C] ${fieldErrors.email ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                />
                {fieldErrors.email && (
                  <p className="text-xs text-red-600">{fieldErrors.email}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="firstName" className="text-sm font-medium text-gray-700">
                    {translate('onboarding.form.firstName', 'Imię')}<span className="text-[#EB5C2E]">*</span>
                  </Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    type="text"
                    required
                    disabled={disabled}
                    autoComplete="given-name"
                    placeholder="Jan"
                    className={`h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#1B4D5C] focus:ring-[#1B4D5C] ${fieldErrors.firstName ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                  />
                  {fieldErrors.firstName && (
                    <p className="text-xs text-red-600">{fieldErrors.firstName}</p>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="lastName" className="text-sm font-medium text-gray-700">
                    {translate('onboarding.form.lastName', 'Nazwisko')}<span className="text-[#EB5C2E]">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    type="text"
                    required
                    disabled={disabled}
                    autoComplete="family-name"
                    placeholder="Kowalski"
                    className={`h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#1B4D5C] focus:ring-[#1B4D5C] ${fieldErrors.lastName ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                  />
                  {fieldErrors.lastName && (
                    <p className="text-xs text-red-600">{fieldErrors.lastName}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="organizationName" className="text-sm font-medium text-gray-700">
                  {translate('onboarding.form.organizationName', 'Nazwa firmy')}<span className="text-[#EB5C2E]">*</span>
                </Label>
                <Input
                  id="organizationName"
                  name="organizationName"
                  type="text"
                  required
                  disabled={disabled}
                  autoComplete="organization"
                  placeholder="Twoja Firma Sp. z o.o."
                  className={`h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#1B4D5C] focus:ring-[#1B4D5C] ${fieldErrors.organizationName ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                />
                {fieldErrors.organizationName && (
                  <p className="text-xs text-red-600">{fieldErrors.organizationName}</p>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                  {translate('onboarding.form.password', 'Hasło')}<span className="text-[#EB5C2E]">*</span>
                </Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  disabled={disabled}
                  autoComplete="new-password"
                  placeholder="Minimum 6 znaków"
                  className={`h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#1B4D5C] focus:ring-[#1B4D5C] ${fieldErrors.password ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                />
                {fieldErrors.password && (
                  <p className="text-xs text-red-600">{fieldErrors.password}</p>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
                  {translate('onboarding.form.confirmPassword', 'Potwierdź hasło')}<span className="text-[#EB5C2E]">*</span>
                </Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  disabled={disabled}
                  autoComplete="new-password"
                  placeholder="Powtórz hasło"
                  className={`h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#1B4D5C] focus:ring-[#1B4D5C] ${fieldErrors.confirmPassword ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                />
                {fieldErrors.confirmPassword && (
                  <p className="text-xs text-red-600">{fieldErrors.confirmPassword}</p>
                )}
              </div>

              <label className="flex items-start gap-3 text-sm text-gray-600">
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
                  className="mt-0.5 border-gray-400 data-[state=checked]:bg-[#1B4D5C] data-[state=checked]:border-[#1B4D5C]"
                />
                <span>
                  {translate('onboarding.form.termsLabel', 'Przeczytałem i akceptuję')}{' '}
                  <a className="font-medium text-[#1B4D5C] underline hover:text-[#EB5C2E]" href="/inf/polityka-prywatnosci" target="_blank" rel="noreferrer">
                    {translate('onboarding.form.termsLink', 'regulamin i politykę prywatności')}
                  </a>
                  {fieldErrors.termsAccepted && (
                    <span className="mt-1 block text-xs text-red-600">{fieldErrors.termsAccepted}</span>
                  )}
                </span>
              </label>

              <button
                type="submit"
                disabled={disabled}
                className="mt-2 h-12 rounded-lg bg-[#EB5C2E] text-base font-semibold text-white transition-colors hover:bg-[#d9523a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? translate('onboarding.form.loading', 'Wysyłanie...')
                  : translate('onboarding.form.submit', 'Utwórz konto')}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-600">
              {translate('onboarding.alreadyHaveAccount', 'Masz już konto?')}{' '}
              <Link href="/inf/login" className="font-medium text-[#1B4D5C] hover:text-[#EB5C2E]">
                {translate('onboarding.signInLink', 'Zaloguj się')}
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* Trust indicators */}
      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900">{translate('onboarding.trustIndicators.security.title', 'Bezpieczeństwo danych')}</h3>
              <p className="mt-2 text-sm text-gray-600">{translate('onboarding.trustIndicators.security.description', 'Twoje dane są chronione zgodnie z RODO')}</p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900">{translate('onboarding.trustIndicators.fast.title', 'Szybka rejestracja')}</h3>
              <p className="mt-2 text-sm text-gray-600">{translate('onboarding.trustIndicators.fast.description', 'Założenie konta zajmuje tylko 2 minuty')}</p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900">{translate('onboarding.trustIndicators.support.title', 'Wsparcie 24/7')}</h3>
              <p className="mt-2 text-sm text-gray-600">{translate('onboarding.trustIndicators.support.description', 'Nasz zespół jest dostępny dla Ciebie')}</p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
