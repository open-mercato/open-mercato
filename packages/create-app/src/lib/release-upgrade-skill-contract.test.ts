import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const changelogOverride = fs.readFileSync(
  new URL('../../../../.ai/skills/om-auto-update-changelog/SKILL.md', import.meta.url),
  'utf8',
)

type TierManifest = {
  tiers?: Record<string, { skills?: string[] }>
}

test('the changelog override owns deterministic upgrade-window reconciliation', () => {
  assert.match(changelogOverride, /whose `<from>` equals the changelog release immediately below/)
  assert.match(changelogOverride, /semantic-version equality, not substring matching/)
  assert.match(changelogOverride, /More than one candidate, or a second section already targeting/)
  assert.match(changelogOverride, /Stop before edits and report the conflicting headings/)
  assert.match(changelogOverride, /An already aligned heading is an idempotent no-op/)
})

test('the changelog override requires a dual-surface migration companion', () => {
  assert.match(changelogOverride, /\.ai\/skills\/<skill>\/SKILL\.md/)
  assert.match(
    changelogOverride,
    /packages\/create-app\/agentic\/shared\/ai\/skills\/<skill>\/SKILL\.md.*byte-identical/,
  )
  assert.match(changelogOverride, /\.ai\/skills\/tiers\.json.*under `migration`/)
  assert.match(
    changelogOverride,
    /packages\/create-app\/agentic\/shared\/ai\/skills\/tiers\.json.*under `migration`/,
  )
  assert.match(changelogOverride, /Automatic.*Detect and report.*No code action/s)
})

test('the changelog override preserves dry-run and validation safety', () => {
  assert.match(changelogOverride, /With `--dry-run`/)
  assert.match(changelogOverride, /without editing any file or invoking `om-auto-create-pr`/)
  assert.match(changelogOverride, /bash scripts\/validate-skills-tiers\.sh/)
  assert.match(changelogOverride, /yarn workspace create-mercato-app test/)
})

test('the latest changelog upgrade window ships one aligned companion in both agent surfaces', () => {
  const changelog = fs.readFileSync(new URL('../../../../CHANGELOG.md', import.meta.url), 'utf8')
  const upgradeNotes = fs.readFileSync(new URL('../../../../UPGRADE_NOTES.md', import.meta.url), 'utf8')
  const changelogReleases = Array.from(
    changelog.matchAll(/^# (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/gm),
    (match) => ({ version: match[1], date: match[2] }),
  )
  const currentRelease = changelogReleases[0]
  const previousRelease = changelogReleases[1]
  assert.ok(currentRelease, 'CHANGELOG.md must have a current release heading')
  assert.ok(previousRelease, 'CHANGELOG.md must have a previous release heading')

  const upgradeWindows = Array.from(
    upgradeNotes.matchAll(/^## (\d+\.\d+\.\d+) → (\d+\.\d+\.\d+) \(([^)]+)\)$/gm),
    (match) => ({ fromVersion: match[1], toVersion: match[2], releaseMarker: match[3] }),
  )
  const matchingWindows = upgradeWindows.filter(
    (window) => window.fromVersion === previousRelease.version,
  )
  assert.equal(
    matchingWindows.length,
    1,
    `expected one upgrade window starting at ${previousRelease.version}`,
  )
  const matchingWindow = matchingWindows[0]
  assert.ok(matchingWindow, 'matching upgrade window must be present')
  assert.equal(matchingWindow.toVersion, currentRelease.version)
  assert.equal(matchingWindow.releaseMarker, currentRelease.date)

  const skillName = `om-auto-upgrade-${matchingWindow.fromVersion}-to-${matchingWindow.toVersion}`
  const monorepoSkill = fs.readFileSync(
    new URL(`../../../../.ai/skills/${skillName}/SKILL.md`, import.meta.url),
    'utf8',
  )
  const standaloneSkill = fs.readFileSync(
    new URL(`../../agentic/shared/ai/skills/${skillName}/SKILL.md`, import.meta.url),
    'utf8',
  )
  assert.equal(standaloneSkill, monorepoSkill, `${skillName} must stay byte-identical`)
  assert.match(monorepoSkill, new RegExp(`^name: ${skillName}$`, 'm'))

  const monorepoManifest = JSON.parse(
    fs.readFileSync(new URL('../../../../.ai/skills/tiers.json', import.meta.url), 'utf8'),
  ) as TierManifest
  const standaloneManifest = JSON.parse(
    fs.readFileSync(new URL('../../agentic/shared/ai/skills/tiers.json', import.meta.url), 'utf8'),
  ) as TierManifest
  assert.ok(monorepoManifest.tiers?.migration?.skills?.includes(skillName))
  assert.ok(standaloneManifest.tiers?.migration?.skills?.includes(skillName))
})
