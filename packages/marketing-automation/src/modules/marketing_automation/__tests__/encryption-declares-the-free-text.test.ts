import maps from '../encryption'

/**
 * The module shipped with no `encryption.ts` at all.
 *
 * Defensible for most of its schema — ids, counts, timestamps, enum-shaped strings — and wrong for the two
 * places it holds text it did not write: a survey comment is the customer's own words, and a run's trigger
 * payload is whatever a partner posted to an inbound hook. Core encrypts the equivalent customer comment.
 */
describe('the module encryption declaration', () => {
  it('covers the survey comment', () => {
    const survey = maps.find((map) => map.entityId === 'marketing_automation:marketing_survey_prompt')
    expect(survey?.fields.map((field) => field.field)).toEqual(['comment'])
  })

  it('covers the trigger payload, and by its column name', () => {
    // The declaration is read against the database column, not the entity property.
    const run = maps.find((map) => map.entityId === 'marketing_automation:marketing_campaign_run')
    expect(run?.fields.map((field) => field.field)).toEqual(['trigger_context'])
  })

  /**
   * Encrypting `context` whole is the mistake this shape exists to avoid: the erasure finds a person's runs
   * with `context ->> 'subjectEntityId'`, and ciphertext cannot answer that.
   */
  it('never declares the queryable context column', () => {
    for (const map of maps) {
      expect(map.fields.map((field) => field.field)).not.toContain('context')
    }
  })

  it('names entities by their registered ids, so the maps resolve', () => {
    // A typo here does not fail — it silently encrypts nothing.
    for (const map of maps) {
      expect(map.entityId.startsWith('marketing_automation:')).toBe(true)
    }
  })
})
