import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import generatorPlugins from '../generators'
import { getAttachmentAccessRegistry, registerAttachmentAccessResolvers } from '../lib/access-registry'

const plugin = generatorPlugins[0]

const entryType = `type Entry = {
  moduleId: string
  resolvers: readonly unknown[]
  protectedTargets?: readonly unknown[]
  enforcesOwnerAccessOnDirectReads?: boolean
}`

function compile(conventionSource: string): { diagnostics: string[]; entry: unknown } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-access-generator-'))
  try {
    fs.writeFileSync(path.join(dir, 'convention.ts'), conventionSource)
    fs.writeFileSync(path.join(dir, 'generated.ts'), [
      "import * as ATTACHMENT_ACCESS_0 from './convention'",
      entryType,
      `export const entry: Entry = ${plugin.configExpr('ATTACHMENT_ACCESS_0', 'agent_orchestrator')}`,
    ].join('\n'))
    const options: ts.CompilerOptions = {
      strict: true, noEmit: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, skipLibCheck: true,
    }
    const program = ts.createProgram([path.join(dir, 'generated.ts')], options)
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    const convention: Record<string, unknown> = {}
    new Function('exports', ts.transpile(conventionSource, { module: ts.ModuleKind.CommonJS }))(convention)
    const evaluated = ts.transpile(`const entry = ${plugin.configExpr('ATTACHMENT_ACCESS_0', 'agent_orchestrator')}`)
    const entry = new Function('ATTACHMENT_ACCESS_0', `${evaluated}\nreturn entry`)(convention)
    return { diagnostics, entry }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('attachments access generator plugin', () => {
  it('typechecks and registers empty lists for a convention file that exports only the declaration', () => {
    const { diagnostics, entry } = compile('export const enforcesOwnerAccessOnDirectReads = true\n')
    expect(diagnostics).toEqual([])
    expect(entry).toEqual({ moduleId: 'agent_orchestrator', resolvers: [], protectedTargets: [], enforcesOwnerAccessOnDirectReads: true })
  })

  it('registers false for a module that does not export the declaration', () => {
    const { diagnostics, entry } = compile(
      "export const attachmentAccessResolvers = [{ id: 'agent_orchestrator.files' }]\nexport const protectedAttachmentTargets = []\n",
    )
    expect(diagnostics).toEqual([])
    expect(entry).toEqual({
      moduleId: 'agent_orchestrator',
      resolvers: [{ id: 'agent_orchestrator.files' }],
      protectedTargets: [],
      enforcesOwnerAccessOnDirectReads: false,
    })
  })

  it('keeps a malformed resolver list so the registry fails closed', () => {
    const { entry } = compile("export const attachmentAccessResolvers = { id: 'agent_orchestrator.files' }\n")
    expect(entry).toMatchObject({ resolvers: { id: 'agent_orchestrator.files' } })
    expect(() => registerAttachmentAccessResolvers([entry as never])).toThrow()
    expect(getAttachmentAccessRegistry().invalid).toBe(true)
  })

  it('keeps malformed protected targets so the registry fails closed', () => {
    const { entry } = compile("export const protectedAttachmentTargets = { resolverId: 'agent_orchestrator.files' }\n")
    expect(() => registerAttachmentAccessResolvers([entry as never])).toThrow()
    expect(getAttachmentAccessRegistry().invalid).toBe(true)
  })

  it('does not treat a non-boolean declaration as enforcement', () => {
    const { entry } = compile("export const enforcesOwnerAccessOnDirectReads = 'yes'\n")
    expect(entry).toMatchObject({ enforcesOwnerAccessOnDirectReads: false })
  })
})
