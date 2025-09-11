"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ResetWithTokenPage({ params }: { params: { token: string } }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const form = new FormData(e.currentTarget)
      form.set('token', params.token)
      const res = await fetch('/api/auth/reset/confirm', { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Unable to reset password')
        return
      }
      router.replace(data?.redirect || '/login')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>Choose a strong password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={onSubmit}>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="grid gap-1">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" required minLength={6} />
            </div>
            <button disabled={submitting} className="h-10 rounded-md bg-foreground text-background mt-2 hover:opacity-90 transition disabled:opacity-60">
              {submitting ? '...' : 'Update password'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

