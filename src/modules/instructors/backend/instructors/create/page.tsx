"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { CrudFormField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { z } from 'zod'

type InstructorFormValues = {
  userId: string
  displayName: string
  slug: string
  bio: string
  headline: string
  specializations: string
  experienceYears: string
  hourlyRate: string
  currency: string
  websiteUrl: string
  githubUrl: string
  linkedinUrl: string
}

function createFormSchema() {
  return z.object({
    userId: z.string().min(1, 'User ID is required'),
    displayName: z.string().min(1, 'Display name is required').max(200),
    slug: z.string().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
    bio: z.string().max(10000).optional(),
    headline: z.string().max(300).optional(),
    specializations: z.string().optional(),
    experienceYears: z.string().optional(),
    hourlyRate: z.string().max(20).optional(),
    currency: z.string().length(3).default('USD'),
    websiteUrl: z.string().url().optional().or(z.literal('')),
    githubUrl: z.string().url().optional().or(z.literal('')),
    linkedinUrl: z.string().url().optional().or(z.literal('')),
  })
}

export default function CreateInstructorPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId } = useOrganizationScopeDetail()

  const formSchema = React.useMemo(() => createFormSchema(), [])

  const fields = React.useMemo<CrudFormField[]>(() => [
    { name: 'userId', label: t('instructors.form.userId', 'User ID'), type: 'text', required: true, placeholder: t('instructors.form.userIdPlaceholder', 'UUID of the auth user') },
    { name: 'displayName', label: t('instructors.form.displayName', 'Display Name'), type: 'text', required: true },
    { name: 'slug', label: t('instructors.form.slug', 'URL Slug'), type: 'text', required: true, placeholder: 'john-doe' },
    { name: 'headline', label: t('instructors.form.headline', 'Headline'), type: 'text', placeholder: t('instructors.form.headlinePlaceholder', 'e.g. Senior UE5 Technical Artist') },
    { name: 'bio', label: t('instructors.form.bio', 'Bio'), type: 'textarea' },
    { name: 'specializations', label: t('instructors.form.specializations', 'Specializations'), type: 'text', placeholder: t('instructors.form.specializationsPlaceholder', 'Comma-separated: blueprints, niagara, pcg') },
    { name: 'experienceYears', label: t('instructors.form.experienceYears', 'Years of Experience'), type: 'text' },
    { name: 'hourlyRate', label: t('instructors.form.hourlyRate', 'Hourly Rate'), type: 'text' },
    { name: 'currency', label: t('instructors.form.currency', 'Currency'), type: 'text' },
    { name: 'websiteUrl', label: t('instructors.form.websiteUrl', 'Website URL'), type: 'text' },
    { name: 'githubUrl', label: t('instructors.form.githubUrl', 'GitHub URL'), type: 'text' },
    { name: 'linkedinUrl', label: t('instructors.form.linkedinUrl', 'LinkedIn URL'), type: 'text' },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'identity', label: t('instructors.form.groups.identity', 'Identity'), fields: ['userId', 'displayName', 'slug', 'headline'] },
    { id: 'about', label: t('instructors.form.groups.about', 'About'), fields: ['bio', 'specializations', 'experienceYears'] },
    { id: 'pricing', label: t('instructors.form.groups.pricing', 'Pricing'), fields: ['hourlyRate', 'currency'] },
    { id: 'links', label: t('instructors.form.groups.links', 'Links'), fields: ['websiteUrl', 'githubUrl', 'linkedinUrl'] },
  ], [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<InstructorFormValues>
          title={t('instructors.create.title', 'Add Instructor')}
          backHref="/backend/instructors"
          fields={fields}
          groups={groups}
          initialValues={{ currency: 'USD' } as Partial<InstructorFormValues>}
          submitLabel={t('instructors.form.submit', 'Create Instructor')}
          cancelHref="/backend/instructors"
          schema={formSchema}
          onSubmit={async (values) => {
            if (!values.displayName?.trim()) {
              throw createCrudFormError(
                t('instructors.form.displayName.error', 'Display name is required.'),
                { displayName: t('instructors.form.displayName.error', 'Display name is required.') },
              )
            }

            const specializations = values.specializations
              ? values.specializations.split(',').map((spec) => spec.trim()).filter(Boolean)
              : undefined

            const payload: Record<string, unknown> = {
              userId: values.userId,
              displayName: values.displayName.trim(),
              slug: values.slug.trim(),
              headline: values.headline?.trim() || undefined,
              bio: values.bio?.trim() || undefined,
              specializations,
              experienceYears: values.experienceYears ? Number(values.experienceYears) : undefined,
              hourlyRate: values.hourlyRate?.trim() || undefined,
              currency: values.currency || 'USD',
              websiteUrl: values.websiteUrl?.trim() || undefined,
              githubUrl: values.githubUrl?.trim() || undefined,
              linkedinUrl: values.linkedinUrl?.trim() || undefined,
              ...(organizationId ? { organizationId } : {}),
            }

            const { result: created } = await createCrud<{ id?: string }>('instructors', payload)
            const newId = created && typeof created.id === 'string' ? created.id : null

            flash(t('instructors.form.success', 'Instructor created successfully.'), 'success')
            if (newId) router.push(`/backend/instructors/${newId}`)
            else router.push('/backend/instructors')
          }}
        />
      </PageBody>
    </Page>
  )
}
