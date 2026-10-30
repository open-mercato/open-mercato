/**
 * @jest-environment jsdom
 *
 * Regression for the 0.7.1 deal-status rename. This dialog is where the two bugs
 * that motivated it were visible: it wrote the misspelled `loose`, and it resolved
 * `customers.deals.kanban.quickDeal.status.loose`, which every locale translated as
 * "stalled" while the filter popover called the same stored value "Lost".
 *
 * Both halves are asserted here because they can regress independently. The option
 * VALUE is what reaches the database, and reverting it alone leaves the whole
 * customers suite green. The i18n KEY is derived from that value at render time, so
 * a future edit that changes one without the other silently falls back to printing
 * the raw status token as its own label.
 */
import * as React from 'react'
import { render } from '@testing-library/react'

// translateWithFallback treats `t(key) === key` as "no translation" and returns the
// fallback instead, so a mock that echoes the key would hide which key was requested.
// Echo a marked-up translation instead: the assertions below can then read the key the
// dialog actually resolved, and a fallback would be visibly unmarked.
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => `translated:${key}`,
}))

type FormField = { id: string; options?: Array<{ value: string; label: string }> }
let capturedFields: FormField[] | null = null
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  __esModule: true,
  CrudForm: (props: { fields?: FormField[] }) => {
    capturedFields = props.fields ?? null
    return null
  },
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn().mockResolvedValue({}),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

import { QuickDealDialog, type QuickDealContext } from '../QuickDealDialog'

const context: QuickDealContext = {
  pipelineId: 'p-1',
  pipelineName: 'Sales',
  pipelineStageId: 's-1',
  pipelineStageLabel: 'Qualified',
}

function renderDialog() {
  return render(
    <QuickDealDialog
      open
      context={context}
      onClose={jest.fn()}
      onCreated={jest.fn()}
      currencies={[{ code: 'PLN', isBase: true }]}
    />,
  )
}

function statusOptions(): Array<{ value: string; label: string }> {
  const field = (capturedFields ?? []).find((entry) => entry.id === 'status')
  expect(field).toBeDefined()
  return field?.options ?? []
}

describe('QuickDealDialog status options (0.7.1 lost/loose rename)', () => {
  afterEach(() => {
    capturedFields = null
  })

  it('offers `lost` as the terminal option and never the misspelled `loose`', () => {
    renderDialog()
    const values = statusOptions().map((option) => option.value)

    expect(values).toContain('lost')
    expect(values).not.toContain('loose')
    expect(values).toEqual(['open', 'in_progress', 'win', 'lost'])
  })

  it('resolves the lost label through the `.lost` i18n key, not `.loose`', () => {
    renderDialog()
    const lost = statusOptions().find((option) => option.value === 'lost')

    expect(lost?.label).toBe('translated:customers.deals.kanban.quickDeal.status.lost')
  })
})
