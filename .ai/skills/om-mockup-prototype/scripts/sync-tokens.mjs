#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(SCRIPT_DIR, '..')
const ASSETS_DIR = join(SKILL_DIR, 'references/assets')
const BUNDLED_SNAPSHOT_PATH = join(SKILL_DIR, 'references/ds-tokens.default.json')
const REPO_SNAPSHOT_RELATIVE = '.ai/ds/ds-tokens.json'
const BUNDLED_STYLESHEETS = ['components.css', 'screens.css', 'prototype.css']
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function resolveRepoRoot(workingDirectory = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workingDirectory,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    console.error(
      `Not inside a git checkout; assuming the working directory is the repository root: ${workingDirectory}`,
    )
    return workingDirectory
  }
}

export const REPO_ROOT = resolveRepoRoot()
const PROTOTYPES_ROOT = join(REPO_ROOT, '.ai/prototypes')

export function resolveSnapshot(repoRoot = REPO_ROOT) {
  const repoSnapshot = join(repoRoot, REPO_SNAPSHOT_RELATIVE)
  if (existsSync(repoSnapshot)) return { path: repoSnapshot, source: REPO_SNAPSHOT_RELATIVE }
  return { path: BUNDLED_SNAPSHOT_PATH, source: 'bundled default snapshot (references/ds-tokens.default.json)' }
}

function readSnapshot(snapshotPath) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `Could not read the token snapshot at ${snapshotPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!parsed || typeof parsed.tokens !== 'object' || parsed.tokens === null) {
    throw new Error(`Token snapshot at ${snapshotPath} has no "tokens" object.`)
  }
  return parsed.tokens
}

function tokenDeclarations(tokens) {
  const root = []
  const dark = []
  for (const [name, token] of Object.entries(tokens)) {
    const property = `--${name}`
    const lightValue = token.value !== undefined ? token.value : token.light
    if (lightValue === undefined || lightValue === null) {
      throw new Error(`Token "${name}" in the snapshot carries neither "value" nor "light".`)
    }
    root.push({ name: property, value: String(lightValue) })
    if (!token.themeInvariant && token.dark !== undefined && token.dark !== null) {
      dark.push({ name: property, value: String(token.dark) })
    }
  }
  return { root, dark }
}

function emitDeclarations(declarations, indent = '  ') {
  return declarations.map((declaration) => `${indent}${declaration.name}: ${declaration.value};`).join('\n')
}

export function assertBundledVariablesResolve(generatedCss, assetsDirectory = ASSETS_DIR) {
  const bundledCss = BUNDLED_STYLESHEETS
    .map((filename) => readFileSync(join(assetsDirectory, filename), 'utf8'))
    .join('\n')
  const defined = new Set()
  const definitionPattern = /(--[A-Za-z0-9_-]+)\s*:/g
  for (const css of [generatedCss, bundledCss]) {
    for (const match of css.matchAll(definitionPattern)) defined.add(match[1])
  }

  const unresolved = new Set()
  for (const match of bundledCss.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)([^)]*)\)/g)) {
    const hasFallback = match[2].trimStart().startsWith(',')
    if (!hasFallback && !defined.has(match[1])) unresolved.add(match[1])
  }
  if (unresolved.size) {
    throw new Error(`Bundled styles reference undefined CSS variables: ${Array.from(unresolved).sort().join(', ')}`)
  }
}

export function buildTokens(snapshotPath, assetsDirectory = ASSETS_DIR) {
  const snapshot = snapshotPath ? { path: snapshotPath, source: snapshotPath } : resolveSnapshot()
  const { root, dark } = tokenDeclarations(readSnapshot(snapshot.path))

  const generated = [
    '/* GENERATED — do not edit by hand.',
    ` * Source: ${snapshot.source}`,
    ' * Regenerate with .ai/skills/om-mockup-prototype/scripts/sync-tokens.mjs.',
    ' */',
    '',
    ':root {',
    '  color-scheme: light;',
    emitDeclarations(root),
    '}',
    '',
    '.dark {',
    '  color-scheme: dark;',
    emitDeclarations(dark),
    '}',
    '',
  ].join('\n')
  assertBundledVariablesResolve(generated, assetsDirectory)
  return generated
}

export function parseTokenCss(css) {
  const blocks = {}
  const blockPattern = /(?:^|\n)\s*(:root|\.dark)\s*\{([\s\S]*?)\}/g
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(blockPattern)) {
    const declarations = new Map()
    for (const line of match[2].split(';')) {
      const separator = line.indexOf(':')
      const name = line.slice(0, separator).trim()
      if (name.startsWith('--')) declarations.set(name, line.slice(separator + 1).trim())
    }
    blocks[match[1]] = declarations
  }
  return blocks
}

export function tokensDrift(currentCss, generatedCss) {
  const current = parseTokenCss(currentCss)
  const generated = parseTokenCss(generatedCss)
  const drift = []
  for (const selector of [':root', '.dark']) {
    const currentBlock = current[selector] || new Map()
    const generatedBlock = generated[selector] || new Map()
    for (const [name, value] of generatedBlock) {
      if (!currentBlock.has(name)) drift.push(`${selector} is missing ${name}`)
      else if (currentBlock.get(name) !== value) drift.push(`${selector} ${name} is ${currentBlock.get(name)}, expected ${value}`)
    }
    for (const [name, value] of currentBlock) {
      if (generatedBlock.has(name)) continue
      // A .dark re-declaration matching the generated :root value is a no-op, not drift.
      if (selector === '.dark' && (generated[':root'] || new Map()).get(name) === value) continue
      drift.push(`${selector} carries stale ${name}`)
    }
  }
  return drift
}

export function parseSyncArguments(args) {
  if (args.length === 1 && !args[0].startsWith('--')) return { checkOnly: false, target: args[0] }
  if (args.length === 2 && args[0] === '--check' && !args[1].startsWith('--')) {
    return { checkOnly: true, target: args[1] }
  }
  throw new Error('Usage: sync-tokens.mjs [--check] .ai/prototypes/<prototype-slug>')
}

export function resolvePrototypeTarget(targetArgument, prototypesRoot = PROTOTYPES_ROOT) {
  const target = resolve(targetArgument)
  const targetRelative = relative(prototypesRoot, target)
  if (
    !targetRelative ||
    targetRelative.startsWith('..') ||
    isAbsolute(targetRelative) ||
    targetRelative.includes('/') ||
    targetRelative.includes('\\') ||
    !SLUG_PATTERN.test(targetRelative)
  ) {
    throw new Error('Target must be an immediate .ai/prototypes/<prototype-slug> directory.')
  }
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Prototype directory does not exist: ${targetArgument}`)
  }
  if (lstatSync(target).isSymbolicLink()) {
    throw new Error('Prototype target must not be a symbolic link.')
  }
  const resolvedRoot = realpathSync(prototypesRoot)
  const resolvedTarget = realpathSync(target)
  const resolvedRelative = relative(resolvedRoot, resolvedTarget)
  if (!resolvedRelative || resolvedRelative.startsWith('..') || isAbsolute(resolvedRelative)) {
    throw new Error('Prototype target resolves outside .ai/prototypes.')
  }
  return resolvedTarget
}

function main() {
  try {
    const { checkOnly, target: targetArgument } = parseSyncArguments(process.argv.slice(2))
    const target = resolvePrototypeTarget(targetArgument)
    const outputPath = join(target, 'tokens.css')
    const generated = buildTokens()

    if (checkOnly) {
      const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
      const drift = tokensDrift(current, generated)
      if (drift.length) throw new Error(`tokens.css is out of date: ${outputPath}\n${drift.join('\n')}`)
      console.log('tokens.css is current.')
      return
    }

    writeFileSync(outputPath, generated, 'utf8')
    const count = (generated.match(/^\s+--/gm) || []).length
    console.log(`Wrote ${outputPath} (${count} tokens).`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
