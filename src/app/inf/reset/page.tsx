"use client"
import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n/context'

export default function INFResetPage() {
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
            <CardDescription className="text-gray-400">{t('auth.resetPassword')}</CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            {sent ? (
              <div className="text-sm text-gray-400 text-center">
                If an account with that email exists, we sent a reset link. Please check your inbox.
              </div>
            ) : (
              <form className="grid gap-3" onSubmit={onSubmit} noValidate>
                {error && <div className="text-sm text-red-400 text-center">{error}</div>}
                <div className="grid gap-1">
                  <Label htmlFor="email" className="text-gray-300">{t('auth.email')}<span className="text-[#E67E5E]">*</span></Label>
                  <Input id="email" name="email" type="email" required className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]" />
                </div>
                <button
                  disabled={submitting}
                  className="h-10 rounded-full bg-[#E67E5E] text-white mt-2 font-medium hover:bg-[#d9705a] transition disabled:opacity-60"
                >
                  {submitting ? '...' : t('auth.sendResetLink')}
                </button>
                <div className="text-xs text-gray-500 mt-2 text-center">
                  <Link className="hover:text-gray-300 hover:underline" href="/login">
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
