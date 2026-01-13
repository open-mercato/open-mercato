"use client"
import { Suspense, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { clearAllOperations } from '@open-mercato/ui/backend/operations/store'

function extractErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const resolved = extractErrorMessage(entry)
      if (resolved) return resolved
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const candidates: unknown[] = [
      record.error,
      record.message,
      record.detail,
      record.details,
      record.description,
    ]
    for (const candidate of candidates) {
      const resolved = extractErrorMessage(candidate)
      if (resolved) return resolved
    }
  }
  return null
}

function looksLikeJsonString(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function INFLoginContent() {
  const t = useT()
  const translate = (key: string, fallback: string, params?: Record<string, string | number>) =>
    translateWithFallback(t, key, fallback, params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const requireRole = (searchParams.get('requireRole') || searchParams.get('role') || '').trim()
  const requireFeature = (searchParams.get('requireFeature') || '').trim()
  const requiredRoles = requireRole ? requireRole.split(',').map((value) => value.trim()).filter(Boolean) : []
  const requiredFeatures = requireFeature ? requireFeature.split(',').map((value) => value.trim()).filter(Boolean) : []
  const translatedRoles = requiredRoles.map((role) => translate(`auth.roles.${role}`, role))
  const translatedFeatures = requiredFeatures.map((feature) => translate(`features.${feature}`, feature))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const form = new FormData(e.currentTarget)
      if (requiredRoles.length) form.set('requireRole', requiredRoles.join(','))
      const res = await fetch('/api/auth/login', { method: 'POST', body: form })
      if (res.redirected) {
        clearAllOperations()
        router.replace(res.url)
        return
      }
      if (!res.ok) {
        const fallback = (() => {
          if (res.status === 403) {
            return translate(
              'auth.login.errors.permissionDenied',
              'You do not have permission to access this area. Please contact your administrator.',
            )
          }
          if (res.status === 401 || res.status === 400) {
            return translate('auth.login.errors.invalidCredentials', 'Invalid email or password')
          }
          return translate('auth.login.errors.generic', 'An error occurred. Please try again.')
        })()
        const cloned = res.clone()
        let errorMessage = ''
        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          try {
            const data = await res.json()
            errorMessage = extractErrorMessage(data) || ''
          } catch {
            try {
              const text = await cloned.text()
              const trimmed = text.trim()
              if (trimmed && !looksLikeJsonString(trimmed)) {
                errorMessage = trimmed
              }
            } catch {
              errorMessage = ''
            }
          }
        } else {
          try {
            const text = await res.text()
            const trimmed = text.trim()
            if (trimmed && !looksLikeJsonString(trimmed)) {
              errorMessage = trimmed
            }
          } catch {
            errorMessage = ''
          }
        }
        setError(errorMessage || fallback)
        return
      }
      const data = await res.json().catch(() => null)
      clearAllOperations()
      if (data && data.redirect) {
        router.replace(data.redirect)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      setError(message || translate('auth.login.errors.generic', 'An error occurred. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh w-full bg-[#0f0f0f]">
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-sm border-0 bg-[#1c1c1c] shadow-2xl">
          <CardHeader className="flex flex-col items-center gap-4 text-center px-8 pt-8 pb-0">
            <Link href="/">
              <Image
                src="/fms/inf-logo.svg"
                alt="INF Shipping Solutions"
                width={140}
                height={48}
              />
            </Link>
            <CardDescription className="text-gray-400">{translate('auth.login.subtitle', 'Sign in to your account')}</CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            <form className="grid gap-3" onSubmit={onSubmit} noValidate>
              {!!translatedRoles.length && (
                <div className="rounded-md border border-[#3b82b4]/30 bg-[#3b82b4]/10 px-3 py-2 text-center text-xs text-[#7cb4e0]">
                  {translate(
                    translatedRoles.length > 1 ? 'auth.login.requireRolesMessage' : 'auth.login.requireRoleMessage',
                    translatedRoles.length > 1
                      ? 'Access requires one of the following roles: {roles}'
                      : 'Access requires role: {roles}',
                    { roles: translatedRoles.join(', ') },
                  )}
                </div>
              )}
              {!!translatedFeatures.length && (
                <div className="rounded-md border border-[#3b82b4]/30 bg-[#3b82b4]/10 px-3 py-2 text-center text-xs text-[#7cb4e0]">
                  {translate('auth.login.featureDenied', "You don't have access to this feature ({feature}). Please contact your administrator.", {
                    feature: translatedFeatures.join(', '),
                  })}
                </div>
              )}
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-400" role="alert" aria-live="polite">
                  {error}
                </div>
              )}
              <div className="grid gap-1">
                <Label htmlFor="email" className="text-gray-300">{t('auth.email')}<span className="text-[#E67E5E]">*</span></Label>
                <Input id="email" name="email" type="email" required aria-invalid={!!error} className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="password" className="text-gray-300">{t('auth.password')}<span className="text-[#E67E5E]">*</span></Label>
                <Input id="password" name="password" type="password" required aria-invalid={!!error} className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]" />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input type="checkbox" name="remember" className="accent-[#E67E5E] rounded border-gray-600 bg-[#2a2a2a]" />
                <span>{translate('auth.login.rememberMe', 'Remember me')}</span>
              </label>
              <button
                disabled={submitting}
                className="h-10 rounded-full bg-[#E67E5E] text-white mt-2 font-medium hover:bg-[#d9705a] transition disabled:opacity-60"
              >
                {submitting ? translate('auth.login.loading', 'Loading...') : translate('auth.signIn', 'Sign in')}
              </button>
              <div className="text-xs text-gray-500 mt-2 text-center">
                <Link className="hover:text-gray-300 hover:underline" href="/reset">
                  {translate('auth.login.forgotPassword', 'Forgot password?')}
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function INFLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-svh w-full bg-[#0f0f0f]" />}>
      <INFLoginContent />
    </Suspense>
  )
}
