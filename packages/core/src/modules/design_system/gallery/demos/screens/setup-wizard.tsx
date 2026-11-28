'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { KeyValue } from '@open-mercato/ui/blocks/key-value'
import { Inline, Stack } from '@open-mercato/ui/blocks/stack'
import { Wizard, type WizardStep } from '@open-mercato/ui/blocks/wizard'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Result } from '@open-mercato/ui/primitives/result'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { ScreenFrame, wait } from './frame'

type StepId = 'workspace' | 'team' | 'review'

type SetupValues = {
  name: string
  region: string
  adminEmail: string
  teamSize: string
  sendInvitations: boolean
}

export type SetupWizardScreenProps = {
  initial?: 'first-step' | 'step-error'
}

const STEP_ORDER: StepId[] = ['workspace', 'team', 'review']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FIELD_CLASS = 'min-w-56 flex-1'

const EMPTY_VALUES: SetupValues = { name: '', region: 'north', adminEmail: '', teamSize: 'small', sendInvitations: true }
const ERROR_VALUES: SetupValues = { name: 'Riverton service team', region: 'north', adminEmail: 'mira.sandoval@', teamSize: 'small', sendInvitations: true }

export function SetupWizardScreen({ initial = 'first-step' }: SetupWizardScreenProps) {
  const t = useT()
  const startsWithError = initial === 'step-error'
  const [values, setValues] = React.useState<SetupValues>(startsWithError ? ERROR_VALUES : EMPTY_VALUES)
  const [activeStepId, setActiveStepId] = React.useState<StepId>(startsWithError ? 'team' : 'workspace')
  const [invalidSteps, setInvalidSteps] = React.useState<StepId[]>(startsWithError ? ['team'] : [])
  const [finished, setFinished] = React.useState(false)

  const activeIndex = STEP_ORDER.indexOf(activeStepId)
  const regionLabels: Record<string, string> = {
    north: t('design_system.gallery.screens.setupWizard.regions.north', 'North region'),
    south: t('design_system.gallery.screens.setupWizard.regions.south', 'South region'),
  }
  const teamSizeLabels: Record<string, string> = {
    small: t('design_system.gallery.screens.setupWizard.teamSizes.small', 'Up to 10 people'),
    medium: t('design_system.gallery.screens.setupWizard.teamSizes.medium', '11 to 50 people'),
    large: t('design_system.gallery.screens.setupWizard.teamSizes.large', 'More than 50 people'),
  }
  const nameError =
    invalidSteps.includes('workspace') && values.name.trim() === ''
      ? t('design_system.gallery.screens.setupWizard.errors.name', 'Enter a workspace name')
      : undefined
  const emailError =
    invalidSteps.includes('team') && !EMAIL_PATTERN.test(values.adminEmail)
      ? t('design_system.gallery.screens.setupWizard.errors.email', 'Enter a full email address, for example name@company.com')
      : undefined

  const isStepValid = (stepId: StepId): boolean => {
    if (stepId === 'workspace') return values.name.trim() !== ''
    if (stepId === 'team') return EMAIL_PATTERN.test(values.adminEmail)
    return true
  }

  const stepTitles: Record<StepId, string> = {
    workspace: t('design_system.gallery.screens.setupWizard.steps.workspace', 'Workspace'),
    team: t('design_system.gallery.screens.setupWizard.steps.team', 'Team'),
    review: t('design_system.gallery.screens.setupWizard.steps.review', 'Review'),
  }
  const steps: WizardStep[] = STEP_ORDER.map((stepId, index) => ({
    id: stepId,
    title: stepTitles[stepId],
    ...(invalidSteps.includes(stepId) && !isStepValid(stepId)
      ? { state: 'error' as const, errorMessage: t('design_system.gallery.screens.setupWizard.errors.step', 'one field needs a correction') }
      : index < activeIndex
        ? { state: 'complete' as const }
        : {}),
  }))

  const restart = () => {
    setValues(EMPTY_VALUES)
    setInvalidSteps([])
    setActiveStepId('workspace')
    setFinished(false)
  }

  const header = (
    <EntityHeader
      backLabel={t('design_system.gallery.screens.setupWizard.back', 'Workspaces')}
      onBack={() => undefined}
      title={t('design_system.gallery.screens.setupWizard.title', 'Set up a workspace')}
      subtitle={finished ? undefined : t('design_system.gallery.screens.setupWizard.subtitle', 'Three short steps. You can change everything later in settings.')}
    />
  )

  if (finished) {
    return (
      <ScreenFrame width="narrow">
        {header}
        <Result
          status="success"
          focusTitle
          title={t('design_system.gallery.screens.setupWizard.done.title', 'Workspace created')}
          subtitle={
            values.sendInvitations
              ? t('design_system.gallery.screens.setupWizard.done.invited', '{name} is ready. An invitation is on its way to {email}.', { name: values.name, email: values.adminEmail })
              : t('design_system.gallery.screens.setupWizard.done.ready', '{name} is ready. Invite the administrator when you want to start.', { name: values.name })
          }
          actions={
            <Button type="button" variant="outline" onClick={restart}>
              {t('design_system.gallery.screens.setupWizard.done.restart', 'Set up another workspace')}
            </Button>
          }
        />
      </ScreenFrame>
    )
  }

  return (
    <ScreenFrame width="narrow">
      {header}
      <Wizard
        steps={steps}
        activeStepId={activeStepId}
        onNext={async () => {
          if (!isStepValid(activeStepId)) {
            setInvalidSteps((current) => (current.includes(activeStepId) ? current : [...current, activeStepId]))
            return false
          }
          setActiveStepId(STEP_ORDER[activeIndex + 1])
          return true
        }}
        onBack={() => setActiveStepId(STEP_ORDER[activeIndex - 1])}
        onStepSelect={(stepId) => {
          const target = STEP_ORDER.find((candidate) => candidate === stepId)
          if (target) setActiveStepId(target)
        }}
        onFinish={async () => {
          await wait(700)
          setFinished(true)
        }}
      >
        {activeStepId === 'workspace' ? (
          <Inline gap={4} wrap>
            <FormField className={FIELD_CLASS} label={t('design_system.gallery.screens.setupWizard.fields.name', 'Workspace name')} required error={nameError}>
              <Input value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} autoComplete="off" />
            </FormField>
            <Select value={values.region} onValueChange={(next) => setValues((current) => ({ ...current, region: next }))}>
              <FormField className={FIELD_CLASS} label={t('design_system.gallery.screens.setupWizard.fields.region', 'Region')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormField>
              <SelectContent>
                {Object.entries(regionLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Inline>
        ) : null}
        {activeStepId === 'team' ? (
          <Inline gap={4} wrap align="start">
            <FormField
              className={FIELD_CLASS}
              label={t('design_system.gallery.screens.setupWizard.fields.adminEmail', 'Administrator email')}
              required
              error={emailError}
            >
              <Input
                type="email"
                value={values.adminEmail}
                onChange={(event) => setValues((current) => ({ ...current, adminEmail: event.target.value }))}
                autoComplete="off"
              />
            </FormField>
            <Select value={values.teamSize} onValueChange={(next) => setValues((current) => ({ ...current, teamSize: next }))}>
              <FormField className={FIELD_CLASS} label={t('design_system.gallery.screens.setupWizard.fields.teamSize', 'Team size')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormField>
              <SelectContent>
                {Object.entries(teamSizeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Inline>
        ) : null}
        {activeStepId === 'review' ? (
          <Stack gap={6}>
            <KeyValue
              columns={2}
              layout="vertical"
              items={[
                { key: 'name', label: t('design_system.gallery.screens.setupWizard.fields.name', 'Workspace name'), value: values.name },
                { key: 'region', label: t('design_system.gallery.screens.setupWizard.fields.region', 'Region'), value: regionLabels[values.region] },
                { key: 'admin', label: t('design_system.gallery.screens.setupWizard.fields.adminEmail', 'Administrator email'), value: values.adminEmail },
                { key: 'size', label: t('design_system.gallery.screens.setupWizard.fields.teamSize', 'Team size'), value: teamSizeLabels[values.teamSize] },
              ]}
            />
            <SwitchField
              label={t('design_system.gallery.screens.setupWizard.fields.sendInvitations', 'Send the invitation now')}
              description={t('design_system.gallery.screens.setupWizard.fields.sendInvitationsHint', 'The administrator gets an email with a sign-in link.')}
              checked={values.sendInvitations}
              onCheckedChange={(next) => setValues((current) => ({ ...current, sendInvitations: next }))}
            />
          </Stack>
        ) : null}
      </Wizard>
    </ScreenFrame>
  )
}
