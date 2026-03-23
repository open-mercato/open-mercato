'use client'

import * as React from 'react'
import { z } from 'zod'
import { CrudForm, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Input } from '@open-mercato/ui/primitives/input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getPasswordPolicy, getPasswordRequirements, buildPasswordSchema, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { PasswordStrengthStatus } from './PasswordStrengthStatus'

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

  const passwordValidation = React.useMemo(
    () => validatePassword(newPasswordValue, passwordPolicy),
    [newPasswordValue, passwordPolicy],
  )

  const hasNewPasswordInput = newPasswordValue.trim().length > 0
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
      {
        id: 'passwordRequirements',
        label: '',
        type: 'custom',
        component: () => (
          <PasswordStrengthStatus
            hasInput={hasNewPasswordInput}
            passwordPolicy={passwordPolicy}
            passwordRequirements={passwordRequirements}
            passwordValidation={passwordValidation}
            framed={false}
          />
        ),
      },
    ],
    [hasNewPasswordInput, passwordPolicy, passwordRequirements, passwordValidation, t],
  )

  const handleSubmit = React.useCallback(
    async (values: PasswordChangeValues) => {
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
    },
    [t],
  )

  return (
    <CrudForm<PasswordChangeValues>
      title={t('security.profile.password.form.title', 'Change password')}
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
      embedded={false}
    />
  )
}
