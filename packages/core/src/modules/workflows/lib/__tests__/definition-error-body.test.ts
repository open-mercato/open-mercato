import { z } from 'zod'
import { normalizeDefinitionValidationIssues } from '../definition-error-body'
import { formatWorkflowValidationError } from '../format-validation-error'

function failParse(schema: z.ZodTypeAny, value: unknown): z.ZodError {
  const result = schema.safeParse(value)
  if (result.success) throw new Error('[internal] expected parse to fail')
  return result.error
}

describe('normalizeDefinitionValidationIssues', () => {
  test('invalid_type issue carries code, expected, and got', () => {
    const schema = z.object({ definition: z.object({ steps: z.array(z.object({ id: z.string() })) }) })
    const error = failParse(schema, { definition: 'not-an-object' })

    const details = normalizeDefinitionValidationIssues(error)

    expect(details).toHaveLength(1)
    expect(details[0]).toMatchObject({
      path: ['definition'],
      code: 'invalid_type',
      expected: 'object',
      got: 'string',
    })
    expect(typeof details[0].message).toBe('string')
    expect(details[0].message.length).toBeGreaterThan(0)
  })

  test('preserves path and message verbatim from the zod issue', () => {
    const schema = z.object({ steps: z.array(z.object({ name: z.string() })) })
    const error = failParse(schema, { steps: [{ name: 7 }] })

    const details = normalizeDefinitionValidationIssues(error)

    expect(details[0].path).toEqual(error.issues[0].path)
    expect(details[0].message).toBe(error.issues[0].message)
  })

  test('custom superRefine issue keeps its message with code custom and no expected/got', () => {
    const schema = z
      .object({ steps: z.array(z.object({ type: z.string() })) })
      .superRefine((value, ctx) => {
        if (!value.steps.some((step) => step.type === 'START')) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps'],
            message: 'Workflow must have at least START and END steps',
          })
        }
      })
    const error = failParse(schema, { steps: [{ type: 'END' }] })

    const details = normalizeDefinitionValidationIssues(error)

    expect(details[0]).toEqual({
      path: ['steps'],
      code: 'custom',
      message: 'Workflow must have at least START and END steps',
    })
  })

  test('enum issue reports allowed values as expected', () => {
    const schema = z.object({ trigger: z.enum(['auto', 'manual']) })
    const error = failParse(schema, { trigger: 'other' })

    const details = normalizeDefinitionValidationIssues(error)

    expect(details[0].path).toEqual(['trigger'])
    expect(details[0].expected).toBe('"auto" | "manual"')
    expect(details[0].got).toBeUndefined()
  })

  test('formatWorkflowValidationError renders the first normalized issue', () => {
    const schema = z.object({ definition: z.object({ steps: z.array(z.unknown()) }) })
    const error = failParse(schema, { definition: { steps: 'nope' } })

    const body = { error: 'Validation failed', details: normalizeDefinitionValidationIssues(error) }

    expect(formatWorkflowValidationError(body, 'fallback')).toBe(
      `definition.steps - ${error.issues[0].message}`,
    )
  })
})
