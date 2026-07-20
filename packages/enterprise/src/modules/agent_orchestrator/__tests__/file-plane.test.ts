import { parseAgentMarkdown } from '../lib/sdk/agentMarkdown'
import { extractFileInput, agentFileInputSchema } from '../lib/runtime/fileInput'

describe('file plane — agent frontmatter files opt-in', () => {
  const base = ['---', 'id: demo.file_agent', 'label: Demo', 'description: A demo file agent.']

  it('defaults to NO files config (opt-in, BC)', () => {
    const md = parseAgentMarkdown([...base, '---', 'Body.'].join('\n'))
    expect(md?.files).toBeUndefined()
  })

  it('parses `files: enabled` into an enabled config with inputs+outputs, bash off', () => {
    const md = parseAgentMarkdown([...base, 'files: enabled', '---', 'Body.'].join('\n'))
    expect(md?.files).toEqual({ enabled: true, inputs: true, outputs: true, bash: false })
  })

  it('accepts truthy tokens and opts bash in only when filesBash is set', () => {
    const md = parseAgentMarkdown([...base, 'files: true', 'filesBash: yes', '---', 'Body.'].join('\n'))
    expect(md?.files).toEqual({ enabled: true, inputs: true, outputs: true, bash: true })
  })

  it('treats a non-truthy files value as disabled', () => {
    const md = parseAgentMarkdown([...base, 'files: false', '---', 'Body.'].join('\n'))
    expect(md?.files).toBeUndefined()
  })
})

describe('file plane — __files envelope extraction', () => {
  const attachmentId = '11111111-1111-4111-8111-111111111111'

  it('passes a non-object input through untouched with no envelope', () => {
    expect(extractFileInput('just a prompt')).toEqual({ input: 'just a prompt', files: null })
  })

  it('returns the business input unchanged when no __files key is present', () => {
    const input = { question: 'hi' }
    expect(extractFileInput(input)).toEqual({ input: { question: 'hi' }, files: null })
  })

  it('strips __files and returns the parsed envelope + clean business input', () => {
    const result = extractFileInput({
      question: 'assess this',
      __files: { attachments: [{ attachmentId, ocrText: true }] },
    })
    expect(result.input).toEqual({ question: 'assess this' })
    expect(result.files).toEqual({ attachments: [{ attachmentId, ocrText: true }] })
  })

  it('drops an invalid envelope (bad uuid) to null but keeps the business input', () => {
    const result = extractFileInput({ question: 'x', __files: { attachments: [{ attachmentId: 'not-a-uuid' }] } })
    expect(result.input).toEqual({ question: 'x' })
    expect(result.files).toBeNull()
  })

  it('rejects more than 20 attachments via the schema', () => {
    const many = Array.from({ length: 21 }, () => ({ attachmentId }))
    expect(agentFileInputSchema.safeParse({ attachments: many }).success).toBe(false)
  })
})
