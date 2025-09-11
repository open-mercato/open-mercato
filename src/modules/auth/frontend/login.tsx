"use client"
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n/context'

export default function LoginPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const requireRole = (searchParams.get('requireRole') || searchParams.get('role') || '').trim()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const form = new FormData(e.currentTarget)
      if (requireRole) form.set('requireRole', requireRole)
      const res = await fetch('/api/auth/login', { method: 'POST', body: form })
      if (res.redirected) {
        // NextResponse.redirect from API
        router.replace(res.url)
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || 'Invalid email or password')
        return
      }
      // In case API returns 200 with JSON
      const data = await res.json().catch(() => null)
      if (data && data.redirect) {
        router.replace(data.redirect)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('auth.signIn')}</CardTitle>
          <CardDescription>Access your workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={onSubmit} noValidate>
            {requireRole && (
              <div className="text-xs text-muted-foreground">Access requires role: <span className="font-medium">{requireRole}</span></div>
            )}
            {error && (
              <div className="text-sm text-red-600" role="alert" aria-live="polite">
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
            <button disabled={submitting} className="h-10 rounded-md bg-foreground text-background mt-2 hover:opacity-90 transition disabled:opacity-60">
              {submitting ? '...' : t('auth.signIn')}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
