/** @jest-environment node */
import { z } from 'zod'
import { documentReviewOutcomeSchema } from '../lib/reviewAgentContract'
import { findingIngestSchema } from '../data/validators'

type JsonSchemaNode = {
  type?: string | string[]
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
  anyOf?: JsonSchemaNode[]
}

function collectStrictViolations(node: JsonSchemaNode | undefined, path: string, out: string[]): void {
  if (!node) return
  if (node.properties) {
    const keys = Object.keys(node.properties)
    const required = new Set(node.required ?? [])
    for (const key of keys) {
      if (!required.has(key)) out.push(`${path}.${key}`)
      collectStrictViolations(node.properties[key], `${path}.${key}`, out)
    }
  }
  if (node.items) collectStrictViolations(node.items, `${path}[]`, out)
  for (const option of node.anyOf ?? []) collectStrictViolations(option, path, out)
}

describe('review agent outcome contract', () => {
  it('marks every property required so strict structured-output providers accept it', () => {
    const schema = z.toJSONSchema(documentReviewOutcomeSchema) as JsonSchemaNode
    const violations: string[] = []
    collectStrictViolations(schema, '$', violations)
    expect(violations).toEqual([])
  })

  it('lets ingest accept an agent outcome with null optional fields', () => {
    const outcome = documentReviewOutcomeSchema.parse({
      kind: 'researcher',
      data: {
        findings: [{
          severity: 'warning',
          title: 'Residuals clause',
          explanation: 'Lets the recipient reuse retained information.',
          ruleCode: null,
          sectionLabel: null,
          quote: 'retained in the unaided memory',
          occurrence: null,
          suggestedText: null,
        }],
        summary: { sectionsChecked: 3, rulesApplied: 2, truncated: false },
      },
    })
    const ingest = findingIngestSchema.parse({ findings: outcome.data.findings })
    expect(ingest.findings[0]).toMatchObject({ occurrence: 1, ruleCode: null, suggestedText: null })
  })
})
