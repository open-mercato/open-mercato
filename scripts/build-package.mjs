import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { createAtomicWritePlugin } from './lib/add-js-extension.mjs'

const DEFAULT_IGNORE = ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx']

async function resolveEntryPoints(packageDir, entryPoints, extraIgnore) {
  if (Array.isArray(entryPoints)) return entryPoints
  return glob(entryPoints, {
    cwd: packageDir,
    ignore: [...DEFAULT_IGNORE, ...extraIgnore],
    absolute: true,
  })
}

function clearDirectory(dir) {
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true })
  }
}

async function copyJsonFiles(packageDir, outdir, ignore) {
  const srcRoot = join(packageDir, 'src')
  const jsonFiles = await glob('src/**/*.json', {
    cwd: packageDir,
    ignore: ['**/node_modules/**', ...ignore],
    absolute: true,
  })
  for (const jsonFile of jsonFiles) {
    const destPath = join(outdir, relative(srcRoot, jsonFile))
    mkdirSync(dirname(destPath), { recursive: true })
    copyFileSync(jsonFile, destPath)
  }
}

// Shared package builder. Every packages/*/build.mjs should call this instead of
// inlining its own esbuild + addJsExtension plugin.
//
// Options:
//   name                 — friendly label for console output (default: basename of packageDir)
//   entryPoints          — glob string or absolute path array (default: 'src/**/*.{ts,tsx}')
//   extraIgnore          — extra glob ignore patterns for entry discovery
//   outdir               — output directory relative to packageDir (default: 'dist')
//   outbase              — esbuild outbase relative to packageDir (default: 'src')
//   format/platform/target/jsx/sourcemap/bundle — esbuild passthroughs
//   esbuildOverrides     — raw esbuild options merged last (write is always forced off)
//   extraPlugins         — esbuild plugins prepended before the atomic-write plugin
//   rewriteOptions       — options for createAtomicWritePlugin (skipExtensions, skipTemplateLiterals, resolveGeneratedImport)
//   clearDist            — wipe outdir before building (default: false)
//   copyJson             — copy src/**/*.json to dist after build (default: false)
//   copyJsonIgnore       — extra ignore patterns for JSON copy
//   watch                — use esbuild.context().watch() instead of one-shot build (default: false)
//   beforeBuild({packageDir, outdir})         — optional async hook run before build
//   afterBuild({packageDir, outdir, result})  — optional async hook run after successful build
export async function buildPackage(packageDir, userOptions = {}) {
  const {
    name = basename(packageDir),
    entryPoints = 'src/**/*.{ts,tsx}',
    extraIgnore = [],
    outdir = 'dist',
    outbase = 'src',
    format = 'esm',
    platform = 'node',
    target = 'node18',
    jsx = 'automatic',
    sourcemap = true,
    bundle = false,
    esbuildOverrides = {},
    extraPlugins = [],
    rewriteOptions = {},
    clearDist = false,
    copyJson = false,
    copyJsonIgnore = [],
    watch = false,
    beforeBuild,
    afterBuild,
  } = userOptions

  const resolvedOutdir = join(packageDir, outdir)
  const resolvedOutbase = join(packageDir, outbase)

  if (clearDist) {
    clearDirectory(resolvedOutdir)
  }

  if (typeof beforeBuild === 'function') {
    await beforeBuild({ packageDir, outdir: resolvedOutdir })
  }

  const resolvedEntryPoints = await resolveEntryPoints(packageDir, entryPoints, extraIgnore)
  if (resolvedEntryPoints.length === 0) {
    console.error(`[build:${name}] no entry points found`)
    process.exit(1)
  }
  console.log(`[build:${name}] found ${resolvedEntryPoints.length} entry points`)

  const buildOptions = {
    absWorkingDir: packageDir,
    entryPoints: resolvedEntryPoints,
    outdir: resolvedOutdir,
    outbase: resolvedOutbase,
    format,
    platform,
    target,
    jsx,
    sourcemap,
    bundle,
    ...esbuildOverrides,
    write: false,
    plugins: [...extraPlugins, createAtomicWritePlugin(rewriteOptions)],
  }

  if (watch) {
    const context = await esbuild.context(buildOptions)
    await context.watch()
    console.log(`[build:${name}] watching for changes...`)
    return { context }
  }

  const result = await esbuild.build(buildOptions)
  if (result.errors && result.errors.length > 0) {
    console.error(`[build:${name}] build errors:`, result.errors)
    process.exit(1)
  }

  if (copyJson) {
    await copyJsonFiles(packageDir, resolvedOutdir, copyJsonIgnore)
  }

  if (typeof afterBuild === 'function') {
    await afterBuild({ packageDir, outdir: resolvedOutdir, result })
  }

  console.log(`[build:${name}] built successfully`)
  return { result }
}
