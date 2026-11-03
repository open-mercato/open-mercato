import fs from 'node:fs'
import path from 'node:path'
import { registerCliModules, run } from '../mercato'

const docsRoot = path.resolve(__dirname, '../../../../apps/docs/docs')
const queueCommandPattern = /mercato queue ([a-z][a-z0-9:-]*)/g

function listMdxFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listMdxFiles(entryPath)
    return entry.name.endsWith('.mdx') ? [entryPath] : []
  })
}

function collectDocumentedQueueSubcommands(): Map<string, string[]> {
  const usages = new Map<string, string[]>()
  for (const file of listMdxFiles(docsRoot)) {
    const content = fs.readFileSync(file, 'utf8')
    for (const match of content.matchAll(queueCommandPattern)) {
      const files = usages.get(match[1]) ?? []
      const relativeFile = path.relative(docsRoot, file)
      if (!files.includes(relativeFile)) files.push(relativeFile)
      usages.set(match[1], files)
    }
  }
  return usages
}

describe('documented queue subcommands', () => {
  let consoleLogSpy: jest.SpyInstance
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    registerCliModules([])
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('finds queue commands in the scheduler CLI docs', () => {
    const usages = collectDocumentedQueueSubcommands()
    const schedulerSubcommands = [...usages.entries()]
      .filter(([, files]) => files.includes(path.join('cli', 'scheduler.mdx')))
      .map(([subcommand]) => subcommand)

    expect(schedulerSubcommands).toEqual(expect.arrayContaining(['worker', 'status', 'clear']))
  })

  it('only documents queue subcommands the CLI registers', async () => {
    const unregistered: string[] = []
    for (const [subcommand, files] of collectDocumentedQueueSubcommands()) {
      const exitCode = await run(['node', 'mercato', 'queue', subcommand, '--help'])
      if (exitCode !== 0) unregistered.push(`queue ${subcommand} (${files.join(', ')})`)
    }

    expect(unregistered).toEqual([])
  })
})
