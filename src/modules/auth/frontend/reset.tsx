"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n/context'

export default function ResetPage() {
  const t = useT()
  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('auth.resetPassword')}</CardTitle>
          <CardDescription>Enter your email to receive reset link</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" action="/api/auth/reset" method="POST">
            <div className="grid gap-1">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <button className="h-10 rounded-md bg-foreground text-background mt-2 hover:opacity-90 transition">{t('auth.sendResetLink')}</button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
