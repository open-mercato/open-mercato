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
