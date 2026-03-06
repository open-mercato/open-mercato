'use client'

import * as React from 'react'
import { z } from 'zod'
import { Check, Loader2, Save, X } from 'lucide-react'
import { CrudForm, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms/FormHeader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getPasswordPolicy, getPasswordRequirements, buildPasswordSchema, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'

type PasswordChangeValues = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

type ChangePasswordResponse = {
  ok: boolean
}

function PasswordInputField({
  value,
  setValue,
  disabled,
  autoFocus,
}: CrudCustomFieldRenderProps) {
  return (
    <Input
      className="max-w-xl"
      type="password"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => setValue(event.target.value)}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  )
}

type TrackedPasswordInputProps = CrudCustomFieldRenderProps & {
  onValueChange: (value: string) => void
}

function TrackedPasswordInput({
  value,
  setValue,
  disabled,
  autoFocus,
  onValueChange,
}: TrackedPasswordInputProps) {
  return (
    <Input
      className="max-w-xl"
      type="password"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => {
        const nextValue = event.target.value
        onValueChange(nextValue)
        setValue(nextValue)
      }}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  )
}

export default function PasswordChangeForm() {
  const t = useT()
  const [formKey, setFormKey] = React.useState(0)
  const [newPasswordValue, setNewPasswordValue] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const formId = 'security-password-change-form'

  const passwordPolicy = React.useMemo(() => getPasswordPolicy(), [])
  const passwordRequirements = React.useMemo(() => getPasswordRequirements(passwordPolicy), [passwordPolicy])

  const schema = React.useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(1, t('security.profile.password.form.errors.currentRequired', 'Current password is required.')),
          newPassword: buildPasswordSchema({
            policy: passwordPolicy,
            message: t('security.profile.password.form.errors.passwordPolicy', 'Password does not meet the requirements.'),
          }),
          confirmPassword: z.string().min(1, t('security.profile.password.form.errors.confirmRequired', 'Please confirm the new password.')),
        })
        .superRefine((values, ctx) => {
          if (values.newPassword !== values.confirmPassword) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('security.profile.password.form.errors.passwordMismatch', 'Passwords do not match.'),
              path: ['confirmPassword'],
            })
          }
        }),
    [passwordPolicy, t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'currentPassword',
        label: t('security.profile.password.form.currentPassword', 'Current password'),
        type: 'custom',
        required: true,
        component: PasswordInputField,
      },
      {
        id: 'newPassword',
        label: t('security.profile.password.form.newPassword', 'New password'),
        type: 'custom',
        required: true,
        component: (props) => <TrackedPasswordInput {...props} onValueChange={setNewPasswordValue} />,
      },
      {
        id: 'confirmPassword',
        label: t('security.profile.password.form.confirmPassword', 'Confirm new password'),
        type: 'custom',
        required: true,
        component: PasswordInputField,
      },
    ],
    [t],
  )

  const passwordValidation = React.useMemo(
    () => validatePassword(newPasswordValue, passwordPolicy),
    [newPasswordValue, passwordPolicy],
  )

  const hasNewPasswordInput = newPasswordValue.trim().length > 0

  const handleSubmit = React.useCallback(
    async (values: PasswordChangeValues) => {
      setIsSubmitting(true)

      try {
        if (!values.currentPassword.trim() || !values.newPassword.trim()) {
          throw createCrudFormError(
            t('security.profile.password.form.errors.required', 'Both current and new password are required.'),
          )
        }

        await readApiResultOrThrow<ChangePasswordResponse>(
          '/api/security/profile/password',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            }),
          },
          { errorMessage: t('security.profile.password.form.errors.save', 'Failed to update password.') },
        )

        setFormKey((previous) => previous + 1)
        setNewPasswordValue('')
        flash(t('security.profile.password.form.success', 'Password updated.'), 'success')
      } finally {
        setIsSubmitting(false)
      }
    },
    [t],
  )

  const handleCancel = React.useCallback(() => {
    setFormKey((previous) => previous + 1)
    setNewPasswordValue('')
  }, [])

  return (
    <div className="space-y-4">
      <FormHeader
        mode="edit"
        title={t('security.profile.password.form.title', 'Change password')}
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              form={formId}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              {isSubmitting
                ? t('ui.forms.status.saving', 'Saving...')
                : t('ui.forms.actions.save', 'Save')}
            </Button>
          </div>
        )}
      />
      <CrudForm<PasswordChangeValues>
        key={formKey}
        formId={formId}
        schema={schema}
        fields={fields}
        initialValues={{
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        }}
        hideFooterActions
        onSubmit={handleSubmit}
        embedded
      />
      <section className="max-w-xl rounded-md border bg-muted/30 p-4">
        <h3 className="text-sm font-medium">
          {t('security.profile.password.form.requirementsTitle', 'Password requirements')}
        </h3>
        <ul className="mt-2 space-y-2 text-sm">
          {passwordRequirements.map((requirement) => {
            const fulfilled = !passwordValidation.violations.includes(requirement.id)
            const requirementLabel =
              requirement.id === 'minLength'
                ? t(
                    'auth.password.requirements.minLength',
                    'At least {min} characters',
                    { min: requirement.value ?? passwordPolicy.minLength },
                  )
                : requirement.id === 'digit'
                  ? t('auth.password.requirements.digit', 'One number')
                  : requirement.id === 'uppercase'
                    ? t('auth.password.requirements.uppercase', 'One uppercase letter')
                    : t('auth.password.requirements.special', 'One special character')

            return (
              <li
                key={requirement.id}
                className={`flex items-center gap-2 ${
                  hasNewPasswordInput
                    ? fulfilled
                      ? 'text-green-700'
                      : 'text-red-700'
                    : 'text-muted-foreground'
                }`}
              >
                {hasNewPasswordInput ? (
                  fulfilled ? <Check className="size-4" /> : <X className="size-4" />
                ) : (
                  <span className="inline-block size-4 rounded-full border border-muted-foreground/50" />
                )}
                <span>{requirementLabel}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
