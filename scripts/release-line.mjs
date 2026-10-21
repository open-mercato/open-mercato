#!/usr/bin/env node
// Release-line orchestrator — the side-effect half of scripts/lib/release-line.mjs, driven by the
// release workflows (CONTRIBUTING.md § Releasing):
//
//   cut       (Release cut, from main)   main at X.Y.Z → creates release/vX.Y.x at main's tip and
//                                        opens the PR that moves main to X.(Y+1).0.
//   prepare   (Release, from release/*)  picks the version (x.y.0 once, then the next patch),
//                                        stamps the release set + CHANGELOG.md and commits the
//                                        bump to the line BEFORE anything is built.
//   announce  (Release, after publish)   GitHub Release + tag at the bump commit, and a PR carrying
//                                        the changelog entry back to main.
//
// The release set is the root manifest, every public packages/* manifest and every apps/*
// manifest — the same set scripts/check-version-alignment.sh verifies. Every GitHub write goes
// through scripts/lib/github-api.mjs; `--dry-run` stamps the working tree but calls no API.
// Outputs go to $GITHUB_OUTPUT for later workflow steps.
//
// Env: GITHUB_REPOSITORY, GH_TOKEN, GITHUB_REF_NAME; OM_RELEASE_ROOT overrides the repo root.
// Tests pin `--latest <version|none>` (skips the registry lookup) and `--date <YYYY-MM-DD>`.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  changelogSection,
  dropUnreleased,
  ensureChangelogEntry,
  insertChangelogEntry,
  nextMinorVersion,
  planRelease,
  releaseBranchFor,
  resolveStableDistTag,
  stampManifestVersion,
} from './lib/release-line.mjs'
import { createGithubClient } from './lib/github-api.mjs'

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
    date: { type: 'string' },
  },
})
const command = positionals[0]
const dryRun = flags['dry-run']

const repoRoot = process.env.OM_RELEASE_ROOT
  ? path.resolve(process.env.OM_RELEASE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TRUNK = 'main'
const REGISTRY_PROBE = '@open-mercato/shared'
const RELEASE_BODY_LIMIT = 125000
const BOOKKEEPING_LABELS = ['skip-changelog', 'skip-qa', 'priority-high', 'risk-low']

const fail = (message) => {
  console.error(`release-line: ${message}`)
  process.exit(1)
}
const log = (message) => console.log(`release-line: ${message}`)
const emit = (result) => {
  console.log(`release-line result: ${JSON.stringify(result)}`)
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(result).map(([key, value]) => `${key}=${value}`)
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
  }
}

const abs = (rel) => path.join(repoRoot, rel)
const readText = (rel) => readFileSync(abs(rel), 'utf8')
const readJson = (rel) => JSON.parse(readText(rel))
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
const today = () => flags.date ?? new Date().toISOString().slice(0, 10)

const changed = new Map()
const write = (rel, content) => {
  if (existsSync(abs(rel)) && readText(rel) === content) return
  writeFileSync(abs(rel), content, 'utf8')
  changed.set(rel, content)
}
const changedFiles = () => [...changed].map(([filePath, content]) => ({ path: filePath, content }))

function workspaceManifests(dir, { publicOnly }) {
  if (!existsSync(abs(dir))) return []
  return readdirSync(abs(dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${dir}/${entry.name}/package.json`)
    .filter((rel) => existsSync(abs(rel)))
    .filter((rel) => !publicOnly || readJson(rel).private !== true)
    .sort()
}

function releaseSet() {
  return ['package.json', ...workspaceManifests('packages', { publicOnly: true }), ...workspaceManifests('apps', { publicOnly: false })]
}

function publishedPackages() {
  return workspaceManifests('packages', { publicOnly: true }).map((rel) => readJson(rel))
}

function stampReleaseSet(version) {
  for (const rel of releaseSet()) write(rel, stampManifestVersion(readText(rel), version))
}

function github() {
  return createGithubClient({ token: process.env.GH_TOKEN, repository: process.env.GITHUB_REPOSITORY })
}

async function openBookkeepingPr(gh, { branch, parentSha, title, body, labels }) {
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
  const current = readJson('package.json').version
  const releaseBranch = releaseBranchFor(current)
  const next = nextMinorVersion(current)
  if (!releaseBranch || !next) fail(`${TRUNK}'s version "${current}" is not a plain x.y.z`)
  const head = git('rev-parse', 'HEAD')
  stampReleaseSet(next)
  if (existsSync(abs('CHANGELOG.md'))) write('CHANGELOG.md', dropUnreleased(readText('CHANGELOG.md')))
  log(`${TRUNK} ${current} → ${releaseBranch} at ${head.slice(0, 12)}; ${TRUNK} moves to ${next}`)

  let prUrl = ''
  if (dryRun) {
    log(`dry run — would create ${releaseBranch} and open the ${next} PR (${changed.size} files)`)
  } else {
    const gh = github()
    const existing = await gh.getBranchSha(releaseBranch)
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

function latestOnRegistry() {
  if (flags.latest !== undefined) return flags.latest === 'none' ? null : flags.latest
  try {
    return (
      execFileSync('npm', ['view', REGISTRY_PROBE, 'dist-tags.latest'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim() || null
    )
  } catch (error) {
    fail(`cannot read ${REGISTRY_PROBE}'s dist-tags from npm (failing closed so latest never moves backwards): ${error.message}`)
  }
}

async function prepare() {
  const branch = flags.branch ?? process.env.GITHUB_REF_NAME ?? ''
  const manifestVersion = readJson('package.json').version
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean)
  const plan = planRelease({ branch, manifestVersion, tags })
  if (!plan.ok) fail(plan.error)
  const { version, bumped, previousTag } = plan
  const distTag = resolveStableDistTag(version, latestOnRegistry())
  log(`${branch}: releasing ${version}${bumped ? ` (patch bump from ${manifestVersion})` : ''} under "${distTag}"`)

  if (bumped) stampReleaseSet(version)
  const head = git('rev-parse', 'HEAD')
  let notes = flags['notes-file'] ? readFileSync(flags['notes-file'], 'utf8') : ''
  const changelog = existsSync(abs('CHANGELOG.md')) ? readText('CHANGELOG.md') : ''
  if (!notes && !dryRun && !changelogSection(changelog, version)) {
    notes = await github().generateNotes({ tag: `v${version}`, target: head, previousTag })
  }
  const entry = ensureChangelogEntry(changelog, version, today(), notes)
  write('CHANGELOG.md', entry.text)
  log(`changelog entry: ${entry.source}`)

  let sha = head
  if (changed.size > 0 && !dryRun) {
    const gh = github()
    sha = await gh.commitFiles({ parentSha: head, files: changedFiles(), message: `chore(release): ${version}` })
    await gh.moveBranch(branch, sha, false)
    log(`committed the bump to ${branch} as ${sha.slice(0, 12)}`)
  }
  emit({ version, bumped, distTag, sha, previousTag: previousTag ?? '', changelog: entry.source })
}

function releaseBody({ version, section, distTag, tag }) {
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
  const section = changelogSection(readText('CHANGELOG.md'), version)
  if (!section) fail(`CHANGELOG.md has no entry for ${version}`)
  const body = releaseBody({ version, section, distTag, tag })

  if (dryRun) {
    log(`dry run — would release ${tag} at ${sha.slice(0, 12)} (latest: ${distTag === 'latest'})`)
    console.log(body)
    emit({ released: false, changelogPr: '' })
    return
  }
  const gh = github()
  const created = await gh.createRelease({ tag, sha, name: tag, body, makeLatest: distTag === 'latest' })
  log(created ? `released ${tag}` : `${tag} already had a GitHub Release — notes refreshed`)

  const trunkSha = await gh.getBranchSha(TRUNK)
  const trunkChangelog = await gh.readFile('CHANGELOG.md', trunkSha)
  const carried = insertChangelogEntry(trunkChangelog, version, `${section.heading}\n\n${section.body}\n`)
  let changelogPr = ''
  if (carried !== trunkChangelog) {
    changed.clear()
    changed.set('CHANGELOG.md', carried)
    changelogPr = await openBookkeepingPr(gh, {
      branch: `chore/changelog-v${version}`,
      parentSha: trunkSha,
      title: `docs(changelog): add the ${version} entry`,
      body: `Carries the \`${version}\` changelog entry released from \`${releaseBranchFor(version)}\` back to ${TRUNK}.`,
      labels: ['documentation', 'skip-changelog', 'skip-qa', 'priority-medium', 'risk-low'],
    })
  }
  emit({ released: created, changelogPr })
}

const commands = { cut, prepare, announce }
if (!commands[command]) fail(`unknown command "${command ?? ''}" — expected cut, prepare or announce`)
await commands[command]()
