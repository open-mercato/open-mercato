'use client'

import { Check, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type {
  PasswordPolicy,
  PasswordRequirement,
  PasswordRequirementId,
  PasswordValidationResult,
} from '@open-mercato/shared/lib/auth/passwordPolicy'

type PasswordStrengthStatusProps = {
  hasInput: boolean
  passwordPolicy: PasswordPolicy
  passwordRequirements: PasswordRequirement[]
  passwordValidation: PasswordValidationResult
  className?: string
  framed?: boolean
}

type RequirementItemProps = {
  fulfilled: boolean
  hasInput: boolean
  label: string
}

const requirementTextById: Record<Exclude<PasswordRequirementId, 'minLength'>, { key: string; fallback: string }> = {
  digit: { key: 'auth.password.requirements.digit', fallback: 'One number' },
  uppercase: { key: 'auth.password.requirements.uppercase', fallback: 'One uppercase letter' },
  special: { key: 'auth.password.requirements.special', fallback: 'One special character' },
}

function RequirementItem({ fulfilled, hasInput, label }: RequirementItemProps) {
  return (
    <li
      className={cn(
        'flex items-center gap-2',
        hasInput
          ? fulfilled
            ? 'text-green-700'
            : 'text-red-700'
          : 'text-muted-foreground',
      )}
    >
      {hasInput ? (
        fulfilled ? <Check className="size-4" /> : <X className="size-4" />
      ) : (
        <span className="inline-block size-4 rounded-full border border-muted-foreground/50" />
      )}
      <span>{label}</span>
    </li>
  )
}

function resolveRequirementLabel(
  requirement: PasswordRequirement,
  policy: PasswordPolicy,
  t: ReturnType<typeof useT>,
): string {
  if (requirement.id === 'minLength') {
    return t(
      'auth.password.requirements.minLength',
      'At least {min} characters',
      { min: requirement.value ?? policy.minLength },
    )
  }

  const requirementText = requirementTextById[requirement.id]
  return t(requirementText.key, requirementText.fallback)
}

export function PasswordStrengthStatus({
  hasInput,
  passwordPolicy,
  passwordRequirements,
  passwordValidation,
  className,
  framed = true,
}: PasswordStrengthStatusProps) {
  const t = useT()

  return (
    <section
      className={cn(
        framed ? 'max-w-xl rounded-md border bg-muted/30 p-4' : 'max-w-xl pt-1',
        className,
      )}
    >
      <header>
        <h3 className="text-sm font-medium">
          {t('security.profile.password.form.requirementsTitle', 'Password requirements')}
        </h3>
      </header>
      <ul className="mt-2 space-y-2 text-sm">
        {passwordRequirements.map((requirement) => {
          const fulfilled = !passwordValidation.violations.includes(requirement.id)
          const label = resolveRequirementLabel(requirement, passwordPolicy, t)

          return (
            <RequirementItem
              key={requirement.id}
              fulfilled={fulfilled}
              hasInput={hasInput}
              label={label}
            />
          )
        })}
      </ul>
    </section>
  )
}
