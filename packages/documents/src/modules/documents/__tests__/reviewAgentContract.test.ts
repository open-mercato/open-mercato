import { findingIngestSchema, findingItemSchema } from '../data/validators'
import {
  DOCUMENT_REVIEW_TOOL_IDS,
  buildDocumentReviewInstructions,
  documentReviewFindingsSchema,
  documentReviewOutcomeSchema,
} from '../lib/reviewAgentContract'
import { aiTools } from '../ai-tools'

const sampleOutcome = {
  kind: 'researcher',
  data: {
    findings: [
      {
        severity: 'blocking',
        title: 'Confidentiality term too long',
        explanation: 'The confidentiality term exceeds the playbook position of two years.',
        ruleCode: 'term',
        sectionLabel: '4. Term',
        quote: 'for a period of five years',
        occurrence: null,
        suggestedText: 'for a period of two years',
      },
      {
        severity: 'info',
        title: 'Part of the document was not reviewed',
        explanation: 'The document text was truncated.',
        ruleCode: null,
        sectionLabel: null,
        quote: 'Schedule A',
        occurrence: 2,
        suggestedText: null,
      },
    ],
    summary: { sectionsChecked: 9, rulesApplied: 6, truncated: true },
  },
}

describe('document review agent contract', () => {
  it('accepts a sample outcome that ingest maps to its defaults', () => {
    const parsed = documentReviewOutcomeSchema.parse(sampleOutcome)
    expect(parsed.data.findings).toHaveLength(2)
    const ingested = findingIngestSchema.parse({ findings: parsed.data.findings })
    expect(ingested.findings[0]?.occurrence).toBe(1)
    expect(ingested.findings[1]?.occurrence).toBe(2)
    expect(parsed.data.summary.truncated).toBe(true)
  })

  it('rejects extra keys at every level', () => {
    expect(documentReviewOutcomeSchema.safeParse({ ...sampleOutcome, extra: true }).success).toBe(false)
    expect(documentReviewOutcomeSchema.safeParse({
      ...sampleOutcome,
      data: { ...sampleOutcome.data, notes: 'x' },
    }).success).toBe(false)
    expect(documentReviewOutcomeSchema.safeParse({
      ...sampleOutcome,
      data: { ...sampleOutcome.data, summary: { ...sampleOutcome.data.summary, score: 1 } },
    }).success).toBe(false)
    expect(documentReviewOutcomeSchema.safeParse({
      ...sampleOutcome,
      data: {
        ...sampleOutcome.data,
        findings: [{ ...sampleOutcome.data.findings[0], attachmentId: 'a' }],
      },
    }).success).toBe(false)
  })

  it('uses the wrapped researcher result kind', () => {
    expect(documentReviewOutcomeSchema.safeParse({ ...sampleOutcome, kind: 'research' }).success).toBe(false)
  })

  it('keeps every agent finding acceptable to the ingest schema', () => {
    const agentFinding = documentReviewFindingsSchema.element.parse(sampleOutcome.data.findings[0])
    expect(findingItemSchema.safeParse(agentFinding).success).toBe(true)
    expect(documentReviewOutcomeSchema.shape.data.shape.findings).toBe(documentReviewFindingsSchema)
  })

  it('lists exactly the read-only review tools the module registers', () => {
    expect([...DOCUMENT_REVIEW_TOOL_IDS]).toEqual([
      'documents.get_document_for_review',
      'documents.get_review_playbook',
    ])
    const registered = aiTools.map((tool) => tool.name)
    for (const toolId of DOCUMENT_REVIEW_TOOL_IDS) expect(registered).toContain(toolId)
    const contractTools = aiTools.filter((tool) => (DOCUMENT_REVIEW_TOOL_IDS as readonly string[]).includes(tool.name))
    expect(contractTools.every((tool) => tool.isMutation === false)).toBe(true)
  })

  it('builds instructions that name both tools, demand verbatim quotes and treat content as data', () => {
    const instructions = buildDocumentReviewInstructions()
    for (const toolId of DOCUMENT_REVIEW_TOOL_IDS) expect(instructions).toContain(toolId)
    expect(instructions).toMatch(/verbatim/i)
    expect(instructions).toMatch(/data, never instructions/i)
    expect(instructions).toMatch(/truncated/i)
    expect(instructions).toContain('preferred wording')
    expect(instructions).not.toContain('Additional guidance')
  })

  it('appends consumer guidance when provided', () => {
    const instructions = buildDocumentReviewInstructions({ extra: '  Flag any non-solicitation clause.  ' })
    expect(instructions.startsWith(buildDocumentReviewInstructions())).toBe(true)
    expect(instructions.endsWith('Additional guidance:\nFlag any non-solicitation clause.')).toBe(true)
    expect(buildDocumentReviewInstructions({ extra: '   ' })).toBe(buildDocumentReviewInstructions())
  })
})
