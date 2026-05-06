import fs from 'node:fs'
import path from 'node:path'

const GENERATED_DIR_RELATIVE = path.join('.mercato', 'generated')
const TOUCHABLE_PATTERN = /\.generated(?:\.[a-z0-9]+)?(?:\.ts|\.checksum)$/i
const MAX_PARENT_WALK = 5

export type TouchGeneratedBarrelsOptions = {
  cwd?: string
  quiet?: boolean
  log?: (message: string) => void
}

export type TouchGeneratedBarrelsResult = {
  generatedDir: string | null
  files: string[]
}

export function findGeneratedDir(startDir: string): string | null {
  let current = path.resolve(startDir)
  for (let depth = 0; depth <= MAX_PARENT_WALK; depth += 1) {
    const candidate = path.join(current, GENERATED_DIR_RELATIVE)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

export function touchGeneratedBarrels(
  options: TouchGeneratedBarrelsOptions = {},
): TouchGeneratedBarrelsResult {
  const cwd = options.cwd ?? process.cwd()
  const log = options.log ?? ((message: string) => console.log(message))
  const quiet = options.quiet === true

  const generatedDir = findGeneratedDir(cwd)
  if (!generatedDir) {
    return { generatedDir: null, files: [] }
  }

  const touched: string[] = []
  const entries = fs.readdirSync(generatedDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!TOUCHABLE_PATTERN.test(entry.name)) continue
    const filePath = path.join(generatedDir, entry.name)
    const contents = fs.readFileSync(filePath)
    fs.writeFileSync(filePath, contents)
    touched.push(filePath)
  }

  if (!quiet && touched.length > 0) {
    log(`🔁 [structural] touched ${touched.length} generated barrel(s) → ${generatedDir}`)
  }

  return { generatedDir, files: touched }
}
