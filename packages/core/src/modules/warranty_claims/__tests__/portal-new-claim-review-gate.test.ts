/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The portal new-claim wizard must NOT create the claim until the customer is on the
// "Review & submit" step and explicitly confirms — advancing steps and submitting are
// separate actions (WQA-003 / #5284). The bug was a single handler that both advanced the
// step and (on the last-but-one step) submitted. This source-contract test guards the
// decoupling; it fails on the pre-fix shape where `handleSubmit` called `goNext()`.
const source = readFileSync(
  join(__dirname, '../frontend/[orgSlug]/portal/claims/new/page.tsx'),
  'utf8',
)

function functionBody(name: string): string {
  const start = source.indexOf(`const ${name} = React.useCallback`)
  if (start === -1) throw new Error(`function ${name} not found`)
  const end = source.indexOf('}, [', start)
  return source.slice(start, end === -1 ? undefined : end)
}

describe('portal new-claim wizard only submits from the Review step (#5284)', () => {
  it('handleSubmit finalizes only when currentStep === review and never advances steps', () => {
    const body = functionBody('handleSubmit')
    expect(body).toContain("currentStep === 'review'")
    expect(body).toContain('submitClaim()')
    // The pre-fix bug: handleSubmit fell through to goNext() for non-review steps.
    expect(body).not.toContain('goNext(')
  })

  it('goNext advances the step but never submits the claim', () => {
    const body = functionBody('goNext')
    expect(body).toContain('setCurrentStep(')
    expect(body).not.toContain('submitClaim')
  })

  it('the Next control is a plain button and the Review control is the only submit button', () => {
    // Non-review steps render an explicit type="button" Next wired to goNext (cannot submit the form).
    expect(source).toContain('onClick={goNext}')
    expect(source).toMatch(/type="button"[\s\S]{0,120}onClick=\{goNext\}/)
    // The review step renders the single type="submit" send button.
    expect(source).toContain('type="submit"')
    expect(source).toContain("t('warranty_claims.portal.submit')")
  })

  it('the claim-create POST lives only inside submitClaim', () => {
    const occurrences = source.split("'/api/warranty_claims/portal/claims'").length - 1
    expect(occurrences).toBe(1)
    const submitClaim = functionBody('submitClaim')
    expect(submitClaim).toContain("'/api/warranty_claims/portal/claims'")
  })
})
