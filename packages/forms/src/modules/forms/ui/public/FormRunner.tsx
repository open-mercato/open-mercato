"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useFormRunner } from './state/useFormRunner'
import { CompletionScreen } from './components/CompletionScreen'
import { LocaleSwitch } from './components/LocaleSwitch'
import { ResumeGate } from './components/ResumeGate'
import { ReviewStep } from './components/ReviewStep'
import { SaveIndicator } from './components/SaveIndicator'
import { SectionStepper } from './components/SectionStepper'
import { CORE_RENDERER_MAP, registerCoreRenderers } from './renderers'
import type {
  RunnerFieldDescriptor,
  RunnerFieldNode,
  RunnerFieldRendererProps,
  RunnerSchema,
} from './types'

let renderersRegistered = false
function ensureRenderersRegistered(): void {
  if (renderersRegistered) return
  registerCoreRenderers()
  renderersRegistered = true
}

export type FormRunnerProps = {
  formKey: string
  subjectType: string
  subjectId: string
  initialSubmissionId?: string
  pdfDownloadEnabled?: boolean
  onDownloadPdf?: (submissionId: string) => void
  onReturnHome?: () => void
}

export function FormRunner(props: FormRunnerProps) {
  ensureRenderersRegistered()
  const t = useT()
  const runner = useFormRunner({
    formKey: props.formKey,
    subjectType: props.subjectType,
    subjectId: props.subjectId,
    initialSubmissionId: props.initialSubmissionId,
  })
  const {
    stage,
    schemaResponse,
    schema,
    sections,
    fieldOrder,
    visibleFieldIndex,
    submission,
    submissionRevision,
    values,
    conflictKeys,
    resumeCandidates,
    currentSectionIndex,
    setCurrentSectionIndex,
    locale,
    setLocale,
    setFieldValue,
    saveState,
    loadError,
    startNewSubmission,
    resumeExistingSubmission,
    enterReview,
    exitReview,
    submit,
    validateSection,
  } = runner

  const callerRoles = schemaResponse?.callerRoles ?? []

  const completedSet = React.useMemo(() => {
    const set = new Set<number>()
    for (let index = 0; index < sections.length; index += 1) {
      if (validateSection(index).length === 0) set.add(index)
    }
    return set
  }, [sections, validateSection])

  if (stage === 'loading') {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Spinner className="h-5 w-5" />
        <span className="ml-2 text-sm">
          {t('forms.runner.loading', { fallback: 'Loading form…' })}
        </span>
      </div>
    )
  }

  if (stage === 'error') {
    const fallback = t('forms.runner.error.generic', {
      fallback: 'Something went wrong loading the form.',
    })
    let message: string = loadError?.message ?? fallback
    if (loadError?.code === 'NOT_FOUND') {
      message = t('forms.runner.error.not_found', { fallback: "We couldn't find that form." })
    } else if (loadError?.code === 'NO_PUBLISHED_VERSION') {
      message = t('forms.runner.error.no_published_version', {
        fallback: 'This form has no published version yet.',
      })
    }
    return (
      <Alert variant="destructive">
        <AlertTitle>{fallback}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }

  if (stage === 'resume_gate') {
    return (
      <ResumeGate
        candidates={resumeCandidates}
        onContinue={(submissionId) => {
          void resumeExistingSubmission(submissionId)
        }}
        onStartOver={() => {
          void startNewSubmission()
        }}
      />
    )
  }

  if (stage === 'completed' && submission && schemaResponse) {
    return (
      <CompletionScreen
        submission={submission}
        schemaResponse={schemaResponse}
        pdfDownloadEnabled={props.pdfDownloadEnabled ?? false}
        onDownloadPdf={
          props.onDownloadPdf ? () => props.onDownloadPdf?.(submission.id) : undefined
        }
        onReturnHome={props.onReturnHome}
      />
    )
  }

  if (stage === 'review' && schemaResponse) {
    return (
      <ReviewStep
        schemaResponse={schemaResponse}
        values={values}
        locale={locale}
        onBack={exitReview}
        onSubmit={() => {
          void submit()
        }}
        submitting={false}
      />
    )
  }

  if (stage === 'submitting' && schemaResponse) {
    return (
      <ReviewStep
        schemaResponse={schemaResponse}
        values={values}
        locale={locale}
        onBack={exitReview}
        onSubmit={() => {}}
        submitting
      />
    )
  }

  if (!schemaResponse || !schema || !submission || !submissionRevision) {
    return null
  }

  const defaultLocale = schemaResponse.form.defaultLocale
  const supportedLocales = schemaResponse.form.supportedLocales

  const currentSection = sections[currentSectionIndex] ?? null
  const sectionFieldKeys = currentSection
    ? currentSection.fieldKeys.filter((key) => fieldOrder.includes(key))
    : fieldOrder

  const isLastSection = currentSectionIndex >= sections.length - 1
  const sectionMissing = validateSection(currentSectionIndex)

  const advance = () => {
    if (sectionMissing.length > 0) return
    if (isLastSection) {
      enterReview()
      return
    }
    setCurrentSectionIndex(currentSectionIndex + 1)
  }

  const back = () => {
    if (currentSectionIndex === 0) return
    setCurrentSectionIndex(currentSectionIndex - 1)
  }

  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{schemaResponse.form.name}</h1>
          <p className="text-xs text-muted-foreground">
            v{schemaResponse.formVersion.versionNumber}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LocaleSwitch locales={supportedLocales} value={locale} onChange={setLocale} />
          <SaveIndicator state={saveState} />
        </div>
      </header>

      <SectionStepper
        sections={sections}
        currentIndex={currentSectionIndex}
        completedSet={completedSet}
        locale={locale}
        defaultLocale={defaultLocale}
        onSelect={(index) => setCurrentSectionIndex(index)}
      />

      {conflictKeys.length > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            {t('forms.runner.save_indicator.conflict', {
              fallback: 'We refreshed the form to merge a change made elsewhere.',
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4">
        {sectionFieldKeys.map((fieldKey) => {
          const node = (schema.properties ?? {})[fieldKey] as RunnerFieldNode | undefined
          if (!node) return null
          const descriptor: RunnerFieldDescriptor =
            visibleFieldIndex[fieldKey] ?? {
              key: fieldKey,
              type: typeof node['x-om-type'] === 'string' ? (node['x-om-type'] as string) : 'text',
              sectionKey: currentSection?.key ?? null,
              sensitive: node['x-om-sensitive'] === true,
              editableBy: Array.isArray(node['x-om-editable-by'])
                ? (node['x-om-editable-by'] as string[])
                : [],
              visibleTo: Array.isArray(node['x-om-visible-to'])
                ? (node['x-om-visible-to'] as string[])
                : [],
              required: Array.isArray((schema as RunnerSchema).required)
                ? ((schema as RunnerSchema).required as string[]).includes(fieldKey)
                : false,
            }
          const Renderer = CORE_RENDERER_MAP[descriptor.type] ?? CORE_RENDERER_MAP.text
          const editable =
            descriptor.editableBy.length === 0 ||
            descriptor.editableBy.some((role) => callerRoles.includes(role))
          const rendererProps: RunnerFieldRendererProps = {
            field: descriptor,
            fieldNode: node,
            value: values[fieldKey],
            onChange: (next) => setFieldValue(fieldKey, next),
            locale,
            defaultLocale,
            disabled: !editable,
          }
          return <Renderer key={fieldKey} {...rendererProps} />
        })}
      </section>

      {sectionMissing.length > 0 ? (
        <p className="text-xs text-status-warning-foreground">
          {t('forms.runner.section.required_missing', {
            fallback: 'Please fill in all required fields before continuing.',
          })}
        </p>
      ) : null}

      <footer className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={back}
          disabled={currentSectionIndex === 0}
        >
          {t('forms.runner.section.actions.back', { fallback: 'Back' })}
        </Button>
        <Button type="button" onClick={advance} disabled={sectionMissing.length > 0}>
          {isLastSection
            ? t('forms.runner.section.actions.review', { fallback: 'Review answers' })
            : t('forms.runner.section.actions.next', { fallback: 'Next' })}
        </Button>
      </footer>
    </article>
  )
}
