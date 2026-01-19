import type { Resolver } from './resolver.js'
import { watch } from 'chokidar'
import path from 'node:path'

interface GenerateWatcherOptions {
  resolver: Resolver
  quiet?: boolean
}

export async function startGenerateWatcher(options: GenerateWatcherOptions): Promise<() => void> {
  const { resolver, quiet = false } = options

  const {
    generateEntityIds,
    generateModuleRegistry,
    generateModuleRegistryCli,
    generateModuleEntities,
    generateModuleDi,
  } = await import('./generators/index.js')

  const appDir = resolver.getAppDir()
  const rootDir = resolver.getRootDir()
  const packagesDir = path.join(rootDir, 'packages')

  // Debounce configuration
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pendingChanges = new Set<string>()
  const DEBOUNCE_MS = 300

  const log = (msg: string) => {
    if (!quiet) {
      console.log(`[generate-watcher] ${msg}`)
    }
  }

  // Determine which generators need to run based on changed files
  const runGenerators = async (changedFiles: Set<string>) => {
    const files = Array.from(changedFiles)
    log(`Detected changes in ${files.length} file(s), regenerating...`)

    const needEntityIds = files.some(
      (f) =>
        f.includes('/data/entities.ts') ||
        f.includes('/data/entities.override.ts') ||
        f.includes('/ce.ts')
    )

    const needModuleRegistry = files.some(
      (f) =>
        f.includes('/frontend/') ||
        f.includes('/backend/') ||
        f.includes('/api/') ||
        f.includes('/modules.ts')
    )

    const needModuleEntities = files.some(
      (f) =>
        f.includes('/data/entities.ts') ||
        f.includes('/data/entities.override.ts')
    )

    const needModuleDi = files.some((f) => f.includes('/di.ts'))

    try {
      // Run all generators when structure changes are detected
      // Since checksums handle efficiency, running all is simpler
      if (needEntityIds || needModuleEntities) {
        await generateEntityIds({ resolver, quiet: true })
        log('Entity IDs regenerated')
      }

      if (needModuleRegistry) {
        await generateModuleRegistry({ resolver, quiet: true })
        await generateModuleRegistryCli({ resolver, quiet: true })
        log('Module registry regenerated')
      }

      if (needModuleEntities) {
        await generateModuleEntities({ resolver, quiet: true })
        log('Module entities regenerated')
      }

      if (needModuleDi) {
        await generateModuleDi({ resolver, quiet: true })
        log('Module DI regenerated')
      }

      log('Generation complete')
    } catch (error) {
      console.error('[generate-watcher] Generation failed:', error)
    }
  }

  const scheduleGeneration = (filePath: string) => {
    pendingChanges.add(filePath)

    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(async () => {
      const changes = pendingChanges
      pendingChanges = new Set()
      debounceTimer = null
      await runGenerators(changes)
    }, DEBOUNCE_MS)
  }

  // Watch patterns for entity changes (content-based triggers)
  const entityPatterns = [
    path.join(packagesDir, '*/src/modules/*/data/entities.ts'),
    path.join(packagesDir, '*/src/modules/*/data/entities.override.ts'),
    path.join(appDir, 'src/modules/*/data/entities.ts'),
    path.join(appDir, 'src/modules/*/ce.ts'),
  ]

  // Watch patterns for module structure changes
  const moduleStructurePatterns = [
    path.join(packagesDir, '*/src/modules/*/{frontend,backend,api}/**/*.{ts,tsx}'),
    path.join(appDir, 'src/modules/*/{frontend,backend,api}/**/*.{ts,tsx}'),
    path.join(appDir, 'src/modules.ts'),
  ]

  // Watch patterns for DI changes
  const diPatterns = [
    path.join(packagesDir, '*/src/modules/*/di.ts'),
    path.join(appDir, 'src/modules/*/di.ts'),
  ]

  const allPatterns = [...entityPatterns, ...moduleStructurePatterns, ...diPatterns]

  log('Starting generation watcher...')
  log(`Watching: ${allPatterns.length} patterns`)

  const watcher = watch(allPatterns, {
    persistent: true,
    ignoreInitial: true,
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/.next/**',
      '**/.mercato/**',
    ],
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  })

  watcher.on('add', (filePath) => {
    log(`File added: ${path.relative(rootDir, filePath)}`)
    scheduleGeneration(filePath)
  })

  watcher.on('change', (filePath) => {
    log(`File changed: ${path.relative(rootDir, filePath)}`)
    scheduleGeneration(filePath)
  })

  watcher.on('unlink', (filePath) => {
    log(`File removed: ${path.relative(rootDir, filePath)}`)
    scheduleGeneration(filePath)
  })

  watcher.on('error', (error) => {
    console.error('[generate-watcher] Watcher error:', error)
  })

  log('Generation watcher started')

  // Return cleanup function
  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    watcher.close()
    log('Generation watcher stopped')
  }
}
