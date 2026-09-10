"use client"
import { useCallback, useEffect, useMemo, useState } from 'react'
import { extensionPoints } from '@open-mercato/core/modules/auth/extension-points'
import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardDescription } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { clearAllOperations } from '@open-mercato/ui/backend/operations/store'
import { notifyAuthIdentityChange } from '@open-mercato/ui/backend/AuthSessionGuard'
import { clearAllPerspectiveState } from '@open-mercato/ui/backend/perspectiveState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { X } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import type { AuthOverride, LoginFormWidgetContext } from './login-injection'

/**
 * The tenant hint that survives an in-app bounce back to a bare `/login`.
 *
 * Per TAB (sessionStorage), not per browser: the value it replaces lived in localStorage
 * and a 14-day cookie and was replayed on every later visit. And per ADDRESS: the hint is
 * only meaningful for the person it was issued to, so a second user signing in on the same
 * tab is not silently narrowed to somebody else's tenant and handed the uniform 401.
 */
type TenantHint = { email: string; tenantId: string }

const TENANT_HINT_STORAGE_KEY = 'om_login_tenant_hint'
/** Set server-side by @open-mercato/onboarding, `path=/`, 14 days, not httpOnly. */
const ONBOARDING_TENANT_COOKIE = 'om_login_tenant'

function readTenantHint(): TenantHint | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(TENANT_HINT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TenantHint> | null
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.tenantId !== 'string') return null
    if (!parsed.email || !parsed.tenantId) return null
    return { email: parsed.email, tenantId: parsed.tenantId }
  } catch {
    return null
  }
}

function writeTenantHint(hint: TenantHint): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(TENANT_HINT_STORAGE_KEY, JSON.stringify(hint))
  } catch {
    /* private mode, or storage disabled - the hint is an optimisation, not a requirement */
  }
}

function clearTenantHint(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(TENANT_HINT_STORAGE_KEY)
  } catch {
    /* nothing to do */
  }
}

function clearOnboardingTenantCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${ONBOARDING_TENANT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

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

type LoginResponseEventDetail = Record<string, unknown> | null

type LoginFormSectionProps = {
  children: ReactNode
}

function LoginFormSectionDefault({ children }: LoginFormSectionProps) {
  return <>{children}</>
}

function emitLoginResponseEvent(detail: LoginResponseEventDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('om:auth:login-response', { detail }))
}

export default function LoginPage() {
  const t = useT()
  const translate = useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) =>
      translateWithFallback(t, key, fallback, params),
    [t],
  )
  const router = useRouter()
  const searchParams = useSearchParams()
  const requireRole = (searchParams.get('requireRole') || searchParams.get('role') || '').trim()
  const requireFeature = (searchParams.get('requireFeature') || '').trim()
  const redirectParam = searchParams.get('redirect') || ''
  const requiredRoles = requireRole ? requireRole.split(',').map((value) => value.trim()).filter(Boolean) : []
  const requiredFeatures = requireFeature ? requireFeature.split(',').map((value) => value.trim()).filter(Boolean) : []
  const translatedRoles = requiredRoles.map((role) => translate(`auth.roles.${role}`, role))
  const translatedFeatures = requiredFeatures.map((feature) => translate(`features.${feature}`, feature))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [authOverride, setAuthOverride] = useState<AuthOverride | null>(null)
  const [authOverridePending, setAuthOverridePending] = useState(false)
  const [clientReady, setClientReady] = useState(false)
  const [activeAuthenticatedUser, setActiveAuthenticatedUser] = useState(false)
  const [email, setEmail] = useState('')
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [tenantHint, setTenantHint] = useState<TenantHint | null>(null)
  const [tenantName, setTenantName] = useState<string | null>(null)
  const [tenantLoading, setTenantLoading] = useState(false)
  const [tenantInvalid, setTenantInvalid] = useState<string | null>(null)
  const showTenantInvalid = tenantId != null && tenantInvalid === tenantId
  const LoginFormSection = useRegisteredComponent<LoginFormSectionProps>(
    'section:auth.login.form',
    LoginFormSectionDefault,
  )

  useEffect(() => {
    setClientReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const hasAclChallenge = requiredFeatures.length > 0 || requiredRoles.length > 0
    void (async () => {
      try {
        const res = await apiCall<{ userId?: string }>('/api/auth/feature-check', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Probing for an already-active session: a 401 is the expected answer
            // for an anonymous visitor, never a session that just expired.
            'x-om-unauthorized-redirect': '0',
            'x-om-forbidden-redirect': '0',
          },
          body: JSON.stringify({ features: [] }),
          cache: 'no-store',
        })
        if (cancelled) return
        const activeUserId = typeof res.result?.userId === 'string' ? res.result.userId : ''
        if (!activeUserId) return
        setActiveAuthenticatedUser(true)
        // When a feature/role challenge is present in the URL, the user already
        // failed an ACL check while authenticated. Auto-redirecting back to
        // `redirect` would re-trigger the same 403 and re-bounce here,
        // producing an infinite loop (see GH #2070). Stay on the login page so
        // the access-denied banner is visible.
        if (hasAclChallenge) return
        const rawRedirect = redirectParam
        let destination = '/backend'
        if (rawRedirect) {
          try {
            const resolved = new URL(rawRedirect, window.location.origin)
            if (
              resolved.origin === window.location.origin &&
              resolved.pathname.startsWith('/') &&
              !resolved.pathname.includes('//')
            ) {
              destination = resolved.pathname + resolved.search + resolved.hash
            }
          } catch {
            // fall back to /backend
          }
        }
        router.replace(destination)
      } catch {
        // ignore — leave login form usable on network failure
      }
    })()
    return () => { cancelled = true }
  }, [router, redirectParam, requiredFeatures.length, requiredRoles.length])

  // The `tenant` query parameter is a hint scoped to the CURRENT visit: it is the URL,
  // and nothing else, that decides whether the tenant BANNER shows. It used to be
  // mirrored into localStorage['om_login_tenant'] and a 14-day cookie of the same name
  // and replayed on every later visit, which welded the banner to /login for anyone who
  // had ever followed a link carrying it — with no TTL of its own and no clear after a
  // successful sign-in. @open-mercato/onboarding puts the parameter on the login link in
  // the workspace-ready e-mail, in the post-verification redirect and in the onboarding
  // status endpoint, so every self-serve signup passed through it exactly once and then
  // carried the banner permanently.
  useEffect(() => {
    const tenantParam = (searchParams.get('tenant') || '').trim()
    setTenantId(tenantParam || null)
  }, [searchParams])

  // The SUBMITTED value is a separate question from the banner, and the two were
  // conflated. `POST /api/auth/login` cannot disambiguate an address that exists in more
  // than one tenant without it — `findUsersByEmail` deliberately treats an ambiguous
  // match as no user and falls through to the uniform 401 (issue #2242) — and the app
  // routinely lands such a user on a BARE /login: session refresh, logout, and the 401
  // handler in @open-mercato/ui all redirect there with no parameter. With no fallback
  // at all, the form has no tenant selector either, so there is no in-app way back in.
  //
  // So the hint survives, but only for this tab and only for the address it was issued
  // to. sessionStorage dies with the tab, which removes the 14-day weld and the
  // cross-session surprise; keying it to the e-mail removes the other half of the old
  // behaviour's cost — a stale hint narrowing the lookup for a DIFFERENT person signing
  // in on the same tab, who would get a 401 with nothing on screen to explain it.
  useEffect(() => {
    setTenantHint(readTenantHint())
  }, [])

  const submittedTenantId = tenantId
    ?? (tenantHint && tenantHint.email === email.trim().toLowerCase() ? tenantHint.tenantId : null)

  useEffect(() => {
    if (!tenantId) {
      setTenantName(null)
      setTenantInvalid(null)
      return
    }
    if (tenantInvalid === tenantId) {
      setTenantName(null)
      setTenantLoading(false)
      return
    }
    let active = true
    setTenantLoading(true)
    setTenantInvalid(null)
    apiCall<{ ok: boolean; tenant?: { id: string; name: string }; error?: string }>(
      `/api/directory/tenants/lookup?tenantId=${encodeURIComponent(tenantId)}`,
    )
      .then(({ result }) => {
        if (!active) return
        if (result?.ok && result.tenant) {
          setTenantName(result.tenant.name)
          return
        }
        setTenantName(null)
        setTenantInvalid(tenantId)
        setError(null)
      })
      .catch(() => {
        if (!active) return
        setTenantName(null)
        setTenantInvalid(tenantId)
        setError(null)
      })
      .finally(() => {
        if (active) setTenantLoading(false)
      })
    return () => {
      active = false
    }
  }, [tenantId, translate])

  function handleClearTenant() {
    // "Clear" means every tenant hint this browser holds, not just the banner: the URL
    // parameter, the state mirroring it, the per-tab hint, and the `om_login_tenant`
    // cookie @open-mercato/onboarding sets server-side. That cookie is read back as the
    // sole authorization input to the onboarding status endpoint and lives 14 days; this
    // button was the only in-app way to drop it, so it keeps dropping it.
    setTenantId(null)
    setTenantName(null)
    setTenantInvalid(null)
    clearTenantHint()
    setTenantHint(null)
    clearOnboardingTenantCookie()
    const params = new URLSearchParams(searchParams)
    params.delete('tenant')
    setError(null)
    const query = params.toString()
    router.replace(query ? `/login?${query}` : '/login')
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!clientReady || authOverridePending) {
      return
    }
    setError(null)
    if (authOverride) {
      authOverride.onSubmit()
      return
    }
    setSubmitting(true)
    try {
      const form = new FormData(e.currentTarget)
      // Written here rather than when the parameter arrives: this is the first moment
      // both halves are known, since /login takes no `email` parameter. Written before
      // the request, so a mistyped password does not cost the hint.
      if (tenantId) writeTenantHint({ email: email.trim().toLowerCase(), tenantId })
      if (requiredRoles.length) form.set('requireRole', requiredRoles.join(','))
      const redirectParam = searchParams.get('redirect')
      if (redirectParam) form.set('redirect', redirectParam)
      const res = await fetch('/api/auth/login', { method: 'POST', body: form })
      if (res.redirected) {
        clearAllOperations()
        clearAllPerspectiveState()
        notifyAuthIdentityChange()
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
      const data = await res.json().catch(() => null) as LoginResponseEventDetail
      emitLoginResponseEvent(data)
      clearAllOperations()
      clearAllPerspectiveState()
      notifyAuthIdentityChange()
      if (data && typeof data.redirect === 'string' && data.redirect.length > 0) {
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

  const loginFormContext = useMemo<LoginFormWidgetContext>(() => ({
    email,
    tenantId,
    searchParams,
    setAuthOverride,
    setAuthOverridePending,
    setError,
  }), [email, tenantId, searchParams])

  const formReady = clientReady && !authOverridePending

  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center gap-4 text-center p-10">
          <Image alt={translate('auth.login.logoAlt', 'Open Mercato logo')} src="/open-mercato.svg" width={150} height={150} priority />
          <h1 className="text-2xl font-semibold">{translate('auth.login.brandName', 'Open Mercato')}</h1>
          <CardDescription>{translate('auth.login.subtitle', 'Access your workspace')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginFormSection>
            <form className="grid gap-3" onSubmit={onSubmit} noValidate data-auth-ready={formReady ? '1' : '0'}>
              {submittedTenantId ? (
                <input type="hidden" name="tenantId" value={submittedTenantId} />
              ) : null}
              {!!translatedRoles.length && (
                <Alert status="information" className="text-center">
                  <AlertDescription>
                    {translate(
                      translatedRoles.length > 1 ? 'auth.login.requireRolesMessage' : 'auth.login.requireRoleMessage',
                      translatedRoles.length > 1
                        ? 'Access requires one of the following roles: {roles}'
                        : 'Access requires role: {roles}',
                      { roles: translatedRoles.join(', ') },
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {!!translatedFeatures.length && (
                <Alert status="information" className="text-center">
                  <AlertDescription>
                    {translate('auth.login.featureDenied', "You don't have access to this feature ({feature}). Please contact your administrator.", {
                      feature: translatedFeatures.join(', '),
                    })}
                  </AlertDescription>
                </Alert>
              )}
              {activeAuthenticatedUser && (translatedRoles.length || translatedFeatures.length) ? (
                <div className="flex justify-center" data-testid="login-return-dashboard">
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link href="/backend">
                      {translate('auth.accessDenied.dashboard', 'Go to Dashboard')}
                    </Link>
                  </Button>
                </div>
              ) : null}
              {showTenantInvalid ? (
                <div className="rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-center text-xs text-status-error-text">
                  <div className="font-medium">{translate('auth.login.errors.tenantInvalid', 'Tenant not found. Clear the tenant selection and try again.')}</div>
                  <Button type="button" variant="outline" size="sm" className="mt-2 border-status-error-border text-status-error-text hover:text-status-error-text" onClick={handleClearTenant}>
                    <X className="mr-2 size-4" aria-hidden="true" />
                    {translate('auth.login.tenantClear', 'Clear')}
                  </Button>
                </div>
              ) : tenantId ? (
                <div className="rounded-md border border-status-success-border bg-status-success-bg px-3 py-2 text-center text-xs text-status-success-text">
                  <div className="font-medium">
                    {tenantLoading
                      ? translate('auth.login.tenantLoading', 'Loading tenant details...')
                      : translate('auth.login.tenantBanner', "You're logging in to {tenant}.", {
                          tenant: tenantName || tenantId,
                        })}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="mt-2 border-status-success-border text-status-success-text hover:text-status-success-text" onClick={handleClearTenant}>
                    <X className="mr-2 size-4" aria-hidden="true" />
                    {translate('auth.login.tenantClear', 'Clear')}
                  </Button>
                </div>
              ) : null}
              {error && !showTenantInvalid && (
                <div className="rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-center text-sm text-status-error-text" role="alert" aria-live="polite">
                  {error}
                </div>
              )}
              <div className="grid gap-1">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <EmailInput
                  id="email"
                  name="email"
                  required
                  aria-invalid={!!error}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={(e) => setEmail(e.target.value)}
                />
              </div>
              <InjectionSpot<LoginFormWidgetContext>
                spotId={extensionPoints.hosts.loginForm.spotId}
                context={loginFormContext}
              />
              {authOverride?.hidePassword ? null : (
                <div className="grid gap-1">
                  <Label htmlFor="password">{t('auth.password')}</Label>
                  <PasswordInput id="password" name="password" required={!authOverride} aria-invalid={!!error} autoComplete="current-password" />
                </div>
              )}
              {!authOverride?.hideRememberMe && !authOverride?.hidePassword && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" name="remember" className="accent-foreground" />
                  <span>{translate('auth.login.rememberMe', 'Remember me')}</span>
                </label>
              )}
              <Button type="submit" disabled={submitting || !formReady} className="h-10 mt-2">
                {submitting
                  ? translate('auth.login.loading', 'Loading...')
                  : authOverride
                    ? authOverride.providerLabel
                    : translate('auth.signIn', 'Sign in')}
              </Button>
              {!authOverride?.hideForgotPassword && (
                <div className="text-xs text-muted-foreground mt-2">
                  <Link className="underline" href="/reset">
                    {translate('auth.login.forgotPassword', 'Forgot password?')}
                  </Link>
                </div>
              )}
            </form>
          </LoginFormSection>
        </CardContent>
      </Card>
    </div>
  )
}
