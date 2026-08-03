#!/usr/bin/env node

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import lucideRegistryGenerator from './lucideRegistryGenerator.cjs'

const { checkLucideRegistry, syncLucideRegistry } = lucideRegistryGenerator
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv[2]

try {
  if (command === 'sync') {
    const result = await syncLucideRegistry({ packageDir })
    console.log(`Generated lucide registry with ${result.iconCount} icons -> ${result.outputPath}`)
  } else if (command === 'check') {
    const result = await checkLucideRegistry({ packageDir })
    console.log(`Lucide registry is current (${result.iconCount} icons).`)
  } else {
    throw new Error('Usage: lucideRegistry.mjs <sync|check>')
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
