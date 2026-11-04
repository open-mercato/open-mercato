#!/usr/bin/env node
// Release-line orchestrator — the side-effect half of scripts/lib/release-line.mts, driven by the
// release workflows (CONTRIBUTING.md § Releasing):
//
//   cut       (Release cut, from main)   main at X.Y.Z → creates release/vX.Y.x at main's tip and
//                                        opens the PR that moves main to X.(Y+1).0.
//   prepare   (Release, from release/*)  picks the version (x.y.0 once, then the next patch),
//                                        stamps the release set + CHANGELOG.md, commits the bump
//                                        to the line and tags it BEFORE anything is built — or
//                                        resumes the line's tagged-but-unreleased version.
//   verify    (Release publish, at a tag) checks the tag names the committed version and sits on
//                                        its release line, skips an already released version and
//                                        resolves the dist-tag right before publishing.
//   announce  (Release publish, last)    the PR carrying the changelog entry back to main, then
//                                        the GitHub Release — which marks the version done.
//
// The release set is the root manifest, every public packages/* manifest and every apps/*
// manifest — the same set scripts/check-version-alignment.sh verifies. Every GitHub write goes
// through scripts/lib/github-api.mts; `--dry-run` stamps the working tree but writes nothing.
// Outputs go to $GITHUB_OUTPUT for later workflow steps.
//
// Env: GITHUB_REPOSITORY, GH_TOKEN, GITHUB_REF_NAME, GITHUB_API_URL; OM_RELEASE_ROOT overrides the
// repo root. Tests pin `--latest <version|none>` and `--published <name,…|none>` (skip the
// registry lookups), `--released <tag,…|none>` (skips the GitHub Release lookup) and `--date`.

import { execFile, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import {
  changelogEntryDate,
  changelogSection,
  dropUnreleased,
  ensureChangelogEntry,
  highestLatest,
  insertChangelogEntry,
  isMinorRelease,
  newestLineTag,
  nextMinorVersion,
  planRelease,
  previousMinorRelease,
  releaseBranchFor,
  resolveStableDistTag,
  stampManifestVersion,
  stampUpgradeWindow,
  upgradeCompanionSkill,
  type ChangelogSection,
} from './lib/release-line.mts'
import { createGithubClient, type GithubClient } from './lib/github-api.mts'

type Manifest = { name: string; version: string; private?: boolean }
type Outputs = Record<string, string | boolean>

const execFileAsync = promisify(execFile)

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    branch: { type: 'string' },
    'notes-file': { type: 'string' },
    version: { type: 'string' },
    sha: { type: 'string' },
    'dist-tag': { type: 'string' },
    latest: { type: 'string' },
    released: { type: 'string' },
    published: { type: 'string' },
    date: { type: 'string' },
    tag: { type: 'string' },
  },
})
const command = positionals[0]
const dryRun = flags['dry-run'] === true

const repoRoot = process.env.OM_RELEASE_ROOT
  ? path.resolve(process.env.OM_RELEASE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TRUNK = 'main'
const RELEASE_BODY_LIMIT = 125000
const UPGRADE_NOTES = 'UPGRADE_NOTES.md'
const COMPANION_SKILL_DIRS = ['.ai/skills', 'packages/create-app/agentic/shared/ai/skills']
const BOOKKEEPING_LABELS = ['refactor', 'review', 'skip-changelog', 'skip-qa', 'priority-high', 'risk-low']

function fail(message: string): never {
  console.error(`release-line: ${message}`)
  process.exit(1)
}
const log = (message: string) => console.log(`release-line: ${message}`)
const emit = (result: Outputs) => {
  console.log(`release-line result: ${JSON.stringify(result)}`)
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(result).map(([key, value]) => `${key}=${value}`)
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
  }
}

const abs = (rel: string) => path.join(repoRoot, rel)
const readText = (rel: string) => readFileSync(abs(rel), 'utf8')
const readManifest = (rel: string): Manifest => JSON.parse(readText(rel))
const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
const today = () => flags.date ?? new Date().toISOString().slice(0, 10)

const changed = new Map<string, string>()
const write = (rel: string, content: string) => {
  if (existsSync(abs(rel)) && readText(rel) === content) return
  writeFileSync(abs(rel), content, 'utf8')
  changed.set(rel, content)
}
const changedFiles = () => [...changed].map(([filePath, content]) => ({ path: filePath, content }))

function workspaceManifests(dir: string, { publicOnly }: { publicOnly: boolean }): string[] {
  if (!existsSync(abs(dir))) return []
  return readdirSync(abs(dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${dir}/${entry.name}/package.json`)
    .filter((rel) => existsSync(abs(rel)))
    .filter((rel) => !publicOnly || readManifest(rel).private !== true)
    .sort()
}

function releaseSet(): string[] {
  return ['package.json', ...workspaceManifests('packages', { publicOnly: true }), ...workspaceManifests('apps', { publicOnly: false })]
}

function publishedPackages(): Manifest[] {
  return workspaceManifests('packages', { publicOnly: true }).map((rel) => readManifest(rel))
}

function stampReleaseSet(version: string) {
  for (const rel of releaseSet()) write(rel, stampManifestVersion(readText(rel), version))
}

function github(): GithubClient {
  return createGithubClient({ token: process.env.GH_TOKEN, repository: process.env.GITHUB_REPOSITORY })
}

async function openBookkeepingPr(
  gh: GithubClient,
  { branch, parentSha, title, body, labels }: { branch: string; parentSha: string; title: string; body: string; labels: string[] },
): Promise<string> {
  const sha = await gh.commitFiles({ parentSha, files: changedFiles(), message: title })
  await gh.setBranch(branch, sha)
  const pr = await gh.openPullRequest({ head: branch, base: TRUNK, title, body })
  await gh.ensureLabel('skip-changelog', 'ededed', 'Left out of generated release notes')
  await gh.addLabels(pr.number, labels)
  log(`opened ${pr.html_url}`)
  return pr.html_url
}

async function cut() {
  const branchName = flags.branch ?? process.env.GITHUB_REF_NAME ?? TRUNK
  if (branchName !== TRUNK) fail(`a release line is cut from ${TRUNK}, not ${branchName}`)
  const current = readManifest('package.json').version
  const releaseBranch = releaseBranchFor(current)
  const next = nextMinorVersion(current)
  if (!releaseBranch || !next) fail(`${TRUNK}'s version "${current}" is not a plain x.y.z`)
  const head = git('rev-parse', 'HEAD')

  const gh = dryRun ? null : github()
  const existing = gh ? await gh.getBranchSha(releaseBranch) : null
  // A re-run after main moved would rebuild the bump PR from a newer main and drop `# Unreleased`
  // notes that never reached the line. Only a re-run from the very commit the line was cut at is safe.
  if (existing && existing !== head) {
    fail(
      `${releaseBranch} already exists at ${existing.slice(0, 12)} but ${TRUNK} is at ${head.slice(0, 12)}. ` +
        `Merge the existing chore/open-v${next} PR, or delete ${releaseBranch} to cut again from the current ${TRUNK}.`,
    )
  }

  stampReleaseSet(next)
  if (existsSync(abs('CHANGELOG.md'))) write('CHANGELOG.md', dropUnreleased(readText('CHANGELOG.md')))
  log(`${TRUNK} ${current} → ${releaseBranch} at ${head.slice(0, 12)}; ${TRUNK} moves to ${next}`)

  let prUrl = ''
  if (!gh) {
    log(`dry run — would create ${releaseBranch} and open the ${next} PR (${changed.size} files)`)
  } else {
    if (existing) log(`${releaseBranch} already exists at ${existing.slice(0, 12)} — left as it is`)
    else await gh.createBranch(releaseBranch, head)
    await gh.ensureLabel(`backport ${releaseBranch}`, 'c5def5', `Cherry-pick into ${releaseBranch} once merged`)
    await gh.ensureLabel(`backport ${TRUNK}`, 'c5def5', `Forward-port a release-line hotfix to ${TRUNK} once merged`)
    prUrl = await openBookkeepingPr(gh, {
      branch: `chore/open-v${next}`,
      parentSha: head,
      title: `chore(release): open ${next} on ${TRUNK}`,
      body: [
        `\`${releaseBranch}\` was cut from \`${head.slice(0, 12)}\` and now carries \`${current}\` and its patches.`,
        '',
        `This moves ${TRUNK}'s release set to \`${next}\`: features keep landing here while \`${releaseBranch}\` takes only fixes (label a PR \`backport ${releaseBranch}\`).`,
        '',
        `Next: run **Release** from \`${releaseBranch}\`.`,
      ].join('\n'),
      labels: BOOKKEEPING_LABELS,
    })
  }
  emit({ releaseBranch, current, nextVersion: next, prUrl })
}

async function latestOf(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('npm', ['view', name, 'dist-tags.latest'], { encoding: 'utf8' })
    return stdout.trim() || null
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '')
    if (stderr.includes('E404')) return null
    fail(`cannot read ${name}'s dist-tags from npm (failing closed so latest never moves backwards): ${(error as Error).message}`)
  }
}

async function latestOnRegistry(): Promise<string | null> {
  if (flags.latest !== undefined) return flags.latest === 'none' ? null : flags.latest
  return highestLatest(await Promise.all(publishedPackages().map((pkg) => latestOf(pkg.name))))
}

async function isPublished(name: string, version: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' })
    return stdout.trim() === version
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '')
    if (stderr.includes('E404')) return false
    fail(`cannot read ${name}@${version} from npm: ${(error as Error).message}`)
  }
}

async function publishedAt(version: string): Promise<string[]> {
  if (flags.published !== undefined) {
    return flags.published === 'none' ? [] : flags.published.split(',').map((item) => item.trim())
  }
  const packages = publishedPackages()
  const published = await Promise.all(packages.map((pkg) => isPublished(pkg.name, version)))
  return packages.filter((_, index) => published[index]).map((pkg) => pkg.name)
}

async function isReleased(tag: string): Promise<boolean> {
  if (flags.released !== undefined) return flags.released.split(',').map((item) => item.trim()).includes(tag)
  return github().hasRelease(tag)
}

// A minor must ship with the upgrade companions the repository contract requires (the
// `UPGRADE_NOTES.md` window from the previous minor and the companion skill on both agent
// surfaces), dated with the release date. Checked before anything is committed or tagged.
function stampMinorUpgradeWindow(version: string, tags: readonly string[], date: string) {
  if (!isMinorRelease(version)) return
  const from = previousMinorRelease(version, tags)
  if (!from) return
  const window = `${from} → ${version}`
  const skill = upgradeCompanionSkill(from, version)
  const missing: string[] = []
  const notes = existsSync(abs(UPGRADE_NOTES)) ? readText(UPGRADE_NOTES) : ''
  const stamped = stampUpgradeWindow(notes, from, version, date)
  if (stamped.matches !== 1) missing.push(`exactly one "## ${window} (…)" window in ${UPGRADE_NOTES} (found ${stamped.matches})`)
  for (const dir of COMPANION_SKILL_DIRS) {
    if (!existsSync(abs(`${dir}/${skill}/SKILL.md`))) missing.push(`${dir}/${skill}/SKILL.md`)
  }
  if (missing.length > 0) {
    fail(
      `${version} is a minor release and needs its upgrade companions before it ships: ${missing.join('; ')}. ` +
        `Add them on main (om-auto-update-changelog drafts them) and backport them to ${releaseBranchFor(version)}.`,
    )
  }
  write(UPGRADE_NOTES, stamped.text)
  log(`upgrade window ${window} dated ${date}`)
}

async function prepare() {
  const branch = flags.branch ?? process.env.GITHUB_REF_NAME ?? ''
  const manifestVersion = readManifest('package.json').version
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean)
  const pending = newestLineTag(branch, tags)
  const newestTagReleased = pending === null || (await isReleased(pending))
  const plan = planRelease({ branch, manifestVersion, tags, newestTagReleased })
  if (!plan.ok) fail(plan.error)
  const { version, bumped, resumed, previousTag } = plan
  const tag = `v${version}`
  const distTag = resolveStableDistTag(version, await latestOnRegistry())

  if (resumed) {
    const sha = git('rev-parse', `${tag}^{commit}`)
    log(`${branch}: ${tag} is tagged at ${sha.slice(0, 12)} but has no GitHub Release — finish it by re-running its Release publish run (or dispatch Release publish from ${tag}); nothing new is tagged`)
    emit({ version, bumped, resumed, distTag, sha, previousTag: previousTag ?? '', changelog: 'existing' })
    return
  }

  log(`${branch}: releasing ${version}${bumped ? ` (patch bump from ${manifestVersion})` : ''} under "${distTag}"`)
  // An untagged version is only ever unpublished — the tag is created before anything is built.
  // Packages already on npm mean its tag was deleted: shipping from the current tip would mix
  // revisions inside one immutable version, so stop and have the tag restored.
  if (!bumped) {
    const published = await publishedAt(version)
    if (published.length > 0) {
      fail(
        `${version} has no tag, but ${published.join(', ')} ${published.length === 1 ? 'is' : 'are'} already on npm. ` +
          `Recreate ${tag} at the commit it was published from to resume it; never re-release it from the line tip.`,
      )
    }
  }
  if (bumped) stampReleaseSet(version)
  const head = git('rev-parse', 'HEAD')
  let notes = flags['notes-file'] ? readFileSync(flags['notes-file'], 'utf8') : ''
  const changelog = existsSync(abs('CHANGELOG.md')) ? readText('CHANGELOG.md') : ''
  if (!notes && !dryRun && !changelogSection(changelog, version)) {
    notes = await github().generateNotes({ tag, target: head, previousTag })
  }
  const entry = ensureChangelogEntry(changelog, version, today(), notes)
  write('CHANGELOG.md', entry.text)
  log(`changelog entry: ${entry.source}`)
  const releaseDate = changelogEntryDate(changelogSection(entry.text, version)?.heading ?? '') ?? today()
  stampMinorUpgradeWindow(version, tags, releaseDate)

  let sha = head
  if (!dryRun) {
    const gh = github()
    if (changed.size > 0) {
      sha = await gh.commitFiles({ parentSha: head, files: changedFiles(), message: `chore(release): ${version}` })
      await gh.moveBranch(branch, sha, false)
      log(`committed the bump to ${branch} as ${sha.slice(0, 12)}`)
    }
    await gh.ensureTag(tag, sha)
    log(`tagged ${tag} at ${sha.slice(0, 12)} — Release publish takes it from here, at that commit`)
  }
  emit({ version, bumped, resumed, distTag, sha, previousTag: previousTag ?? '', changelog: entry.source })
}

function releaseBody({ version, section, distTag, tag }: { version: string; section: ChangelogSection; distTag: string; tag: string }): string {
  const packages = publishedPackages().sort((left, right) => left.name.localeCompare(right.name))
  const table = [
    '## Published Packages',
    '',
    '| Package | Version |',
    '|---------|---------|',
    ...packages.map((pkg) => `| \`${pkg.name}\` | \`${pkg.version}\` |`),
  ].join('\n')
  const install = distTag === 'latest' ? '' : `@${distTag}`
  const footer = [
    '## Install',
    '',
    '```bash',
    `npx create-mercato-app@${version} my-app`,
    '```',
    '',
    `Published under the \`${distTag}\` dist-tag (\`yarn add @open-mercato/core${install}\`).`,
  ].join('\n')
  const changelogUrl = `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'open-mercato/open-mercato'}/blob/${tag}/CHANGELOG.md`
  const tail = `\n\n---\n\n${footer}\n\n${table}\n\n[Full changelog](${changelogUrl})`
  const budget = RELEASE_BODY_LIMIT - tail.length - 500
  const notes = section.body.length > budget
    ? `${section.body.slice(0, budget)}\n\n_Changelog truncated — [read the full entry](${changelogUrl})._`
    : section.body
  return `${notes}${tail}`
}

async function announce() {
  const version = flags.version ?? fail('--version is required')
  const sha = flags.sha ?? fail('--sha is required')
  const distTag = flags['dist-tag'] ?? fail('--dist-tag is required')
  const tag = `v${version}`
  const section = changelogSection(readText('CHANGELOG.md'), version) ?? fail(`CHANGELOG.md has no entry for ${version}`)
  const body = releaseBody({ version, section, distTag, tag })

  if (dryRun) {
    log(`dry run — would release ${tag} at ${sha.slice(0, 12)} (latest: ${distTag === 'latest'})`)
    console.log(body)
    emit({ released: false, changelogPr: '' })
    return
  }
  const gh = github()
  // The changelog PR comes first: the GitHub Release marks the version done, so anything after
  // it would be skipped by a re-run (which would move on to the next patch instead).
  const trunkSha = (await gh.getBranchSha(TRUNK)) ?? fail(`cannot resolve ${TRUNK}`)
  const trunkChangelog = await gh.readFile('CHANGELOG.md', trunkSha)
  const carried = insertChangelogEntry(trunkChangelog, version, `${section.heading}\n\n${section.body}\n`)
  changed.clear()
  if (carried !== trunkChangelog) changed.set('CHANGELOG.md', carried)
  const releaseDate = changelogEntryDate(section.heading)
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean)
  const from = isMinorRelease(version) ? previousMinorRelease(version, tags) : null
  if (from && releaseDate) {
    const trunkNotes = await gh.readFile(UPGRADE_NOTES, trunkSha)
    const stamped = stampUpgradeWindow(trunkNotes, from, version, releaseDate)
    if (stamped.text !== trunkNotes) changed.set(UPGRADE_NOTES, stamped.text)
  }
  let changelogPr = ''
  if (changed.size > 0) {
    changelogPr = await openBookkeepingPr(gh, {
      branch: `chore/changelog-v${version}`,
      parentSha: trunkSha,
      title: `docs(changelog): add the ${version} entry`,
      body: `Carries the \`${version}\` changelog entry released from \`${releaseBranchFor(version)}\` back to ${TRUNK}.`,
      labels: ['documentation', 'review', 'skip-changelog', 'skip-qa', 'priority-medium', 'risk-low'],
    })
  }

  const created = await gh.createRelease({ tag, sha, name: tag, body, makeLatest: distTag === 'latest' })
  log(created ? `released ${tag}` : `${tag} already had a GitHub Release — notes refreshed`)
  emit({ released: created, changelogPr })
}

async function verify() {
  const tag = flags.tag ?? process.env.GITHUB_REF_NAME ?? ''
  const version = tag.startsWith('v') ? tag.slice(1) : ''
  const line = releaseBranchFor(version) ?? fail(`"${tag}" is not a vX.Y.Z release tag`)
  const manifestVersion = readManifest('package.json').version
  if (manifestVersion !== version) fail(`${tag} points at a commit whose root manifest is ${manifestVersion}, not ${version}`)
  const head = git('rev-parse', 'HEAD')
  try {
    git('merge-base', '--is-ancestor', head, `origin/${line}`)
  } catch {
    fail(`${tag} (${head.slice(0, 12)}) is not on ${line}; only the Release workflow tags release commits`)
  }
  if (await isReleased(tag)) {
    log(`${tag} already has a GitHub Release — nothing to publish`)
    emit({ version, released: true, distTag: '' })
    return
  }
  const distTag = resolveStableDistTag(version, await latestOnRegistry())
  log(`publishing ${version} from ${head.slice(0, 12)} on ${line} under "${distTag}"`)
  emit({ version, released: false, distTag })
}

const commands: Record<string, () => Promise<void>> = { cut, prepare, verify, announce }
const run = commands[command ?? ''] ?? fail(`unknown command "${command ?? ''}" — expected cut, prepare, verify or announce`)
await run()
