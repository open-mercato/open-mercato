#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const LESSON_AREAS = new Set([
  'architecture',
  'module-data',
  'umes',
  'backend-ui',
  'integration',
  'ai-workflow',
  'debugging',
  'testing',
  'framework-context',
  'spec-pr',
])

// Raised from 30 KiB when the catalog legitimately reached 119 records and overran the
// old cap by 5 bytes. The budget exists to keep the index cheap to load in full, not to
// cap how many lessons the repo may accumulate — trimming real rows to fit would defeat
// the routing the catalog exists to provide.
const INDEX_MAX_BYTES = 32 * 1024
const RECORD_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const MODULE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
const TOPIC_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const INDEX_ROW_PATTERN = /^- \[(.+)]\(lessons\/([a-z0-9-]+\.md)\) — area:([^;]+); module:([^;]+); topic:(.+)$/

function parseFrontMatter(source, relativePath, errors) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n\n# (.+)\n/)
  if (!match) {
    errors.push(`${relativePath}: expected JSON-valued front matter followed by one H1`)
    return null
  }

  const metadata = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) {
      errors.push(`${relativePath}: malformed front matter line ${JSON.stringify(line)}`)
      continue
    }
    const key = line.slice(0, separator)
    try {
      metadata[key] = JSON.parse(line.slice(separator + 1).trim())
    } catch {
      errors.push(`${relativePath}: ${key} must use valid JSON syntax`)
    }
  }

  const expectedKeys = ['title', 'modules', 'areas', 'topics']
  const actualKeys = Object.keys(metadata).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    errors.push(`${relativePath}: front matter keys must be exactly ${expectedKeys.join(', ')}`)
  }
  if (typeof metadata.title !== 'string' || metadata.title.length === 0) {
    errors.push(`${relativePath}: title must be a non-empty string`)
  } else if (metadata.title !== match[2]) {
    errors.push(`${relativePath}: front matter title must match the H1`)
  }

  for (const key of ['modules', 'areas', 'topics']) {
    if (!Array.isArray(metadata[key])) errors.push(`${relativePath}: ${key} must be an array`)
  }
  if (!Array.isArray(metadata.modules) || metadata.modules.length === 0) {
    errors.push(`${relativePath}: modules must contain an owning module/package or platform`)
  } else if (metadata.modules.some((value) => typeof value !== 'string' || !MODULE_PATTERN.test(value))) {
    errors.push(`${relativePath}: modules must use lowercase snake_case tags`)
  }
  if (!Array.isArray(metadata.areas) || metadata.areas.length === 0) {
    errors.push(`${relativePath}: areas must contain at least one standalone router area`)
  } else if (metadata.areas.some((value) => !LESSON_AREAS.has(value))) {
    errors.push(`${relativePath}: areas contain a value outside the standalone router taxonomy`)
  }
  if (!Array.isArray(metadata.topics) || metadata.topics.length < 2 || metadata.topics.length > 6) {
    errors.push(`${relativePath}: topics must contain between two and six important concepts`)
  } else if (metadata.topics.some((value) => typeof value !== 'string' || !TOPIC_PATTERN.test(value))) {
    errors.push(`${relativePath}: topics must use lowercase kebab-case tags`)
  }

  for (const key of ['modules', 'areas', 'topics']) {
    if (Array.isArray(metadata[key]) && new Set(metadata[key]).size !== metadata[key].length) {
      errors.push(`${relativePath}: ${key} must not contain duplicates`)
    }
  }

  return metadata
}

export function checkLessonsCatalog(rootDir) {
  const errors = []
  const indexPath = path.join(rootDir, '.ai', 'lessons.md')
  const lessonsDir = path.join(rootDir, '.ai', 'lessons')
  if (!fs.existsSync(indexPath)) return [`${indexPath}: lesson index is missing`]

  const indexSource = fs.readFileSync(indexPath, 'utf8')
  const indexBytes = Buffer.byteLength(indexSource)
  if (indexBytes > INDEX_MAX_BYTES) {
    errors.push(`.ai/lessons.md: ${indexBytes} bytes exceeds the ${INDEX_MAX_BYTES}-byte progressive-loading budget`)
  }
  if (/\*\*(?:Context|Problem|Rule|Applies to)\*\*:/.test(indexSource)) {
    errors.push('.ai/lessons.md: full lesson prose belongs in .ai/lessons/, not the catalog')
  }

  const recordNames = fs.existsSync(lessonsDir)
    ? fs.readdirSync(lessonsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
      .sort()
    : []
  const records = new Map()
  const titles = new Set()
  for (const fileName of recordNames) {
    const relativePath = `.ai/lessons/${fileName}`
    if (!RECORD_NAME_PATTERN.test(fileName)) errors.push(`${relativePath}: filename must use kebab-case`)
    const metadata = parseFrontMatter(fs.readFileSync(path.join(lessonsDir, fileName), 'utf8'), relativePath, errors)
    if (!metadata) continue
    if (titles.has(metadata.title)) errors.push(`${relativePath}: duplicate lesson title ${JSON.stringify(metadata.title)}`)
    titles.add(metadata.title)
    records.set(fileName, metadata)
  }

  const indexed = new Set()
  for (const line of indexSource.split('\n')) {
    if (!line.startsWith('- [')) continue
    const match = line.match(INDEX_ROW_PATTERN)
    if (!match) {
      errors.push(`.ai/lessons.md: malformed catalog row ${JSON.stringify(line)}`)
      continue
    }
    const [, title, fileName, areaText, moduleText, topicText] = match
    if (indexed.has(fileName)) errors.push(`.ai/lessons.md: duplicate link to lessons/${fileName}`)
    indexed.add(fileName)
    const metadata = records.get(fileName)
    if (!metadata) {
      errors.push(`.ai/lessons.md: lessons/${fileName} does not exist`)
      continue
    }
    const indexedMetadata = {
      title,
      areas: areaText.split(','),
      modules: moduleText.split(','),
      topics: topicText.split(','),
    }
    for (const key of ['title', 'areas', 'modules', 'topics']) {
      if (JSON.stringify(indexedMetadata[key]) !== JSON.stringify(metadata[key])) {
        errors.push(`.ai/lessons.md: ${key} drift for lessons/${fileName}`)
      }
    }
  }

  for (const fileName of records.keys()) {
    if (!indexed.has(fileName)) errors.push(`.ai/lessons/${fileName}: record is missing from the catalog`)
  }
  const declaredCount = indexSource.match(/catalog indexes (\d+) focused lessons/)
  if (!declaredCount || Number(declaredCount[1]) !== records.size) {
    errors.push(`.ai/lessons.md: declared lesson count must equal ${records.size}`)
  }

  return errors
}

function parseRoot(args) {
  if (args.length === 0) return process.cwd()
  if (args.length === 2 && args[0] === '--root') return path.resolve(args[1])
  throw new Error('Usage: check-lessons.mjs [--root <app-root>]')
}

export function main(args = process.argv.slice(2)) {
  const rootDir = parseRoot(args)
  const errors = checkLessonsCatalog(rootDir)
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  console.log(`Lessons catalog is valid: ${rootDir}`)
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) main()
