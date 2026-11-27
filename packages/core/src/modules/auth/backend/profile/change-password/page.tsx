'use client'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { FormSaveBar, FORM_SAVE_BAR_FLOATING_SPACER_CLASS, type FormSaveState } from '@open-mercato/ui/blocks/form-save-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildPasswordSchema, formatPasswordRequirements, getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('auth').child({ component: 'change-password-page' })

type ProfileResponse = {
  email?: string | null
  name?: string | null
}

type ProfileUpdateResponse = {
  ok?: boolean
  email?: string | null
}

type ProfileFormValues = {
  email: string
  currentPassword?: string
  password?: string
  confirmPassword?: string
}

export default function ProfileChangePasswordPage() {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [email, setEmail] = React.useState('')
  const [formKey, setFormKey] = React.useState(0)
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
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
        if (!ok) throw new Error(t('auth.profile.form.errors.load', 'Failed to load profile.'))
        const resolvedEmail = typeof result?.email === 'string' ? result.email : ''
        if (!cancelled) setEmail(resolvedEmail)
      } catch (err) {
        logger.error('Failed to load auth profile', { err })
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
      id: 'currentPassword',
      label: t('auth.profile.form.currentPassword', 'Current password'),
      type: 'password',
    },
    {
      id: 'password',
      label: t('auth.profile.form.password', 'New password'),
      type: 'password',
      description: passwordDescription,
    },
    {
      id: 'confirmPassword',
      label: t('auth.profile.form.confirmPassword', 'Confirm new password'),
      type: 'password',
    },
  ], [passwordDescription, t])

  const schema = React.useMemo(() => {
    const passwordSchema = buildPasswordSchema({
      policy: passwordPolicy,
      message: t('auth.profile.form.errors.passwordRequirements', 'Password must meet the requirements.'),
    })
    const optionalPasswordSchema = z.union([z.literal(''), passwordSchema]).optional()
    return z.object({
      email: z.string().trim().min(1, t('auth.profile.form.errors.emailRequired', 'Email is required.')),
      currentPassword: z.string().optional(),
      password: optionalPasswordSchema,
      confirmPassword: z.string().optional(),
    }).superRefine((values, ctx) => {
      const currentPassword = values.currentPassword?.trim() ?? ''
      const password = values.password?.trim() ?? ''
      const confirmPassword = values.confirmPassword?.trim() ?? ''
      const hasPasswordIntent = Boolean(currentPassword || password || confirmPassword)

      if (hasPasswordIntent && !currentPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('auth.profile.form.errors.currentPasswordRequired', 'Current password is required.'),
          path: ['currentPassword'],
        })
      }
      if (hasPasswordIntent && !password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('auth.profile.form.errors.newPasswordRequired', 'New password is required.'),
          path: ['password'],
        })
      }
      if (hasPasswordIntent && !confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('auth.profile.form.errors.confirmPasswordRequired', 'Please confirm the new password.'),
          path: ['confirmPassword'],
        })
      }
      if (password && confirmPassword && password !== confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('auth.profile.form.errors.passwordMismatch', 'Passwords do not match.'),
          path: ['confirmPassword'],
        })
      }
    })
  }, [passwordPolicy, t])

  const saveProfile = React.useCallback(async (values: ProfileFormValues) => {
    const nextEmail = values.email?.trim() ?? ''
    const currentPassword = values.currentPassword?.trim() ?? ''
    const password = values.password?.trim() ?? ''

    if (!password && nextEmail === email) {
      throw createCrudFormError(t('auth.profile.form.errors.noChanges', 'No changes to save.'))
    }

    const payload: { email: string; currentPassword?: string; password?: string } = { email: nextEmail }
    if (password) payload.password = password
    if (password) payload.currentPassword = currentPassword

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

  const handleSubmit = React.useCallback(async (values: ProfileFormValues) => {
    setSaving(true)
    setSaveFailed(false)
    try {
      await saveProfile(values)
      setDirty(false)
    } catch (err) {
      setSaveFailed(true)
      throw err
    } finally {
      setSaving(false)
    }
  }, [saveProfile])

  const handleDirtyChange = React.useCallback((nextDirty: boolean) => {
    setDirty(nextDirty)
    if (!nextDirty) setSaveFailed(false)
  }, [])

  const handleReset = React.useCallback(() => {
    setFormKey((prev) => prev + 1)
    setDirty(false)
    setSaveFailed(false)
  }, [])

  const saveState: FormSaveState = saving ? 'saving' : saveFailed ? 'failed' : dirty ? 'dirty' : 'idle'

  if (loading) {
    return <LoadingMessage label={t('auth.profile.form.loading', 'Loading profile...')} />
  }

  if (error) {
    return <ErrorMessage label={error} />
  }

  return (
    <div className={FORM_SAVE_BAR_FLOATING_SPACER_CLASS}>
      <section className="space-y-6 rounded-lg border bg-background p-6 max-w-2xl">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('auth.changePassword.title', 'Change Password')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('auth.profile.subtitle', 'Change password')}
          </p>
        </header>
        <CrudForm<ProfileFormValues>
          key={formKey}
          formId={formId}
          schema={schema}
          fields={fields}
          initialValues={{
            email,
            currentPassword: '',
            password: '',
            confirmPassword: '',
          }}
          submitLabel={t('auth.profile.form.save', 'Save changes')}
          onSubmit={handleSubmit}
          embedded
          hideFooterActions
          trackDirtyWhenEmbedded
          onDirtyChange={handleDirtyChange}
        />
      </section>
      <FormSaveBar
        saveState={saveState}
        formId={formId}
        saveLabel={t('auth.profile.form.save', 'Save changes')}
        onReset={handleReset}
        placement="floating"
      />
    </div>
  )
}
