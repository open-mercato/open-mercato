// Release-line decisions — the pure half of scripts/release-line.mjs (CONTRIBUTING.md § Releasing).
//
// `main` always carries the next minor. Each released minor lives on `release/vX.Y.x` and only
// ever ships patches, so the version of a release is never chosen by hand: a cut moves main to
// the next minor, and a release from a line ships its committed `x.y.0` once, then patches.
// Everything here is side-effect free so the decisions stay unit-testable.

const STABLE = /^v?(\d+)\.(\d+)\.(\d+)$/
const RELEASE_BRANCH = /^(?:refs\/heads\/)?release\/v(\d+)\.(\d+)\.x$/
const HEADING = /^# (\S+)(?:\s.*)?$/
const UNRELEASED = /^# unreleased\b/i

export function parseStableVersion(version) {
  const match = STABLE.exec(String(version ?? '').trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareStableVersions(left, right) {
  const parsedLeft = parseStableVersion(left)
  const parsedRight = parseStableVersion(right)
  if (!parsedLeft || !parsedRight) return parsedLeft ? 1 : parsedRight ? -1 : 0
  for (let index = 0; index < 3; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) return parsedLeft[index] - parsedRight[index]
  }
  return 0
}

export function releaseBranchFor(version) {
  const parsed = parseStableVersion(version)
  return parsed ? `release/v${parsed[0]}.${parsed[1]}.x` : null
}

export function parseReleaseBranch(ref) {
  const match = RELEASE_BRANCH.exec(String(ref ?? '').trim())
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null
}

export function nextMinorVersion(version) {
  const parsed = parseStableVersion(version)
  return parsed ? `${parsed[0]}.${parsed[1] + 1}.0` : null
}

function nextPatchVersion(version) {
  const parsed = parseStableVersion(version)
  return `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}`
}

// What a release from `release/vX.Y.x` publishes: the committed version while no tag names it
// (a fresh line's x.y.0, or a run that died after its bump commit), otherwise the next patch past
// every tag already taken — so a re-run never collides and never skips a version.
export function planRelease({ branch, manifestVersion, tags }) {
  const line = parseReleaseBranch(branch)
  if (!line) return { ok: false, error: `"${branch}" is not a release/vX.Y.x branch` }
  const base = parseStableVersion(manifestVersion)
  if (!base) return { ok: false, error: `manifest version "${manifestVersion}" is not a plain x.y.z` }
  if (base[0] !== line.major || base[1] !== line.minor) {
    return { ok: false, error: `manifest version ${manifestVersion} does not belong to ${branch}` }
  }
  const taken = new Set(tags.map((tag) => tag.trim()))
  let version = String(manifestVersion).trim()
  while (taken.has(`v${version}`)) version = nextPatchVersion(version)
  const previousTag = tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.startsWith('v') && parseStableVersion(tag) && compareStableVersions(tag, version) < 0)
    .sort(compareStableVersions)
    .at(-1)
  return { ok: true, version, bumped: version !== String(manifestVersion).trim(), previousTag: previousTag ?? null }
}

// Only the newest line moves `latest`; a patch to an older line publishes under `latest-X.Y`,
// so `npm i @open-mercato/core` never resolves to a downgrade.
export function resolveStableDistTag(version, currentLatest) {
  const parsed = parseStableVersion(version)
  if (!parsed) throw new Error(`[internal] not a stable version: ${version}`)
  if (!currentLatest || !parseStableVersion(currentLatest)) return 'latest'
  return compareStableVersions(version, currentLatest) >= 0 ? 'latest' : `latest-${parsed[0]}.${parsed[1]}`
}

export function stampManifestVersion(source, version) {
  const manifest = JSON.parse(source)
  if (manifest.version === version) return source
  return `${JSON.stringify({ ...manifest, version }, null, 2)}\n`
}

function sectionBounds(lines, start) {
  const next = lines.findIndex((line, index) => index > start && HEADING.test(line))
  return next < 0 ? lines.length : next
}

// The entry a release ships with. A hand-written one wins: an existing `# <version>` heading is
// kept and a leading `# Unreleased` is renamed; only when neither exists are the generated notes
// used.
export function ensureChangelogEntry(changelog, version, date, notes) {
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
export function dropUnreleased(changelog) {
  const lines = changelog.split('\n')
  const first = lines.findIndex((line) => HEADING.test(line))
  if (first < 0 || !UNRELEASED.test(lines[first])) return changelog
  const end = sectionBounds(lines, first)
  return [...lines.slice(0, first), ...lines.slice(end)].join('\n').replace(/^\n+/, '')
}

export function changelogSection(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === version)
  if (start < 0) return null
  const body = lines.slice(start + 1, sectionBounds(lines, start)).join('\n').trim().replace(/\n+---$/, '').trim()
  return { heading: lines[start], body }
}

// Carry a released entry onto another branch's changelog: above the first older version, below
// `# Unreleased` and newer versions, and a no-op when the branch already has it.
export function insertChangelogEntry(changelog, version, entry) {
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
