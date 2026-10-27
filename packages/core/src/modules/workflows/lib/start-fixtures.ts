/**
 * Workflows Module — Start fixtures (spec section 8.1)
 *
 * *"fixtures (named start contexts — "happy path", "missing phone")"*.
 *
 * Fixtures are deliberately a DIFFERENT thing from pinned samples (section 3.6),
 * and the spec says so: a sample is per-STEP data feeding previews and the
 * ledger, a fixture is a whole START context. Conflating them would make "which
 * one wins" a question with no answer. They share a home
 * (`metadata.editor.*`) and a cap discipline, nothing else.
 *
 * Like samples, fixture data is stored VERBATIM and is neither redacted nor
 * encrypted — keep the warning copy wherever a fixture is saved.
 *
 * PURE: no ORM, no DI, no React.
 */

export const WORKFLOW_START_FIXTURES_MAX_CHARS = 65536
export const WORKFLOW_START_FIXTURE_NAME_MAX = 80
export const WORKFLOW_START_FIXTURES_MAX_COUNT = 25

export type WorkflowStartFixture = {
  name: string
  savedAt: string
  context: Record<string, unknown>
}

export type WorkflowStartFixtures = Record<string, WorkflowStartFixture>

export type FixtureWriteResult =
  | { ok: true; fixtures: WorkflowStartFixtures }
  | { ok: false; reason: 'emptyName' | 'nameTooLong' | 'tooMany' | 'tooLarge' }

function normalizeName(name: string): string {
  return name.trim()
}

/**
 * Add or replace a fixture.
 *
 * Every limit is checked against the RESULT, not the input, so replacing an
 * existing fixture with a smaller one always succeeds even when the collection
 * is already at its cap — the alternative would strand an author who is trying
 * to shrink their way back under it.
 */
export function upsertStartFixture(
  fixtures: WorkflowStartFixtures | null | undefined,
  name: string,
  context: Record<string, unknown>,
  savedAt: string,
): FixtureWriteResult {
  const trimmed = normalizeName(name)
  if (!trimmed) return { ok: false, reason: 'emptyName' }
  if (trimmed.length > WORKFLOW_START_FIXTURE_NAME_MAX) return { ok: false, reason: 'nameTooLong' }

  const next: WorkflowStartFixtures = { ...(fixtures ?? {}) }
  const isNew = !(trimmed in next)
  if (isNew && Object.keys(next).length >= WORKFLOW_START_FIXTURES_MAX_COUNT) {
    return { ok: false, reason: 'tooMany' }
  }

  next[trimmed] = { name: trimmed, savedAt, context }

  if (JSON.stringify(next).length > WORKFLOW_START_FIXTURES_MAX_CHARS) {
    return { ok: false, reason: 'tooLarge' }
  }

  return { ok: true, fixtures: next }
}

export function removeStartFixture(
  fixtures: WorkflowStartFixtures | null | undefined,
  name: string,
): WorkflowStartFixtures {
  const next: WorkflowStartFixtures = { ...(fixtures ?? {}) }
  delete next[normalizeName(name)]
  return next
}

/**
 * List fixtures for display, newest save first, name as the stable tiebreaker
 * (never a bare `.sort()` — an unordered picker reshuffles under the author's
 * cursor between renders).
 */
export function listStartFixtures(
  fixtures: WorkflowStartFixtures | null | undefined,
): WorkflowStartFixture[] {
  const entries = Object.values(fixtures ?? {})
  return [...entries].sort((left, right) => {
    if (left.savedAt !== right.savedAt) return left.savedAt < right.savedAt ? 1 : -1
    return left.name.localeCompare(right.name)
  })
}
