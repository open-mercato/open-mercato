'use client'

import * as React from 'react'
import { Save } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { dispatchAccessibilityPreferencesChanged } from '@open-mercato/ui/backend/accessibility'
import { useAccessibilityPreferences } from '@open-mercato/ui/backend/AccessibilityProvider'
import type { AccessibilityPreferences } from '@open-mercato/core/modules/auth/data/validators'

type AccessibilityMutationContext = {
  entityType: string
  entityId: string
  retryLastMutation: () => Promise<boolean>
}

type FontSizeOption = NonNullable<AccessibilityPreferences['fontSize']>

const DEFAULT_PREFERENCES: Required<AccessibilityPreferences> = {
  highContrast: false,
  fontSize: 'md',
  reducedMotion: false,
}

function normalizePreferences(
  preferences?: AccessibilityPreferences | null,
): Required<AccessibilityPreferences> {
  return {
    highContrast: preferences?.highContrast ?? DEFAULT_PREFERENCES.highContrast,
    fontSize: preferences?.fontSize ?? DEFAULT_PREFERENCES.fontSize,
    reducedMotion: preferences?.reducedMotion ?? DEFAULT_PREFERENCES.reducedMotion,
  }
}

function fontSizeLabel(
  t: (key: string, fallback?: string) => string,
  size: FontSizeOption,
): string {
  switch (size) {
    case 'sm':
      return t('auth.accessibility.font_size_sm', 'S')
    case 'md':
      return t('auth.accessibility.font_size_md', 'M')
    case 'lg':
      return t('auth.accessibility.font_size_lg', 'L')
    case 'xl':
      return t('auth.accessibility.font_size_xl', 'XL')
    default:
      return size
  }
}

export function AccessibilitySection() {
  const t = useT()
  const { preferences: storePreferences, loading: storeLoading, error: storeError } = useAccessibilityPreferences()
  const [preferences, setPreferences] = React.useState<Required<AccessibilityPreferences>>(DEFAULT_PREFERENCES)
  const [hydrated, setHydrated] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<AccessibilityMutationContext>({
    contextId: 'auth-profile-accessibility',
  })

  React.useEffect(() => {
    if (hydrated) return
    if (storeLoading) return
    setPreferences(normalizePreferences(storePreferences))
    setHydrated(true)
  }, [hydrated, storeLoading, storePreferences])

  const loading = !hydrated
  const loadError = storeError ? t('auth.profile.form.errors.load', 'Failed to load profile.') : null

  const handleSave = React.useCallback(async () => {
    setIsSaving(true)
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(
            '/api/auth/profile',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ accessibilityPreferences: preferences }),
            },
            {
              errorMessage: t('auth.profile.form.errors.save', 'Failed to update profile.'),
            },
          )
          dispatchAccessibilityPreferencesChanged(preferences)
          flash(t('auth.accessibility.save_success', 'Accessibility preferences saved'), 'success')
        },
        context: {
          entityType: 'user-profile',
          entityId: 'me',
          retryLastMutation,
        },
        mutationPayload: preferences,
      })
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('auth.profile.form.errors.save', 'Failed to update profile.')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [preferences, retryLastMutation, runMutation, t])

  const fontSizes: FontSizeOption[] = ['sm', 'md', 'lg', 'xl']

  return (
    <section className="space-y-6 rounded-lg border bg-background p-6 max-w-2xl">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">
          {t('auth.accessibility.section_title', 'Accessibility')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('auth.accessibility.section_description', 'Adjust contrast, font size, and motion preferences.')}
        </p>
      </header>

      {loadError ? (
        <Notice
          variant="error"
          compact
          message={loadError}
        />
      ) : null}

      <Alert variant="info">
        <AlertDescription>
          {t(
            'auth.accessibility.pending_visual_layer_notice',
            'Visual styling for these preferences is being finalized by the Design System team. Your choices are saved and will activate automatically once the token layer ships.',
          )}
        </AlertDescription>
      </Alert>

      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-md border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t('auth.accessibility.high_contrast', 'High contrast')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('auth.accessibility.high_contrast_description', 'Increases contrast for better readability')}
            </p>
          </div>
          <Switch
            checked={preferences.highContrast}
            onCheckedChange={(checked) => {
              setPreferences((current) => ({ ...current, highContrast: checked }))
            }}
            disabled={loading || isSaving}
            aria-label={t('auth.accessibility.high_contrast', 'High contrast')}
          />
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t('auth.accessibility.font_size', 'Font size')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('auth.accessibility.font_size_description', 'Scale text across the backoffice interface.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {fontSizes.map((size) => {
              const active = preferences.fontSize === size
              return (
                <Button
                  key={size}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  className="min-w-11"
                  onClick={() => {
                    setPreferences((current) => ({ ...current, fontSize: size }))
                  }}
                  aria-pressed={active}
                  disabled={loading || isSaving}
                >
                  {fontSizeLabel(t, size)}
                </Button>
              )
            })}
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t('auth.accessibility.reduced_motion', 'Reduce motion')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('auth.accessibility.reduced_motion_description', 'Respects your system preference')}
            </p>
          </div>
          <Switch
            checked={preferences.reducedMotion}
            onCheckedChange={(checked) => {
              setPreferences((current) => ({ ...current, reducedMotion: checked }))
            }}
            disabled={loading || isSaving}
            aria-label={t('auth.accessibility.reduced_motion', 'Reduce motion')}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => {
            void handleSave()
          }}
          disabled={loading || isSaving}
        >
          <Save className="mr-2 size-4" />
          {isSaving
            ? t('auth.accessibility.saving', 'Saving...')
            : t('auth.profile.form.save', 'Save changes')}
        </Button>
      </div>
    </section>
  )
}

export default AccessibilitySection
