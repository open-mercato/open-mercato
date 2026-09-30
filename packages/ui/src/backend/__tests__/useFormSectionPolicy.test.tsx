/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import {
  applyFormSectionPolicyOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'
import { useFormSectionPolicy } from '../injection/useFormSectionPolicy'

const HOST = 'crud-form:catalog.product'

function Probe({ hostId = HOST }: { hostId?: string }) {
  const policy = useFormSectionPolicy(hostId)
  renderCount += 1
  return <div data-testid="hidden">{policy ? (policy.hidden ?? []).join(',') : 'none'}</div>
}

let renderCount = 0

beforeEach(() => {
  resetModuleContractOverridesForTests()
  renderCount = 0
})

afterEach(() => {
  resetModuleContractOverridesForTests()
})

describe('useFormSectionPolicy', () => {
  it('reads null when no policy is configured', () => {
    render(<Probe />)

    expect(screen.getByTestId('hidden')).toHaveTextContent('none')
  })

  it('reads a policy that was applied before mount', () => {
    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['compliance', 'product-uom'] } })

    render(<Probe />)

    expect(screen.getByTestId('hidden')).toHaveTextContent('compliance,product-uom')
  })

  it('re-renders when a policy arrives AFTER mount', () => {
    // This is the case a plain getter cannot serve: on the client the override
    // dispatcher resolves after first paint.
    render(<Probe />)
    expect(screen.getByTestId('hidden')).toHaveTextContent('none')

    act(() => {
      applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['compliance'] } })
    })

    expect(screen.getByTestId('hidden')).toHaveTextContent('compliance')
  })

  it('ignores a policy applied for a different host', () => {
    render(<Probe />)

    act(() => {
      applyFormSectionPolicyOverrides({ 'crud-form:customers.company': { hidden: ['profile'] } })
    })

    expect(screen.getByTestId('hidden')).toHaveTextContent('none')
  })

  it('settles instead of looping — a stable snapshot identity', () => {
    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['compliance'] } })

    render(<Probe />)
    const rendersAfterMount = renderCount

    // Re-reading the same unchanged policy must not schedule further renders;
    // a snapshot that allocated a fresh object per call would loop here.
    act(() => {})

    expect(renderCount).toBe(rendersAfterMount)
  })

  it('drops back to null when the policy is cleared', () => {
    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['compliance'] } })
    render(<Probe />)
    expect(screen.getByTestId('hidden')).toHaveTextContent('compliance')

    act(() => {
      applyFormSectionPolicyOverrides(null)
    })

    expect(screen.getByTestId('hidden')).toHaveTextContent('none')
  })
})
