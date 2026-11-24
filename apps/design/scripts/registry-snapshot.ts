import fs from 'node:fs'
import path from 'node:path'
import uiPackage from '../../../packages/ui/package.json'
import { projectBlockContract, type PublicBlock } from '../src/lib/public-block'
import { entryHref, publicSourceUrl } from '../src/lib/links'
import { galleryFamilies } from '../../../packages/core/src/modules/design_system/gallery/registry'
import { groupForFamily } from '../src/lib/groups'
import { buildLlmsTxt } from '../src/lib/llms'
import type { ManifestEntry, RegistryManifest } from '../src/lib/manifest-types'
import designEnglish from '../src/i18n/en.json'

const appRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appRoot, '../..')
const GALLERY_ENTRIES_DIR = 'packages/core/src/modules/design_system/gallery/entries'
const SOURCE_EXTENSIONS = ['.tsx', '.ts', '/index.tsx', '/index.ts']

function sourceFileForImport(importPath: string): string | undefined {
  if (/^(apps|packages)\//.test(importPath)) {
    return fs.existsSync(path.join(repoRoot, importPath)) ? importPath : undefined
  }
  if (!importPath.startsWith('@open-mercato/')) return undefined
  const [, packageName, ...parts] = importPath.split('/')
  if (!packageName) return undefined
  const base = path.posix.join('packages', packageName, 'src', ...parts)
  for (const suffix of SOURCE_EXTENSIONS) {
    const candidate = `${base}${suffix}`
    const absolute = path.join(repoRoot, candidate)
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return candidate
  }
  return undefined
}

export async function run(): Promise<void> {
  const entries: ManifestEntry[] = []
  const blocks: PublicBlock[] = []
  const publicSourcePaths = new Set<string>()
  for (const family of galleryFamilies) {
    const loaded = await family.load()
    for (const entry of loaded.entries) {
      const galleryFile = `${GALLERY_ENTRIES_DIR}/${family.id}.tsx`
      const sourceFile = sourceFileForImport(entry.contract?.implementationPath ?? entry.importPath)
      let contract: ManifestEntry['contract']
      if (family.id === 'blocks' && !entry.contract) {
        throw new Error(`[internal] Missing block contract for ${entry.id}`)
      }
      const variants = entry.variants.map(({ id, title, code }) => ({ id, title, code }))
      if (entry.contract) {
        const file = sourceFileForImport(entry.contract.importPath)
        if (!file) throw new Error(`[internal] Cannot locate contract: ${entry.contract.importPath}`)
        const { rows, propsSchema } = projectBlockContract(entry.contract.schema)
        contract = { file, rows }
        if (family.id === 'blocks') {
          if (!sourceFile) throw new Error(`[internal] Cannot locate block implementation: ${entry.id}`)
          for (const relativePath of [sourceFile, file, galleryFile]) publicSourcePaths.add(relativePath)
          blocks.push({
            id: entry.id,
            title: entry.title,
            importPath: entry.importPath,
            docs: entryHref('blocks', entry.id),
            propsSchema,
            scenarios: variants,
            sources: {
              component: publicSourceUrl(sourceFile),
              contract: publicSourceUrl(file),
              gallery: publicSourceUrl(galleryFile),
            },
          })
        }
      }
      entries.push({
        id: entry.id,
        title: entry.title,
        family: family.id,
        familyLabelKey: family.labelKey,
        group: groupForFamily(family.id),
        importPath: entry.importPath,
        ...(entry.descriptionKey ? { descriptionKey: entry.descriptionKey } : {}),
        keywords: entry.keywords ?? [],
        ...(entry.usage ? { usage: entry.usage } : {}),
        galleryFile,
        ...(sourceFile ? { sourceFile } : {}),
        ...(contract ? { contract } : {}),
        variants,
      })
    }
  }

  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`[internal] Duplicate gallery entry id: ${entry.id}`)
    seen.add(entry.id)
  }

  const manifest: RegistryManifest = { generatedAt: new Date().toISOString(), entries }
  const generatedDir = path.join(appRoot, 'src', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.writeFileSync(path.join(generatedDir, 'registry-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const llms = buildLlmsTxt(
    entries,
    {
      title: designEnglish['design.meta.siteName'],
      summary: designEnglish['design.meta.llmsSummary'],
      groupLabels: {
        foundations: designEnglish['design.nav.foundations'],
        components: designEnglish['design.nav.components'],
        blocks: designEnglish['design.nav.blocks'],
      },
    },
    process.env.DESIGN_SITE_URL ?? '',
  )
  fs.mkdirSync(path.join(appRoot, 'public'), { recursive: true })
  fs.writeFileSync(path.join(appRoot, 'public', 'llms.txt'), llms)

  const registryDir = path.join(appRoot, 'public', 'r')
  fs.mkdirSync(registryDir, { recursive: true })
  for (const file of publicSourcePaths) {
    const target = path.join(appRoot, 'public', publicSourceUrl(file))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, file), target)
  }
  const version = { version: 1, packageName: uiPackage.name, packageVersion: uiPackage.version }
  const index = blocks.map(({ id, title, importPath, docs }) => ({
    id, title, importPath, docs, url: `/r/${id}.json`,
  }))
  const activeFiles = new Set(['index.json', ...blocks.map(({ id }) => `${id}.json`)])
  for (const file of fs.readdirSync(registryDir)) {
    if (file.endsWith('.json') && !activeFiles.has(file)) fs.unlinkSync(path.join(registryDir, file))
  }
  for (const block of blocks) {
    fs.writeFileSync(path.join(registryDir, `${block.id}.json`), JSON.stringify({ ...version, ...block }, null, 2) + '\n')
  }
  fs.writeFileSync(path.join(registryDir, 'index.json'), JSON.stringify({ ...version, blocks: index }, null, 2) + '\n')

  const counts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.group] = (acc[entry.group] ?? 0) + 1
    return acc
  }, {})
  process.stdout.write(
    `[design] registry manifest: ${entries.length} entries, ${entries.reduce((sum, entry) => sum + entry.variants.length, 0)} variants (${Object.entries(counts).map(([group, count]) => `${group} ${count}`).join(', ')})\n`,
  )
}
