import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import type { WizardProps, WizardStep } from '../contracts/wizard'

type StepField = { id: string; label: string; value: string }

const stepFields: Record<string, StepField[]> = {
  details: [
    { id: 'wizard-fixture-name', label: 'Product name', value: 'Ergonomic office chair' },
    { id: 'wizard-fixture-sku', label: 'SKU', value: 'CHR-2041' },
  ],
  pricing: [
    { id: 'wizard-fixture-price', label: 'Net price', value: '249.00' },
    { id: 'wizard-fixture-tax', label: 'Tax rate', value: '23%' },
  ],
  review: [
    { id: 'wizard-fixture-channel', label: 'Sales channel', value: 'Online store' },
    { id: 'wizard-fixture-publish', label: 'Publish date', value: '2026-12-01' },
  ],
}

function stepContent(stepId: string): React.ReactNode {
  return React.createElement(
    'div',
    { className: 'grid grid-cols-1 gap-4 md:grid-cols-2' },
    (stepFields[stepId] ?? []).map((field) =>
      React.createElement(
        'div',
        { key: field.id, className: 'flex flex-col gap-2' },
        React.createElement(Label, { htmlFor: field.id }, field.label),
        React.createElement(Input, { id: field.id, defaultValue: field.value }),
      ),
    ),
  )
}

const baseSteps: WizardStep[] = [
  { id: 'details', title: 'Details', description: 'Basic information' },
  { id: 'pricing', title: 'Pricing', description: 'Prices and taxes' },
  { id: 'review', title: 'Review', description: 'Confirm and publish' },
]

const noopAdvance = async (): Promise<boolean> => true
const noopFinish = async (): Promise<void> => undefined
const noopBack = (): void => undefined
const noopSelect = (stepId: string): void => {
  void stepId
}

const base: WizardProps = {
  steps: baseSteps,
  activeStepId: 'details',
  onNext: noopAdvance,
  onBack: noopBack,
  onFinish: noopFinish,
  children: stepContent('details'),
}

export const wizardFixtures = {
  firstStep: base,
  middleStep: {
    ...base,
    activeStepId: 'pricing',
    children: stepContent('pricing'),
    steps: [{ ...baseSteps[0], state: 'complete' }, baseSteps[1], baseSteps[2]],
  },
  lastStep: {
    ...base,
    activeStepId: 'review',
    children: stepContent('review'),
    steps: [
      { ...baseSteps[0], state: 'complete' },
      { ...baseSteps[1], state: 'complete' },
      baseSteps[2],
    ],
  },
  withError: {
    ...base,
    activeStepId: 'review',
    children: stepContent('review'),
    steps: [
      { ...baseSteps[0], state: 'complete' },
      { ...baseSteps[1], state: 'error' },
      baseSteps[2],
    ],
  },
  selectable: {
    ...base,
    activeStepId: 'review',
    children: stepContent('review'),
    onStepSelect: noopSelect,
    steps: [
      { ...baseSteps[0], state: 'complete' },
      { ...baseSteps[1], state: 'complete' },
      baseSteps[2],
    ],
  },
  loading: { ...base, status: 'loading' },
  empty: { ...base, status: 'empty' },
  error: { ...base, status: 'error', errorMessage: 'The wizard could not be loaded.' },
} satisfies Record<string, WizardProps>

export type WizardFixtureName = keyof typeof wizardFixtures
