"use client"
import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n/context'

export default function FreightTechResetPage() {
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
          <CardHeader className="flex flex-col items-center gap-4 text-center px-8 pt-8 pb-0">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/fms/freighttech-logo.png"
                alt="FreightTech"
                width={56}
                height={56}
              />
              <span className="text-2xl font-bold tracking-tight text-gray-900">FreightTech</span>
            </Link>
            <CardDescription className="text-gray-600">{t('auth.resetPassword')}</CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            {sent ? (
              <div className="text-sm text-gray-600 text-center">
                If an account with that email exists, we sent a reset link. Please check your inbox.
              </div>
            ) : (
              <form className="grid gap-3" onSubmit={onSubmit} noValidate>
                {error && <div className="text-sm text-red-600 text-center">{error}</div>}
                <div className="grid gap-1">
                  <Label htmlFor="email" className="text-gray-700">{t('auth.email')}</Label>
                  <Input id="email" name="email" type="email" required className="border-gray-300 bg-white" />
                </div>
                <button
                  disabled={submitting}
                  className="h-10 rounded-full bg-gray-900 text-white mt-2 font-medium hover:bg-gray-800 transition disabled:opacity-60"
                >
                  {submitting ? '...' : t('auth.sendResetLink')}
                </button>
                <div className="text-xs text-gray-500 mt-2 text-center">
                  <Link className="hover:text-gray-700 hover:underline" href="/login">
                    Back to login
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
