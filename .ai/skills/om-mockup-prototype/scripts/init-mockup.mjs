#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT, buildTokens } from './sync-tokens.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(SCRIPT_DIR, '..')
const ASSETS_DIR = join(SKILL_DIR, 'references/assets')
const PROTOTYPES_ROOT = join(REPO_ROOT, '.ai/prototypes')
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function parseInitArguments(args) {
  if (args.length !== 3 || args[1] !== '--requirements') {
    throw new Error('Usage: init-mockup.mjs <prototype-slug> --requirements <requirements-path.md>')
  }

  const [slug, , requirements] = args
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error('Prototype slug must contain lowercase letters, digits, and single hyphens only.')
  }
  if (!requirements || requirements.startsWith('--')) {
    throw new Error('--requirements must be followed by a path.')
  }
  return { slug, requirements }
}

export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function assertContainedPath(target) {
  const repositoryRoot = realpathSync(REPO_ROOT)
  const prototypesRoot = realpathSync(PROTOTYPES_ROOT)
  const rootRelative = relative(repositoryRoot, prototypesRoot)
  if (!rootRelative || rootRelative.startsWith('..') || isAbsolute(rootRelative)) {
    throw new Error('.ai/prototypes must resolve inside the repository.')
  }
  const targetRelative = relative(PROTOTYPES_ROOT, target)
  if (!targetRelative || targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
    throw new Error('Prototype target must be a direct child of .ai/prototypes.')
  }
}

function renderTemplate(filename, replacements) {
  let content = readFileSync(join(ASSETS_DIR, filename), 'utf8')
  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${placeholder}}}`, value)
  }
  return content
}

export function initializePrototype({ slug, requirements }, options = {}) {
  const tokenBuilder = options.buildTokens || buildTokens
  mkdirSync(PROTOTYPES_ROOT, { recursive: true })
  const target = resolve(PROTOTYPES_ROOT, slug)
  assertContainedPath(target)

  if (existsSync(target)) {
    throw new Error(`Prototype already exists: ${relative(REPO_ROOT, target)}`)
  }

  const staging = mkdtempSync(join(PROTOTYPES_ROOT, `.${slug}-staging-`))
  const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
  const replacements = {
    MODULE: escapeHtml(title),
    REQUIREMENTS: escapeHtml(requirements),
    SLUG: escapeHtml(slug),
  }

  try {
    for (const filename of ['components.css', 'screens.css', 'prototype.css', 'prototype.js', 'theme.css']) {
      copyFileSync(join(ASSETS_DIR, filename), join(staging, filename))
    }
    for (const filename of ['index.html', 'comments.js', 'README.md']) {
      writeFileSync(join(staging, filename), renderTemplate(filename, replacements), 'utf8')
    }
    writeFileSync(join(staging, 'tokens.css'), tokenBuilder(), 'utf8')
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }

  return relative(REPO_ROOT, target)
}

function main() {
  try {
    const result = initializePrototype(parseInitArguments(process.argv.slice(2)))
    console.log(`Prototype ready: ${result}/`)
    console.log('Next: build stable .screen sections using references/screen-patterns.md.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
