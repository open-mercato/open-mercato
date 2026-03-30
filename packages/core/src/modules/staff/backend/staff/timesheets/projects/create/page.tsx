"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const BACK_HREF = '/backend/staff/timesheets/projects'

export default function TimesheetProjectCreatePage() {
  const t = useT()
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [code, setCode] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [projectType, setProjectType] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [costCenter, setCostCenter] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = React.useCallback(async () => {
    if (!name.trim() || !code.trim()) return
    setIsSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        code: code.trim(),
      }
      if (description.trim()) payload.description = description.trim()
      if (projectType.trim()) payload.projectType = projectType.trim()
      if (startDate) payload.startDate = startDate
      if (costCenter.trim()) payload.costCenter = costCenter.trim()

      await createCrud('staff/timesheets/time-projects', payload, {
        errorMessage: t('staff.timesheets.projects.errors.save', 'Failed to save project.'),
      })
      flash(t('staff.timesheets.projects.messages.saved', 'Project saved.'), 'success')
      router.push(BACK_HREF)
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('staff.timesheets.projects.errors.save', 'Failed to save project.')
      flash(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [name, code, description, projectType, startDate, costCenter, router, t])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSubmit()
    }
  }, [handleSubmit])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6" onKeyDown={handleKeyDown}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" asChild>
                <Link href={BACK_HREF}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <h1 className="text-xl font-semibold">
                {t('staff.timesheets.projects.form.createTitle', 'Create project')}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link href={BACK_HREF}>
                  {t('staff.timesheets.projects.form.actions.cancel', 'Cancel')}
                </Link>
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting || !name.trim() || !code.trim()}>
                {t('staff.timesheets.projects.form.actions.create', 'Create')}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 max-w-2xl">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="project-name">
                {t('staff.timesheets.projects.form.name', 'Name')} *
              </label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('staff.timesheets.projects.form.namePlaceholder', 'Project name')}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="project-code">
                {t('staff.timesheets.projects.form.code', 'Code')} *
              </label>
              <Input
                id="project-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
                placeholder={t('staff.timesheets.projects.form.codePlaceholder', 'PROJECT-001')}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="project-description">
                {t('staff.timesheets.projects.form.description', 'Description')}
              </label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('staff.timesheets.projects.form.descriptionPlaceholder', 'Project description')}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="project-type">
                {t('staff.timesheets.projects.form.projectType', 'Project type')}
              </label>
              <Input
                id="project-type"
                value={projectType}
                onChange={(event) => setProjectType(event.target.value)}
                placeholder={t('staff.timesheets.projects.form.projectTypePlaceholder', 'e.g. Internal, Client, R&D')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="project-start-date">
                {t('staff.timesheets.projects.form.startDate', 'Start date')}
              </label>
              <Input
                id="project-start-date"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="project-cost-center">
                {t('staff.timesheets.projects.form.costCenter', 'Cost center')}
              </label>
              <Input
                id="project-cost-center"
                value={costCenter}
                onChange={(event) => setCostCenter(event.target.value)}
                placeholder={t('staff.timesheets.projects.form.costCenterPlaceholder', 'Cost center code')}
              />
            </div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
