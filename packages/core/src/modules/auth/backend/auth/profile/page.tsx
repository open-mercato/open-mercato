"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Save } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildPasswordSchema, formatPasswordRequirements, getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'

type ProfileResponse = {
  email?: string | null
}

type ProfileUpdateResponse = {
  ok?: boolean
  email?: string | null
}

type ProfileFormValues = {
  email: string
  password?: string
  confirmPassword?: string
}

export default function AuthProfilePage() {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [email, setEmail] = React.useState('')
  const [formKey, setFormKey] = React.useState(0)
  const formId = React.useId()
  const passwordPolicy = React.useMemo(() => getPasswordPolicy(), [])
  const passwordRequirements = React.useMemo(
    () => formatPasswordRequirements(passwordPolicy, t),
    [passwordPolicy, t],
  )
  const passwordDescription = React.useMemo(() => (
    passwordRequirements
      ? t('auth.password.requirements.help', 'Password requirements: {requirements}', { requirements: passwordRequirements })
      : undefined
  ), [passwordRequirements, t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { ok, result } = await apiCall<ProfileResponse>('/api/auth/profile')
        if (!ok) throw new Error('load_failed')
        const resolvedEmail = typeof result?.email === 'string' ? result.email : ''
        if (!cancelled) setEmail(resolvedEmail)
      } catch (err) {
        console.error('Failed to load auth profile', err)
        if (!cancelled) setError(t('auth.profile.form.errors.load', 'Failed to load profile.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [t])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'email', label: t('auth.profile.form.email', 'Email'), type: 'text', required: true },
    {
      id: 'password',
      label: t('auth.profile.form.password', 'New password'),
      type: 'text',
      description: passwordDescription,
    },
    { id: 'confirmPassword', label: t('auth.profile.form.confirmPassword', 'Confirm new password'), type: 'text' },
  ], [passwordDescription, t])

  const schema = React.useMemo(() => {
    const passwordSchema = buildPasswordSchema({
      policy: passwordPolicy,
      message: t('auth.profile.form.errors.passwordRequirements', 'Password must meet the requirements.'),
    })
    const optionalPasswordSchema = z.union([z.literal(''), passwordSchema]).optional()
    return z.object({
      email: z.string().trim().min(1, t('auth.profile.form.errors.emailRequired', 'Email is required.')),
      password: optionalPasswordSchema,
      confirmPassword: z.string().optional(),
    }).superRefine((values, ctx) => {
      const password = values.password?.trim() ?? ''
      const confirmPassword = values.confirmPassword?.trim() ?? ''
      if ((password || confirmPassword) && password !== confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('auth.profile.form.errors.passwordMismatch', 'Passwords do not match.'),
          path: ['confirmPassword'],
        })
      }
    })
  }, [passwordPolicy, t])

  const handleSubmit = React.useCallback(async (values: ProfileFormValues) => {
    const nextEmail = values.email?.trim() ?? ''
    const password = values.password?.trim() ?? ''

    if (!password && nextEmail === email) {
      throw createCrudFormError(t('auth.profile.form.errors.noChanges', 'No changes to save.'))
    }

    const payload: { email: string; password?: string } = { email: nextEmail }
    if (password) payload.password = password

    const result = await readApiResultOrThrow<ProfileUpdateResponse>(
      '/api/auth/profile',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      { errorMessage: t('auth.profile.form.errors.save', 'Failed to update profile.') },
    )

    const resolvedEmail = typeof result?.email === 'string' ? result.email : nextEmail
    setEmail(resolvedEmail)
    setFormKey((prev) => prev + 1)
    flash(t('auth.profile.form.success', 'Profile updated.'), 'success')
    router.refresh()
  }, [email, router, t])

  return (
    <Page>
      <PageBody>
        {loading ? (
          <LoadingMessage label={t('auth.profile.form.loading', 'Loading profile...')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : (
          <section className="space-y-6 rounded-lg border bg-background p-6">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">{t('auth.profile.title', 'Profile')}</h2>
                <p className="text-sm text-muted-foreground">
                  {t('auth.profile.subtitle', 'Change password')}
                </p>
              </div>
              <Button type="submit" form={formId}>
                <Save className="size-4 mr-2" />
                {t('auth.profile.form.save', 'Save changes')}
              </Button>
            </header>
            <CrudForm<ProfileFormValues>
              key={formKey}
              formId={formId}
              schema={schema}
              fields={fields}
              initialValues={{
                email,
                password: '',
                confirmPassword: '',
              }}
              submitLabel={t('auth.profile.form.save', 'Save changes')}
              onSubmit={handleSubmit}
              embedded
              hideFooterActions
            />
          </section>
        )}
      </PageBody>
    </Page>
  )
}
