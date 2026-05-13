#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const args = new Set(process.argv.slice(2))
const shouldFail = args.has('--fail')
const json = args.has('--json')
const maxClientRootLinesArg = process.argv.find((arg) => arg.startsWith('--max-client-root-lines='))
const maxClientRootLines = Number(maxClientRootLinesArg?.split('=')[1] ?? '300')
const appDir = path.join(root, 'apps/mercato/src/app')
const packagesDir = path.join(root, 'packages')
const allowlistPath = path.join(root, '.ai/client-boundary-allowlist.json')

function loadAllowlist() {
  if (!existsSync(allowlistPath)) return new Set()
  const parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  const entries = Array.isArray(parsed) ? parsed : parsed.pageRootUseClient ?? []
  return new Set(entries.map((entry) => normalize(entry)))
}

function normalize(file) {
  return file.split(path.sep).join('/')
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry === 'coverage') continue
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full)
  }
  return out
}

function lineCount(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).length
}

function hasTopLevelUseClient(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/).slice(0, 12)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue
    return line === '"use client"' || line === "'use client'" || line === '"use client";' || line === "'use client';"
  }
  return false
}

function rel(file) {
  return normalize(path.relative(root, file))
}

const allowlist = loadAllowlist()
const files = [...walk(appDir), ...walk(packagesDir)]
const clientFiles = files.filter(hasTopLevelUseClient).map(rel).sort()
const pageRoots = clientFiles.filter((file) => file.endsWith('/page.tsx'))
const backendPageRoots = pageRoots.filter((file) => file.includes('/(backend)/') || file.includes('/backend/'))
const frontendPageRoots = pageRoots.filter((file) => !backendPageRoots.includes(file))
const unallowlistedBackendPageRoots = backendPageRoots.filter((file) => !allowlist.has(file))
const oversizedClientRoots = pageRoots
  .map((file) => ({ file, lines: lineCount(path.join(root, file)) }))
  .filter((entry) => entry.lines > maxClientRootLines)
  .sort((a, b) => b.lines - a.lines)
const heavyLibraries = ['@xyflow/react', 'react-big-calendar', '@uiw/react-md-editor', '@tanstack/react-table']
const heavyImportHits = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const lib of heavyLibraries) {
    if (text.includes(lib)) heavyImportHits.push({ file: rel(file), library: lib })
  }
}

const report = {
  scannedFiles: files.length,
  topLevelUseClientFiles: clientFiles.length,
  pageRootUseClientFiles: pageRoots.length,
  backendPageRootUseClientFiles: backendPageRoots.length,
  frontendPageRootUseClientFiles: frontendPageRoots.length,
  unallowlistedBackendPageRootUseClientFiles: unallowlistedBackendPageRoots.length,
  maxClientRootLines,
  oversizedClientRootFiles: oversizedClientRoots.length,
  allowlistPath: existsSync(allowlistPath) ? '.ai/client-boundary-allowlist.json' : null,
  unallowlistedBackendPageRoots,
  oversizedClientRoots,
  heavyImportHits,
}

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('Open Mercato client-boundary report')
  console.log(`- scanned TS/TSX files: ${report.scannedFiles}`)
  console.log(`- top-level "use client" files: ${report.topLevelUseClientFiles}`)
  console.log(`- page-root "use client" files: ${report.pageRootUseClientFiles}`)
  console.log(`- backend page-root "use client" files: ${report.backendPageRootUseClientFiles}`)
  console.log(`- frontend page-root "use client" files: ${report.frontendPageRootUseClientFiles}`)
  console.log(`- unallowlisted backend page-root "use client" files: ${report.unallowlistedBackendPageRootUseClientFiles}`)
  console.log(`- client page roots over ${maxClientRootLines} LOC: ${report.oversizedClientRootFiles}`)
  console.log(`- heavy browser library import hits: ${report.heavyImportHits.length}`)
  if (oversizedClientRoots.length > 0) {
    console.log('\nLargest client page roots:')
    for (const entry of oversizedClientRoots.slice(0, 20)) console.log(`- ${entry.file} (${entry.lines} LOC)`)
    if (oversizedClientRoots.length > 20) console.log(`- ... ${oversizedClientRoots.length - 20} more`)
  }

  if (unallowlistedBackendPageRoots.length > 0) {
    console.log('\nUnallowlisted backend page roots:')
    for (const file of unallowlistedBackendPageRoots.slice(0, 50)) console.log(`- ${file}`)
    if (unallowlistedBackendPageRoots.length > 50) console.log(`- ... ${unallowlistedBackendPageRoots.length - 50} more`)
  }
}

if (shouldFail && (unallowlistedBackendPageRoots.length > 0 || oversizedClientRoots.length > 0)) {
  process.exitCode = 1
}
