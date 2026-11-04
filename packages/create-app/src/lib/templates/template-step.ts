import { existsSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import {
  ensureGeneratedCssPlaceholder,
  extractTarballSnapshot,
  resolveGitHubDefaultBranch,
  validateImportedReadyAppSnapshot,
  type GitHubDeadlines,
} from '../ready-apps.js'
import {
  compatibilityNotice,
  enterpriseNotice,
  fetchLatestStableLine,
  lineOf,
  readEnterpriseRegistrations,
  readPinnedCoreVersion,
  requiresEnterpriseFromLockfile,
  type EnterpriseEvidence,
  type PinnedLine,
} from './compat.js'
import { finalizeTemplateApp, type FinalizeTemplateResult, type TemplateNextStepsInput } from './finalize.js'
import {
  describeTemplateSelection,
  downloadSelectedTemplate,
  resolveTemplateSelection,
} from './resolve-template.js'
import type { TemplateArg, TemplateSelection } from './types.js'

export type TemplateStepOptions = {
  appName: string
  keepName: boolean
  indexUrl: string
  packageVersion: string
}

export type TemplateStepDeps = {
  fetchImpl?: typeof fetch
  /** Timeout for the index and npm requests; tests pass a small one. */
  timeoutMs?: number
  /** Deadlines of the GitHub ref-resolution and download requests; tests pass small ones. */
  githubDeadlines?: GitHubDeadlines
  log?: (line: string) => void
  warn?: (line: string) => void
}

/** The ref recorded in provenance: `#ref`, else the entry's `ref`, else the default branch (the sha if it cannot be read). */
async function provenanceRef(
  selection: TemplateSelection,
  packageVersion: string,
  fetchImpl: typeof fetch,
  githubDeadlines: GitHubDeadlines | undefined,
): Promise<string> {
  if (selection.ref) return selection.ref
  try {
    return await resolveGitHubDefaultBranch(selection.owner, selection.repo, packageVersion, fetchImpl, githubDeadlines)
  } catch {
    return selection.sha
  }
}

function catalogPinnedLine(selection: TemplateSelection): PinnedLine | null {
  const omLine = selection.facts?.omLine
  if (!omLine) return null
  return { line: lineOf(omLine) ?? omLine, source: 'catalog' }
}

/**
 * Creates an app from an app template (spec 2026-11-04, steps 2 to 5): selects one sha through the index, prints it,
 * downloads that sha, extracts it with the archive limits, finalizes it (manifest removal, name rewrite, provenance)
 * and prints the compatibility and Enterprise notices. From the target `mkdir` to the end of finalizing, a failure
 * removes the target directory. Returns what the next steps need.
 */
export async function scaffoldFromTemplate(
  targetDir: string,
  templateArg: TemplateArg,
  options: TemplateStepOptions,
  deps: TemplateStepDeps = {},
): Promise<TemplateNextStepsInput> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const log = deps.log ?? ((line: string) => console.log(line))
  const warn = deps.warn ?? ((line: string) => console.log(pc.yellow(line)))
  const resolveDeps = { indexUrl: options.indexUrl, packageVersion: options.packageVersion, fetchImpl, timeoutMs: deps.timeoutMs, githubDeadlines: deps.githubDeadlines }

  const selection = await resolveTemplateSelection(templateArg, resolveDeps)
  const description = describeTemplateSelection(selection)
  log(pc.bold(description.headline))
  if (description.pageUrl) log(pc.dim(`Template page: ${description.pageUrl}`))
  for (const notice of description.notices) warn(notice)
  log('')

  // Read alongside the download; it never rejects and only feeds a warning.
  const latestLine = fetchLatestStableLine({ fetchImpl, timeoutMs: deps.timeoutMs })
  const archive = await downloadSelectedTemplate(selection, resolveDeps)
  let finalized: FinalizeTemplateResult | null = null
  let provenance: TemplateNextStepsInput['provenance']
  try {
    provenance = {
      repo: `${selection.owner}/${selection.repo}`,
      ref: await provenanceRef(selection, options.packageVersion, fetchImpl, deps.githubDeadlines),
      sha: selection.sha,
    }
    // From the target mkdir on, a failure removes the directory this import created (Ready Apps amendment A-4).
    await extractTarballSnapshot(archive.path, targetDir, {
      removeTargetOnFailure: true,
      afterExtract: (dir) => {
        validateImportedReadyAppSnapshot(dir)
        ensureGeneratedCssPlaceholder(dir)
        finalized = finalizeTemplateApp(dir, { appName: options.appName, keepName: options.keepName, provenance })
      },
    })
  } finally {
    archive.dispose()
  }
  const result = finalized as FinalizeTemplateResult | null
  if (!result) throw new Error('The app template was extracted but not finalized.')
  for (const notice of result.notices) warn(notice)

  const manifest = result.manifest
  const pinned = catalogPinnedLine(selection)
    ?? readPinnedCoreVersion(targetDir, manifest.status === 'ok' ? manifest.openMercato : null)
  const compatibility = compatibilityNotice({
    pinned,
    latestLine: await latestLine,
    linesBehind: pinned?.source === 'catalog' ? selection.facts?.linesBehind ?? null : null,
  })
  if (compatibility) warn(compatibility)
  const enterpriseEvidence: EnterpriseEvidence = selection.facts
    ? { source: 'catalog', requiresEnterprise: selection.facts.requiresEnterprise }
    : { source: 'app', dependency: requiresEnterpriseFromLockfile(targetDir), registrations: readEnterpriseRegistrations(targetDir) }
  const enterprise = enterpriseNotice(enterpriseEvidence)
  if (enterprise) warn(enterprise)
  if (compatibility || enterprise) log('')

  return {
    appName: options.appName,
    hasEnvExample: existsSync(join(targetDir, '.env.example')),
    envKeys: manifest.status === 'ok' ? manifest.env : [],
    provenance,
  }
}
