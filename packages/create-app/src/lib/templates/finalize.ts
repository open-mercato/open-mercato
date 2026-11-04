import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import { printable, printableText } from '../catalog/fetch-catalog.js'
import { toEnvKey } from './fetch-templates.js'
import type { TemplateEnvKey } from './types.js'

export const TEMPLATE_MANIFEST_FILE = 'mercato-template.json'
export const TEMPLATE_MANIFEST_MAX_BYTES = 256 * 1024
export const PROVENANCE_FIELD = 'openMercatoTemplate'

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** What the CLI takes from `mercato-template.json`: `schema` 1, `env` and `openMercato`. Unknown fields are ignored. */
export type TemplateManifest =
  | { status: 'absent' }
  | { status: 'ok'; env: TemplateEnvKey[]; openMercato: string | null }
  | { status: 'invalid'; reason: string }

/** `{repo, ref, sha}` written to the created app's `package.json` (umbrella "Provenance in created apps"). */
export type TemplateProvenance = { repo: string; ref: string; sha: string }

function toManifestEnv(value: unknown): TemplateEnvKey[] {
  if (!Array.isArray(value)) return []
  const keys: TemplateEnvKey[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const key = toEnvKey(printable(item))
    if (!key || !ENV_NAME.test(key.name) || seen.has(key.name)) continue
    seen.add(key.name)
    keys.push(key)
  }
  return keys
}

/** Reads the root `mercato-template.json` (at most 256 KiB) without changing it. */
export function readTemplateManifest(appDir: string): TemplateManifest {
  const path = join(appDir, TEMPLATE_MANIFEST_FILE)
  if (!existsSync(path)) return { status: 'absent' }
  const stat = lstatSync(path)
  if (!stat.isFile()) return { status: 'invalid', reason: 'it is not a regular file' }
  if (stat.size > TEMPLATE_MANIFEST_MAX_BYTES) return { status: 'invalid', reason: 'it is larger than 256 KiB' }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  } catch {
    return { status: 'invalid', reason: 'it is not valid JSON' }
  }
  if (!isRecord(parsed)) return { status: 'invalid', reason: 'it is not a JSON object' }
  if (parsed.schema !== 1) {
    const schema = typeof parsed.schema === 'number' ? String(parsed.schema) : 'missing'
    return { status: 'invalid', reason: `its schema (${printableText(schema)}) is not 1` }
  }
  const openMercato = typeof parsed.openMercato === 'string' && parsed.openMercato.trim() !== ''
    ? printableText(parsed.openMercato)
    : null
  return { status: 'ok', env: toManifestEnv(parsed.env), openMercato }
}

type JsonLayout = { indent: string | number; eol: string; trailingNewline: boolean; bom: boolean }

function detectLayout(raw: string): JsonLayout {
  const body = raw.replace(/^﻿/, '')
  const indentMatch = /^\{\r?\n([ \t]+)\S/.exec(body)
  const multiline = /\n/.test(body.trim())
  return {
    indent: indentMatch ? indentMatch[1] : multiline ? 2 : 0,
    eol: body.includes('\r\n') ? '\r\n' : '\n',
    trailingNewline: /\n$/.test(body),
    bom: raw.startsWith('﻿'),
  }
}

function formatJson(value: unknown, layout: JsonLayout): string {
  let text = JSON.stringify(value, null, layout.indent)
  if (layout.eol !== '\n') text = text.replace(/\n/g, layout.eol)
  return `${layout.bom ? '﻿' : ''}${text}${layout.trailingNewline ? layout.eol : ''}`
}

export type FinalizeTemplateOptions = {
  appName: string
  keepName: boolean
  provenance: TemplateProvenance
}

export type FinalizeTemplateResult = {
  manifest: TemplateManifest
  /** Notices to print, for example about a manifest that could not be read. */
  notices: string[]
}

/**
 * The three `--template` edits (Ready Apps amendments A-2 and A-3), nothing else: reads and removes
 * `mercato-template.json`, rewrites the root `package.json` `name` unless `keepName`, and adds the
 * `openMercatoTemplate` provenance field as its last key. Indentation, line endings and key order are kept.
 * A missing or unparsable `package.json` fails the import.
 */
export function finalizeTemplateApp(appDir: string, options: FinalizeTemplateOptions): FinalizeTemplateResult {
  const notices: string[] = []
  const manifest = readTemplateManifest(appDir)
  if (manifest.status !== 'absent') {
    rmSync(join(appDir, TEMPLATE_MANIFEST_FILE), { force: true })
  }
  if (manifest.status === 'invalid') {
    notices.push(`${TEMPLATE_MANIFEST_FILE} was not read because ${manifest.reason}. It was removed, so no declared env keys are shown.`)
  }

  const packageJsonPath = join(appDir, 'package.json')
  if (!existsSync(packageJsonPath) || !lstatSync(packageJsonPath).isFile()) {
    throw new Error('The app template has no package.json at its root, so it is not a standalone Open Mercato app.')
  }
  const raw = readFileSync(packageJsonPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ''))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`The package.json of the app template is not valid JSON (${detail}).`)
  }
  if (!isRecord(parsed)) {
    throw new Error('The package.json of the app template is not a JSON object.')
  }

  let pkg: Record<string, unknown> = parsed
  if (!options.keepName) {
    pkg = Object.hasOwn(pkg, 'name') ? Object.assign(pkg, { name: options.appName }) : { name: options.appName, ...pkg }
  }
  // A template created from another template carries that provenance; the new app records only its own source.
  delete pkg[PROVENANCE_FIELD]
  pkg[PROVENANCE_FIELD] = { repo: options.provenance.repo, ref: options.provenance.ref, sha: options.provenance.sha }

  writeFileSync(packageJsonPath, formatJson(pkg, detectLayout(raw)))
  return { manifest, notices }
}

function safeLink(link: string | undefined): string | null {
  if (!link) return null
  try {
    const url = new URL(link)
    return url.protocol === 'https:' || url.protocol === 'http:' ? link : null
  } catch {
    return null
  }
}

export type TemplateNextStepsInput = {
  appName: string
  /** Whether the created app has a root `.env.example`. */
  hasEnvExample: boolean
  /** Env keys the manifest declares. */
  envKeys: TemplateEnvKey[]
  provenance: TemplateProvenance
}

/** Next steps for an app created with `--template`: `cp .env.example .env` and the declared env keys when present. */
export function printTemplateImportNextSteps(input: TemplateNextStepsInput, log: (line: string) => void = console.log): void {
  log('Next steps:')
  log('')
  log(pc.cyan(`  cd ${input.appName}`))
  if (input.hasEnvExample) log(pc.cyan('  cp .env.example .env'))
  if (input.envKeys.length > 0) {
    const width = Math.max(...input.envKeys.map((key) => key.name.length))
    log(pc.dim(`  # Fill in the keys this template declares${input.hasEnvExample ? '' : ' in .env'}:`))
    for (const key of input.envKeys) {
      const parts = [key.name.padEnd(width), key.description.trim(), safeLink(key.link)].filter((part) => part)
      log(pc.dim(`  #   ${parts.join('  ').trimEnd()}`))
    }
  }
  log(pc.cyan('  yarn install'))
  log(pc.cyan('  yarn initialize'))
  log(pc.cyan('  yarn dev'))
  log('')
  log(pc.dim(`Created from the app template ${input.provenance.repo}@${input.provenance.sha} (recorded in package.json "${PROVENANCE_FIELD}").`))
  log(pc.dim('If you want agentic tooling in the app later, run `yarn mercato agentic:init` inside it.'))
  log('')
}
