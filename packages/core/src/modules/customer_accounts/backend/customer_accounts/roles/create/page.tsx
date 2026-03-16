"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function CreateCustomerRolePage() {
  const t = useT()
  const router = useRouter()
  const [isSaving, setIsSaving] = React.useState(false)

  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const [isDefault, setIsDefault] = React.useState(false)
  const [customerAssignable, setCustomerAssignable] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    entityType: string
  }>({
    contextId: 'customer_accounts:role:create',
  })

  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: { entityType: 'customer_accounts:role' },
      })
    },
    [runMutation],
  )

  const handleNameChange = React.useCallback((value: string) => {
    setName(value)
    if (!slugTouched) {
      setSlug(slugify(value))
    }
  }, [slugTouched])

  const handleSlugChange = React.useCallback((value: string) => {
    setSlugTouched(true)
    setSlug(value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!name.trim() || !slug.trim()) {
      flash(t('customer_accounts.admin.roleCreate.error.required', 'Name and slug are required'), 'error')
      return
    }
    setIsSaving(true)
    try {
      await runMutationWithContext(async () => {
        const call = await apiCall(
          '/api/customer_accounts/admin/roles',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: name.trim(),
              slug: slug.trim(),
              description: description.trim() || undefined,
              isDefault,
              customerAssignable,
            }),
          },
        )
        if (!call.ok) {
          const data = call.result as Record<string, unknown> | null
          flash((data?.error as string) || t('customer_accounts.admin.roleCreate.error.save', 'Failed to create role'), 'error')
          return
        }
        const data = call.result as Record<string, unknown> | null
        flash(t('customer_accounts.admin.roleCreate.flash.created', 'Role created'), 'success')
        const role = data?.role as Record<string, unknown> | undefined
        if (role?.id) {
          router.push(`/backend/customer_accounts/roles/${role.id}`)
        } else {
          router.push('/backend/customer_accounts/roles')
        }
      }, { name: name.trim(), slug: slug.trim(), isDefault, customerAssignable })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.roleCreate.error.save', 'Failed to create role')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [customerAssignable, description, isDefault, name, router, runMutationWithContext, slug, t])

  return (
    <Page>
      <PageBody className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {t('customer_accounts.admin.roleCreate.title', 'Create Customer Role')}
          </h1>
          <Button variant="outline" asChild>
            <Link href="/backend/customer_accounts/roles">
              {t('customer_accounts.admin.roleCreate.actions.cancel', 'Cancel')}
            </Link>
          </Button>
        </div>

        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="text-sm font-semibold">
            {t('customer_accounts.admin.roleCreate.sections.details', 'Role Details')}
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium" htmlFor="role-name">
                {t('customer_accounts.admin.roleCreate.fields.name', 'Name')}
              </label>
              <input
                id="role-name"
                type="text"
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm"
                placeholder={t('customer_accounts.admin.roleCreate.fields.namePlaceholder', 'e.g. Buyer')}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="role-slug">
                {t('customer_accounts.admin.roleCreate.fields.slug', 'Slug')}
              </label>
              <input
                id="role-slug"
                type="text"
                value={slug}
                onChange={(event) => handleSlugChange(event.target.value)}
                className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono"
                placeholder={t('customer_accounts.admin.roleCreate.fields.slugPlaceholder', 'e.g. buyer')}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('customer_accounts.admin.roleCreate.fields.slugHint', 'Lowercase letters, numbers, hyphens, and underscores only.')}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="role-description">
                {t('customer_accounts.admin.roleCreate.fields.description', 'Description')}
              </label>
              <textarea
                id="role-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(event) => setIsDefault(event.target.checked)}
                  className="rounded border-border"
                />
                {t('customer_accounts.admin.roleCreate.fields.isDefault', 'Default role (auto-assigned to new users)')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={customerAssignable}
                  onChange={(event) => setCustomerAssignable(event.target.checked)}
                  className="rounded border-border"
                />
                {t('customer_accounts.admin.roleCreate.fields.customerAssignable', 'Customers can self-assign')}
              </label>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => { void handleSubmit() }} disabled={isSaving}>
            {isSaving
              ? t('customer_accounts.admin.roleCreate.actions.saving', 'Creating...')
              : t('customer_accounts.admin.roleCreate.actions.create', 'Create Role')}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/backend/customer_accounts/roles">
              {t('customer_accounts.admin.roleCreate.actions.cancel', 'Cancel')}
            </Link>
          </Button>
        </div>
      </PageBody>
    </Page>
  )
}
