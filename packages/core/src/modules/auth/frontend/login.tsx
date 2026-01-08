"use client"
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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

export default function LoginPage() {
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
        // NextResponse.redirect from API
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
      // In case API returns 200 with JSON
      const data = await res.json().catch(() => null)
      clearAllOperations()
      if (data && data.redirect) {
        router.replace(data.redirect)
      }
    } catch (err: unknown) {
      // Handle any errors thrown (e.g., network errors or thrown exceptions)
      const message = err instanceof Error ? err.message : ''
      setError(message || translate('auth.login.errors.generic', 'An error occurred. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center gap-4 text-center p-10">
          <Image alt={translate('auth.login.logoAlt', 'Open Mercato logo')} src="/open-mercato.svg" width={150} height={150} priority />
          <h1 className="text-2xl font-semibold">{translate('auth.login.brandName', 'Open Mercato')}</h1>
          <CardDescription>{translate('auth.login.subtitle', 'Access your workspace')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={onSubmit} noValidate>
            {!!translatedRoles.length && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-center text-xs text-blue-900">
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
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-center text-xs text-blue-900">
                {translate('auth.login.featureDenied', "You don't have access to this feature ({feature}). Please contact your administrator.", {
                  feature: translatedFeatures.join(', '),
                })}
              </div>
            )}
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-700" role="alert" aria-live="polite">
                {error}
              </div>
            )}
            <div className="grid gap-1">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" name="email" type="email" required aria-invalid={!!error} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input id="password" name="password" type="password" required aria-invalid={!!error} />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="remember" className="accent-foreground" />
              <span>{translate('auth.login.rememberMe', 'Remember me')}</span>
            </label>
            <button disabled={submitting} className="h-10 rounded-md bg-foreground text-background mt-2 hover:opacity-90 transition disabled:opacity-60">
              {submitting ? translate('auth.login.loading', 'Loading...') : translate('auth.signIn', 'Sign in')}
            </button>
            <div className="text-xs text-muted-foreground mt-2">
              <Link className="underline" href="/reset">
                {translate('auth.login.forgotPassword', 'Forgot password?')}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
