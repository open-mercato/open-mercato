"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ProfileResponse = {
  email?: string | null
}

type ProfileUpdateResponse = {
  ok?: boolean
  email?: string | null
}

type ProfileFormValues = {
  email: string
  password: string
  confirmPassword: string
}

export default function AuthProfilePage() {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [email, setEmail] = React.useState('')
  const [formKey, setFormKey] = React.useState(0)

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
    { id: 'password', label: t('auth.profile.form.password', 'New password'), type: 'text' },
    { id: 'confirmPassword', label: t('auth.profile.form.confirmPassword', 'Confirm new password'), type: 'text' },
  ], [t])

  const handleSubmit = React.useCallback(async (values: ProfileFormValues) => {
    const nextEmail = values.email?.trim() ?? ''
    const password = values.password?.trim() ?? ''
    const confirmPassword = values.confirmPassword?.trim() ?? ''

    if (!nextEmail) {
      const message = t('auth.profile.form.errors.emailRequired', 'Email is required.')
      throw createCrudFormError(message, { email: message })
    }

    if (password || confirmPassword) {
      if (password !== confirmPassword) {
        const message = t('auth.profile.form.errors.passwordMismatch', 'Passwords do not match.')
        throw createCrudFormError(message, { confirmPassword: message })
      }
    }

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
          <CrudForm<ProfileFormValues>
            key={formKey}
            title={t('auth.profile.title', 'Profile')}
            fields={fields}
            initialValues={{
              email,
              password: '',
              confirmPassword: '',
            }}
            submitLabel={t('auth.profile.form.save', 'Save changes')}
            onSubmit={handleSubmit}
          />
        )}
      </PageBody>
    </Page>
  )
}
