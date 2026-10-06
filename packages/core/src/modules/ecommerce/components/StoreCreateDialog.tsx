'use client'

import * as React from 'react'
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import {
  ECOMMERCE_LOCALE_PATTERN,
  ECOMMERCE_STORE_CODE_PATTERN,
  ECOMMERCE_STORE_SLUG_PATTERN,
} from '../data/validators'
import { STORES_API_PATH } from './storeAdmin'

export type StoreCreateFormValues = {
  name: string
  code: string
  slug: string
  defaultLocale: string
  supportedLocales: string[]
  defaultCurrencyCode: string
}

const REQUIRED_MESSAGE = 'ui.forms.errors.required'

export const storeCreateFormSchema = z
  .object({
    name: z.string().trim().min(1, REQUIRED_MESSAGE).max(200),
    code: z
      .string()
      .trim()
      .min(1, REQUIRED_MESSAGE)
      .max(80)
      .regex(ECOMMERCE_STORE_CODE_PATTERN, 'ecommerce.validation.codeInvalid'),
    slug: z
      .string()
      .trim()
      .min(1, REQUIRED_MESSAGE)
      .max(120)
      .regex(ECOMMERCE_STORE_SLUG_PATTERN, 'ecommerce.validation.slugInvalid'),
    defaultLocale: z.string().trim().regex(ECOMMERCE_LOCALE_PATTERN, 'ecommerce.validation.localeInvalid'),
    supportedLocales: z
      .array(z.string().trim().regex(ECOMMERCE_LOCALE_PATTERN, 'ecommerce.validation.localeInvalid'))
      .min(1, REQUIRED_MESSAGE)
      .refine((locales) => new Set(locales).size === locales.length, 'ecommerce.validation.localesDuplicate'),
    defaultCurrencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'ecommerce.validation.currencyCodeInvalid'),
  })
  .superRefine((value, ctx) => {
    if (value.supportedLocales.includes(value.defaultLocale)) return
    ctx.addIssue({
      code: 'custom',
      path: ['defaultLocale'],
      message: 'ecommerce.validation.defaultLocaleNotSupported',
    })
  })

export function buildStoreCreatePayload(values: StoreCreateFormValues): StoreCreateFormValues {
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    slug: values.slug.trim(),
    defaultLocale: values.defaultLocale.trim(),
    supportedLocales: values.supportedLocales.map((locale) => locale.trim()),
    defaultCurrencyCode: values.defaultCurrencyCode.trim().toUpperCase(),
  }
}

type StoreCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (storeId: string | null) => void | Promise<void>
}

export function StoreCreateDialog({ open, onOpenChange, onCreated }: StoreCreateDialogProps) {
  const t = useT()
  const locale = useLocale()

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'name',
        type: 'text',
        label: t('ecommerce.backend.stores.form.name', 'Name'),
        required: true,
        maxLength: 200,
      },
      {
        id: 'code',
        type: 'text',
        label: t('ecommerce.backend.stores.form.code', 'Code'),
        description: t(
          'ecommerce.backend.stores.form.codeHint',
          'Internal identifier, unique in the workspace. Lowercase letters, digits, dashes and underscores.',
        ),
        required: true,
        maxLength: 80,
        layout: 'half',
      },
      {
        id: 'slug',
        type: 'text',
        label: t('ecommerce.backend.stores.form.slug', 'Slug'),
        description: t(
          'ecommerce.backend.stores.form.slugHint',
          'Short name used in store addresses, unique in the workspace. Lowercase letters, digits and dashes.',
        ),
        required: true,
        maxLength: 120,
        layout: 'half',
      },
      {
        id: 'defaultLocale',
        type: 'text',
        label: t('ecommerce.backend.stores.form.defaultLocale', 'Default language'),
        description: t('ecommerce.backend.stores.form.defaultLocaleHint', 'A language code such as en or pl-PL.'),
        required: true,
        layout: 'half',
      },
      {
        id: 'defaultCurrencyCode',
        type: 'text',
        label: t('ecommerce.backend.stores.form.currency', 'Currency'),
        description: t('ecommerce.backend.stores.form.currencyHint', 'Three-letter ISO code, for example EUR.'),
        placeholder: 'EUR',
        required: true,
        maxLength: 3,
        layout: 'half',
      },
      {
        id: 'supportedLocales',
        type: 'tags',
        label: t('ecommerce.backend.stores.form.supportedLocales', 'Supported languages'),
        description: t(
          'ecommerce.backend.stores.form.supportedLocalesHint',
          'Languages the store can be shown in. Must include the default language.',
        ),
        required: true,
      },
    ],
    [t],
  )

  const initialValues = React.useMemo<StoreCreateFormValues>(
    () => ({
      name: '',
      code: '',
      slug: '',
      defaultLocale: locale,
      supportedLocales: [locale],
      defaultCurrencyCode: '',
    }),
    [locale],
  )

  const handleSubmit = React.useCallback(
    async (values: StoreCreateFormValues) => {
      const call = await createCrud<{ id?: string | null }>(STORES_API_PATH, buildStoreCreatePayload(values), {
        errorMessage: t('ecommerce.backend.stores.errors.create', 'Failed to create the store.'),
      })
      flash(t('ecommerce.backend.stores.flash.created', 'Store created'), 'success')
      onOpenChange(false)
      const createdId = call.result?.id
      await onCreated(typeof createdId === 'string' ? createdId : null)
    },
    [onCreated, onOpenChange, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('ecommerce.backend.stores.create.title', 'Create store')}</DialogTitle>
          <DialogDescription>
            {t(
              'ecommerce.backend.stores.create.description',
              'The store starts as a draft. Add its domain and sales channel afterwards to publish it.',
            )}
          </DialogDescription>
        </DialogHeader>
        <CrudForm<StoreCreateFormValues>
          schema={storeCreateFormSchema}
          fields={fields}
          entityId={E.ecommerce.ecommerce_store}
          initialValues={initialValues}
          submitLabel={t('ecommerce.backend.stores.create.submit', 'Create store')}
          onSubmit={handleSubmit}
          embedded
        />
      </DialogContent>
    </Dialog>
  )
}
