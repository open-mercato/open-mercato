"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useFormRunner } from './state/useFormRunner'
import type { RuntimeClient } from './state/runtime-client'
import type { LogicState } from '../../services/form-logic-evaluator'
import { CompletionScreen } from './components/CompletionScreen'
import { LocaleSwitch } from './components/LocaleSwitch'
import { ResumeGate } from './components/ResumeGate'
import { ReviewStep } from './components/ReviewStep'
import { SaveIndicator } from './components/SaveIndicator'
import { SectionStepper } from './components/SectionStepper'
import { CORE_RENDERER_MAP, registerCoreRenderers } from './renderers'
import type {
  RunnerAttachmentUploader,
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
  /**
   * Optional transport client. Omitted ⇒ the default authenticated client
   * (portal flow). The public runner pages inject an anonymous token client.
   */
  client?: RuntimeClient
  pdfDownloadEnabled?: boolean
  onDownloadPdf?: (submissionId: string) => void
  onReturnHome?: () => void
  /** Per-distribution custom completion heading. */
  completionTitle?: string | null
  /** Per-distribution custom completion body. */
  completionMessage?: string | null
  /**
   * Per-distribution redirect target. When set, reaching the `completed`
   * stage navigates the browser there instead of rendering the completion
   * screen.
   */
  redirectUrl?: string | null
}

export function FormRunner(props: FormRunnerProps) {
  ensureRenderersRegistered()
  const t = useT()
  const runner = useFormRunner({
    formKey: props.formKey,
    subjectType: props.subjectType,
    subjectId: props.subjectId,
    initialSubmissionId: props.initialSubmissionId,
    client: props.client,
  })
  const {
    stage,
    schemaResponse,
    schema,
    sections,
    fieldOrder,
    visibleFieldIndex,
    logicState,
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
    client,
  } = runner

  const callerRoles = schemaResponse?.callerRoles ?? []

  const [pdfError, setPdfError] = React.useState<string | null>(null)
  const handleDownloadPdf = React.useCallback(
    (submissionId: string) => {
      setPdfError(null)
      if (props.onDownloadPdf) {
        props.onDownloadPdf(submissionId)
        return
      }
      void client.downloadPdf(submissionId).catch((error) => {
        const message =
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : t('forms.runner.completion.download_pdf_failed', {
                fallback: 'We could not download the PDF copy. Please try again.',
              })
        setPdfError(message)
      })
    },
    [client, props, t],
  )
  // A submitted form always has a snapshot (generated on submit or lazily on
  // first download), so the download is enabled by default. Callers may force
  // it off (e.g. while a snapshot is still rendering) via `pdfDownloadEnabled`.
  const pdfDownloadEnabled = props.pdfDownloadEnabled ?? true

  const uploader = React.useMemo<RunnerAttachmentUploader>(
    () => ({
      upload: ({ submissionId, fieldKey, file }) =>
        client.uploadAttachment(submissionId, fieldKey, file),
      downloadUrl: (submissionId, attachmentId) =>
        client.attachmentDownloadUrl(submissionId, attachmentId),
    }),
    [client],
  )

  const completedSet = React.useMemo(() => {
    const set = new Set<number>()
    for (let index = 0; index < sections.length; index += 1) {
      if (validateSection(index).length === 0) set.add(index)
    }
    return set
  }, [sections, validateSection])

  const redirectTarget = props.redirectUrl?.trim() ? props.redirectUrl.trim() : null
  React.useEffect(() => {
    if (stage === 'completed' && redirectTarget && typeof window !== 'undefined') {
      window.location.href = redirectTarget
    }
  }, [stage, redirectTarget])

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
    if (redirectTarget) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Spinner className="h-5 w-5" />
          <span className="ml-2 text-sm">
            {t('forms.runner.completion.redirecting', { fallback: 'Redirecting…' })}
          </span>
        </div>
      )
    }
    return (
      <CompletionScreen
        submission={submission}
        schemaResponse={schemaResponse}
        pdfDownloadEnabled={pdfDownloadEnabled}
        onDownloadPdf={() => handleDownloadPdf(submission.id)}
        onReturnHome={props.onReturnHome}
        completionTitle={props.completionTitle}
        completionMessage={props.completionMessage}
        pdfError={pdfError}
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
    // Jumps (`x-om-jumps`): when the current section declares jump rules, the
    // live logic state resolves the next target against current answers +
    // variables (matches the reactive runner). `next` falls through to the
    // default sequential flow; `submit` / `ending` route to the review/submit
    // step (the public completion screen is generic — see report).
    if (logicState && currentSection) {
      const target = logicState.nextTarget(currentSection.key)
      if (target.type === 'page') {
        const idx = sections.findIndex((section) => section.key === target.pageKey)
        if (idx >= 0) {
          setCurrentSectionIndex(idx)
          return
        }
      } else if (target.type === 'ending') {
        const idx = sections.findIndex((section) => section.key === target.endingKey)
        if (idx >= 0) {
          setCurrentSectionIndex(idx)
        }
        enterReview()
        return
      } else if (target.type === 'submit') {
        enterReview()
        return
      }
    }
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
          // Conditional visibility (`x-om-visibility-if`): skip fields the
          // live logic state hides for the current answers. Matches the
          // reactive runner and aligns with T1's server-side slicing.
          if (logicState && !logicState.visibleFieldKeys.has(fieldKey)) return null
          const rawNode = (schema.properties ?? {})[fieldKey] as RunnerFieldNode | undefined
          if (!rawNode) return null
          // Recall (`@{...}` tokens) in label/help — resolved against current
          // answers + variables. Sensitive fields resolve to '' (rule 13).
          const node = logicState ? resolveNodeRecall(rawNode, logicState, locale) : rawNode
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
            uploader: descriptor.type === 'file' ? uploader : undefined,
            submissionId: submission.id,
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

/**
 * Returns a field node whose `x-om-label` / `x-om-help` are recall-resolved for
 * the active locale. Recall tokens (`@{...}`) substitute current answers,
 * hidden values, and computed variables; sensitive-field tokens resolve to ''
 * (rule 13) because `LogicState.resolveRecall` enforces redaction. The
 * resolved string is stored under the active `locale` key so the renderers'
 * `resolveLocaleString(..., locale, ...)` picks it up unchanged. Nodes without
 * recall-bearing label/help are returned untouched to avoid churn.
 */
function resolveNodeRecall(
  node: RunnerFieldNode,
  logicState: LogicState,
  locale: string,
): RunnerFieldNode {
  const rawLabel = node['x-om-label']
  const rawHelp = node['x-om-help']
  const hasLabelRecall = mapHasRecall(rawLabel)
  const hasHelpRecall = mapHasRecall(rawHelp)
  if (!hasLabelRecall && !hasHelpRecall) return node
  const next: RunnerFieldNode = { ...node }
  if (hasLabelRecall) {
    next['x-om-label'] = { ...(rawLabel ?? {}), [locale]: logicState.resolveRecall(rawLabel, locale) }
  }
  if (hasHelpRecall) {
    next['x-om-help'] = { ...(rawHelp ?? {}), [locale]: logicState.resolveRecall(rawHelp, locale) }
  }
  return next
}

function mapHasRecall(map: Record<string, string> | undefined): boolean {
  if (!map) return false
  for (const value of Object.values(map)) {
    if (typeof value === 'string' && value.includes('@{')) return true
  }
  return false
}
