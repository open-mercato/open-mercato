"use client"
import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n/context'

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
    <div className="min-h-svh w-full bg-gradient-to-br from-blue-50 via-white to-blue-100/50">
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-sm border-0 bg-white/80 shadow-xl backdrop-blur-sm">
          <CardHeader>
            <CardTitle>{t('auth.resetPassword')}</CardTitle>
            <CardDescription>Enter your email to receive reset link</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="text-sm text-muted-foreground">
                If an account with that email exists, we sent a reset link. Please check your inbox.
                <div className="mt-4">
                  <Link href="/login" className="text-foreground hover:underline font-medium">
                    Back to sign in
                  </Link>
                </div>
              </div>
            ) : (
              <form className="grid gap-3" onSubmit={onSubmit} noValidate>
                {error && <div className="text-sm text-red-600">{error}</div>}
                <div className="grid gap-1">
                  <Label htmlFor="email">{t('auth.email')}</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
                <button disabled={submitting} className="h-10 rounded-full bg-gray-900 text-white mt-2 font-medium hover:bg-gray-800 transition disabled:opacity-60">
                  {submitting ? '...' : t('auth.sendResetLink')}
                </button>
                <div className="text-xs text-muted-foreground mt-2 text-center">
                  <Link className="hover:underline" href="/login">
                    Back to sign in
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
