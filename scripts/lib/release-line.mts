// Release-line decisions — the pure half of scripts/release-line.mts (CONTRIBUTING.md § Releasing).
//
// `main` always carries the next minor. Each released minor lives on `release/vX.Y.x` and only
// ever ships patches, so the version of a release is never chosen by hand: a cut moves main to
// the next minor, and a release from a line ships its committed `x.y.0` once, then patches.
// Everything here is side-effect free so the decisions stay unit-testable.

export type StableVersion = readonly [major: number, minor: number, patch: number]

export type ReleaseLine = { major: number; minor: number }

export type ReleasePlan =
  | { ok: true; version: string; bumped: boolean; resumed: boolean; previousTag: string | null }
  | { ok: false; error: string }

export type ChangelogSource = 'existing' | 'unreleased' | 'generated'

export type ChangelogSection = { heading: string; body: string }

const STABLE = /^v?(\d+)\.(\d+)\.(\d+)$/
const RELEASE_BRANCH = /^(?:refs\/heads\/)?release\/v(\d+)\.(\d+)\.x$/
const HEADING = /^# (\S+)(?:\s.*)?$/
const UNRELEASED = /^# unreleased\b/i

export function parseStableVersion(version: string | null | undefined): StableVersion | null {
  const match = STABLE.exec(String(version ?? '').trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareStableVersions(left: string, right: string): number {
  const parsedLeft = parseStableVersion(left)
  const parsedRight = parseStableVersion(right)
  if (!parsedLeft || !parsedRight) return parsedLeft ? 1 : parsedRight ? -1 : 0
  for (let index = 0; index < 3; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) return parsedLeft[index] - parsedRight[index]
  }
  return 0
}

export function releaseBranchFor(version: string): string | null {
  const parsed = parseStableVersion(version)
  return parsed ? `release/v${parsed[0]}.${parsed[1]}.x` : null
}

export function parseReleaseBranch(ref: string): ReleaseLine | null {
  const match = RELEASE_BRANCH.exec(String(ref ?? '').trim())
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null
}

export function nextMinorVersion(version: string): string | null {
  const parsed = parseStableVersion(version)
  return parsed ? `${parsed[0]}.${parsed[1] + 1}.0` : null
}

function nextPatchVersion(version: StableVersion): string {
  return `${version[0]}.${version[1]}.${version[2] + 1}`
}

// The newest tag on a line, if any — the one a re-run may have to resume.
export function newestLineTag(branch: string, tags: readonly string[]): string | null {
  const line = parseReleaseBranch(branch)
  if (!line) return null
  return (
    tags
      .map((tag) => tag.trim())
      .filter((tag) => {
        const parsed = tag.startsWith('v') ? parseStableVersion(tag) : null
        return parsed !== null && parsed[0] === line.major && parsed[1] === line.minor
      })
      .sort(compareStableVersions)
      .at(-1) ?? null
  )
}

// What a release from `release/vX.Y.x` publishes. A version is done once its GitHub Release
// exists; its tag is created before publishing and pins the commit it is built from. So:
// - the line's newest tag has no GitHub Release → a run died after tagging: resume that version
//   at the tagged commit, never a newer tip (packages already on npm came from that commit);
// - otherwise the committed version ships while no tag names it (a fresh line's x.y.0, or a run
//   that died after its bump commit but before tagging), else the next patch past every tag.
export function planRelease({
  branch,
  manifestVersion,
  tags,
  newestTagReleased,
}: {
  branch: string
  manifestVersion: string
  tags: readonly string[]
  newestTagReleased: boolean
}): ReleasePlan {
  const line = parseReleaseBranch(branch)
  if (!line) return { ok: false, error: `"${branch}" is not a release/vX.Y.x branch` }
  const base = parseStableVersion(manifestVersion)
  if (!base) return { ok: false, error: `manifest version "${manifestVersion}" is not a plain x.y.z` }
  if (base[0] !== line.major || base[1] !== line.minor) {
    return { ok: false, error: `manifest version ${manifestVersion} does not belong to ${branch}` }
  }
  const previousTagOf = (version: string) =>
    tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.startsWith('v') && parseStableVersion(tag) && compareStableVersions(tag, version) < 0)
      .sort(compareStableVersions)
      .at(-1) ?? null

  const pending = newestLineTag(branch, tags)
  if (pending && !newestTagReleased) {
    const version = pending.slice(1)
    return { ok: true, version, bumped: false, resumed: true, previousTag: previousTagOf(version) }
  }

  const taken = new Set(tags.map((tag) => tag.trim()))
  let parsed: StableVersion = base
  let version = manifestVersion.trim()
  while (taken.has(`v${version}`)) {
    version = nextPatchVersion(parsed)
    parsed = [parsed[0], parsed[1], parsed[2] + 1]
  }
  return { ok: true, version, bumped: version !== manifestVersion.trim(), resumed: false, previousTag: previousTagOf(version) }
}

// The highest stable version any package's `latest` points at. Taking the maximum across the
// whole release set means a half-failed publish (core moved, shared did not) can never let an
// older line's patch move core's `latest` backwards.
export function highestLatest(latestByPackage: readonly (string | null)[]): string | null {
  return (
    latestByPackage
      .filter((version): version is string => version !== null && parseStableVersion(version) !== null)
      .sort(compareStableVersions)
      .at(-1) ?? null
  )
}

// Only the newest line moves `latest`; a patch to an older line publishes under `latest-X.Y`,
// so `npm i @open-mercato/core` never resolves to a downgrade.
export function resolveStableDistTag(version: string, currentLatest: string | null | undefined): string {
  const parsed = parseStableVersion(version)
  if (!parsed) throw new Error(`[internal] not a stable version: ${version}`)
  if (!currentLatest || !parseStableVersion(currentLatest)) return 'latest'
  return compareStableVersions(version, currentLatest) >= 0 ? 'latest' : `latest-${parsed[0]}.${parsed[1]}`
}

export function stampManifestVersion(source: string, version: string): string {
  const manifest: Record<string, unknown> = JSON.parse(source)
  if (manifest.version === version) return source
  return `${JSON.stringify({ ...manifest, version }, null, 2)}\n`
}

function sectionEnd(lines: readonly string[], start: number): number {
  const next = lines.findIndex((line, index) => index > start && HEADING.test(line))
  return next < 0 ? lines.length : next
}

// The entry a release ships with. A hand-written one wins: an existing `# <version>` heading is
// kept and a leading `# Unreleased` is renamed; only when neither exists are the generated notes
// used.
export function ensureChangelogEntry(
  changelog: string,
  version: string,
  date: string,
  notes: string | null | undefined,
): { text: string; source: ChangelogSource } {
  const lines = changelog.split('\n')
  if (lines.some((line) => HEADING.exec(line)?.[1] === version)) return { text: changelog, source: 'existing' }
  const heading = `# ${version} (${date})`
  const first = lines.findIndex((line) => HEADING.test(line))
  if (first >= 0 && UNRELEASED.test(lines[first])) {
    lines[first] = heading
    return { text: lines.join('\n'), source: 'unreleased' }
  }
  const body = String(notes ?? '').trim() || '- Maintenance release.'
  return { text: `${heading}\n\n${body}\n\n${changelog.replace(/^\n+/, '')}`, source: 'generated' }
}

// A cut hands main's leading `# Unreleased` to the new line, which ships it as x.y.0. Left on
// main it would sit above that entry once the release carries it back, and ship again next cut.
export function dropUnreleased(changelog: string): string {
  const lines = changelog.split('\n')
  const first = lines.findIndex((line) => HEADING.test(line))
  if (first < 0 || !UNRELEASED.test(lines[first])) return changelog
  const end = sectionEnd(lines, first)
  return [...lines.slice(0, first), ...lines.slice(end)].join('\n').replace(/^\n+/, '')
}

const GREEN_TAG = /^green\/(\d{4})-(\d{2})-(\d{2})$/

// A green tag names the day a daily batch passed the full suite and QA: `green/YYYY-MM-DD`.
export function isGreenTag(name: string): boolean {
  const match = GREEN_TAG.exec(String(name ?? '').trim())
  if (!match) return false
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === `${match[1]}-${match[2]}-${match[3]}`
}

export type CommitPullRequest = {
  number: number
  state: string
  merged_at: string | null
  head: { ref: string; sha: string }
  base: { ref: string }
}

export type BatchVerdict = { ok: true; number: number; branch: string } | { ok: false; error: string }

// A line is cut only at a green tag on the head commit of a `stabilize/` batch PR that was merged
// into the trunk. The batch is squash-merged, so the tagged commit is never an ancestor of the
// trunk: the merged PR is the only proof the tested commit is what the trunk received.
export function batchPullRequest(pulls: readonly CommitPullRequest[], sha: string, trunk: string): BatchVerdict {
  const batches = pulls.filter(
    (pr) => pr.head.sha === sha && pr.head.ref.startsWith('stabilize/') && pr.base.ref === trunk,
  )
  const merged = batches.find((pr) => Boolean(pr.merged_at))
  if (merged) return { ok: true, number: merged.number, branch: merged.head.ref }
  const open = batches.find((pr) => pr.state === 'open')
  if (open) return { ok: false, error: `it heads #${open.number} (${open.head.ref}), which is still open — merge the batch into ${trunk} first` }
  if (batches.length > 0) {
    return { ok: false, error: `it heads #${batches[0].number} (${batches[0].head.ref}), which was closed without merging into ${trunk}` }
  }
  return { ok: false, error: `${sha.slice(0, 12)} is not the head commit of a stabilize/ PR merged into ${trunk}` }
}

const SUBJECT_PR = /\(#(\d+)\)\s*$/
const MERGE_PR = /^Merge pull request #(\d+)\b/

// The PRs a ref contains, read from the subjects of every commit reachable from it: a squash
// merge ends its subject with `(#N)`, a merge commit starts with `Merge pull request #N`.
export function pullRequestsInSubjects(subjects: readonly string[]): Set<number> {
  const numbers = new Set<number>()
  for (const subject of subjects) {
    const match = SUBJECT_PR.exec(subject) ?? MERGE_PR.exec(subject)
    if (match) numbers.add(Number(match[1]))
  }
  return numbers
}

// The PR a changelog entry is about: a generated entry links `/pull/N`; a curated one ends with
// `(#N)` after any issue references, so the last `#N` is the PR.
export function entryPullRequest(entry: string): number | null {
  const linked = [...entry.matchAll(/\/pull\/(\d+)/g)].at(-1)
  if (linked) return Number(linked[1])
  const referenced = [...entry.matchAll(/#(\d+)\b/g)].at(-1)
  return referenced ? Number(referenced[1]) : null
}

type UnreleasedBlock =
  | { kind: 'heading'; level: number; lines: string[] }
  | { kind: 'spacer'; lines: string[] }
  | { kind: 'entry'; lines: string[] }

const SUB_HEADING = /^(#{2,6})\s/
const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d+[.)])\s/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

function unreleasedBlocks(lines: readonly string[]): UnreleasedBlock[] {
  const blocks: UnreleasedBlock[] = []
  for (const line of lines) {
    const current = blocks.at(-1)
    const heading = SUB_HEADING.exec(line)
    if (heading) blocks.push({ kind: 'heading', level: heading[1].length, lines: [line] })
    else if (!line.trim() || RULE.test(line)) blocks.push({ kind: 'spacer', lines: [line] })
    else if (current && current.kind === 'entry' && !LIST_ITEM.test(line)) current.lines.push(line)
    else blocks.push({ kind: 'entry', lines: [line] })
  }
  return blocks
}

function keptBody(blocks: readonly UnreleasedBlock[], keep: ReadonlySet<UnreleasedBlock>): string {
  const output: string[] = []
  blocks.forEach((block, index) => {
    if (block.kind === 'entry' && !keep.has(block)) return
    if (block.kind === 'spacer') {
      if (!RULE.test(block.lines[0])) output.push('')
      return
    }
    if (block.kind === 'heading') {
      const end = blocks.findIndex((next, at) => at > index && next.kind === 'heading' && next.level <= block.level)
      const scope = blocks.slice(index + 1, end < 0 ? blocks.length : end)
      if (!scope.some((next) => next.kind === 'entry' && keep.has(next))) return
    }
    output.push(...block.lines)
  })
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export type UnreleasedSplit = { line: string; trunk: string; untraced: string[] }

// A cut at a green tag hands the line only what the tag contains. Entries of the trunk's leading
// `# Unreleased` whose PR the cut ref contains go to the line; entries for PRs merged after it
// stay on the trunk for the next minor. An entry naming no PR cannot be traced, so it stays on
// the trunk and is reported for the release owner to place by hand. Sub-headings follow their
// entries to both sides. Null when the changelog has no leading `# Unreleased`.
export function splitUnreleased(changelog: string, contains: (pr: number) => boolean): UnreleasedSplit | null {
  const lines = changelog.split('\n')
  const first = lines.findIndex((line) => HEADING.test(line))
  if (first < 0 || !UNRELEASED.test(lines[first])) return null
  const blocks = unreleasedBlocks(lines.slice(first + 1, sectionEnd(lines, first)))
  const toLine = new Set<UnreleasedBlock>()
  const toTrunk = new Set<UnreleasedBlock>()
  const untraced: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'entry') continue
    const pr = entryPullRequest(block.lines.join('\n'))
    if (pr !== null && contains(pr)) toLine.add(block)
    else toTrunk.add(block)
    if (pr === null) untraced.push(block.lines.join('\n'))
  }
  return { line: keptBody(blocks, toLine), trunk: keptBody(blocks, toTrunk), untraced }
}

// Replace the body of the leading `# Unreleased` section (or add one on top); an empty body
// removes the section.
export function withUnreleased(changelog: string, body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return dropUnreleased(changelog)
  const lines = changelog.split('\n')
  const first = lines.findIndex((line) => HEADING.test(line))
  if (first >= 0 && UNRELEASED.test(lines[first])) {
    const end = sectionEnd(lines, first)
    const separated = lines.slice(first + 1, end).join('\n').trim().endsWith('---')
    const section = [lines[first], '', trimmed, ...(separated ? ['', '---'] : []), '']
    const rest = lines.slice(end)
    return [...lines.slice(0, first), ...section, ...(rest.length > 0 ? rest : [''])].join('\n').replace(/\n+$/, '\n')
  }
  return `# Unreleased\n\n${trimmed}\n\n${changelog.replace(/^\n+/, '')}`
}

export function changelogSection(changelog: string, version: string): ChangelogSection | null {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === version)
  if (start < 0) return null
  const body = lines.slice(start + 1, sectionEnd(lines, start)).join('\n').trim().replace(/\n+---$/, '').trim()
  return { heading: lines[start], body }
}

// Carry a released entry onto another branch's changelog: above the first older version, below
// `# Unreleased` and newer versions, and a no-op when the branch already has it.
export function insertChangelogEntry(changelog: string, version: string, entry: string): string {
  const lines = changelog.split('\n')
  if (lines.some((line) => HEADING.exec(line)?.[1] === version)) return changelog
  const at = lines.findIndex((line) => {
    const heading = HEADING.exec(line)?.[1]
    return heading !== undefined && parseStableVersion(heading) !== null && compareStableVersions(heading, version) < 0
  })
  const block = [...entry.trimEnd().split('\n'), '']
  if (at < 0) return `${changelog.trimEnd()}\n\n${block.join('\n')}`
  lines.splice(at, 0, ...block)
  return lines.join('\n')
}

const UPGRADE_WINDOW = /^## (\d+\.\d+\.\d+) → (\d+\.\d+\.\d+) \(([^)]*)\)$/

export function isMinorRelease(version: string): boolean {
  const parsed = parseStableVersion(version)
  return parsed !== null && parsed[2] === 0
}

// The release a minor's upgrade window starts from: the newest x.y.0 tagged below it. Patches of
// older lines carry no window, so they never count.
export function previousMinorRelease(version: string, tags: readonly string[]): string | null {
  return (
    tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.startsWith('v') && isMinorRelease(tag.slice(1)) && compareStableVersions(tag, version) < 0)
      .sort(compareStableVersions)
      .at(-1)
      ?.slice(1) ?? null
  )
}

export function upgradeCompanionSkill(from: string, to: string): string {
  return `om-auto-upgrade-${from}-to-${to}`
}

export function changelogEntryDate(heading: string): string | null {
  return /^# \S+ \((\d{4}-\d{2}-\d{2})\)$/.exec(heading.trim())?.[1] ?? null
}

// A minor ships with an `UPGRADE_NOTES.md` window `from → to` whose marker is the release date the
// changelog entry carries. Stamping it at release time keeps the two in step however long the
// line was stabilised. Returns how many windows matched, so callers can insist on exactly one.
export function stampUpgradeWindow(
  notes: string,
  from: string,
  to: string,
  date: string,
): { text: string; matches: number } {
  let matches = 0
  const lines = notes.split('\n').map((line) => {
    const window = UPGRADE_WINDOW.exec(line)
    if (!window || window[1] !== from || window[2] !== to) return line
    matches += 1
    return `## ${from} → ${to} (${date})`
  })
  return { text: lines.join('\n'), matches }
}
