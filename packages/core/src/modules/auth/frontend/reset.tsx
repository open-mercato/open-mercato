"use client"
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ResetPage() {
  const t = useT()
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const form = new FormData(e.currentTarget)
      const res = await fetch('/api/auth/reset', { method: 'POST', body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error || 'Something went wrong')
        return
      }
      setSent(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('auth.resetPassword')}</CardTitle>
          <CardDescription>Enter your email to receive reset link</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="text-sm text-muted-foreground">
              If an account with that email exists, we sent a reset link. Please check your inbox.
            </div>
          ) : (
            <form className="grid gap-3" onSubmit={onSubmit} noValidate>
              {error && <div className="text-sm text-red-600">{error}</div>}
              <div className="grid gap-1">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <button disabled={submitting} className="h-10 rounded-md bg-foreground text-background mt-2 hover:opacity-90 transition disabled:opacity-60">
                {submitting ? '...' : t('auth.sendResetLink')}
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
