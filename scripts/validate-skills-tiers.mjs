#!/usr/bin/env node

// Validate .ai/skills/tiers.json against on-disk skill folders.
//
// Checks:
//   1. tiers.json is valid JSON.
//   2. `default` is non-empty and every entry names a defined tier.
//   3. Every folder under .ai/skills/ that contains a SKILL.md file is
//      assigned to exactly one tier — unless its name is listed in
//      `external.skills`, in which case it is a repo-local override of an
//      externally installed skill and must NOT be tiered.
//   4. No skill is assigned to more than one tier.
//   5. No name appears both in a tier and in `external.skills`.
//   6. Every entry in `agents.ignore` names an agent install-skills.mjs knows.

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KNOWN_AGENTS = ['claude-code', 'codex', 'cursor']

function skillFoldersOnDisk(skillsDir) {
  const folders = []
  for (const name of readdirSync(skillsDir)) {
    const candidate = join(skillsDir, name)
    const entry = lstatSync(candidate, { throwIfNoEntry: false })
    if (!entry?.isDirectory()) continue
    if (existsSync(join(candidate, 'SKILL.md'))) folders.push(name)
  }
  return folders.sort()
}

export function validateSkillsTiers(rootDir) {
  const manifestPath = join(rootDir, '.ai', 'skills', 'tiers.json')
  const skillsDir = join(rootDir, '.ai', 'skills')

  if (!existsSync(manifestPath)) {
    return { errors: [`missing manifest ${manifestPath}`] }
  }
  if (!existsSync(skillsDir)) {
    return { errors: [`missing skills directory ${skillsDir}`] }
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return { errors: [`${manifestPath} is not valid JSON.`] }
  }

  const errors = []
  const tiers = manifest.tiers && typeof manifest.tiers === 'object' ? manifest.tiers : {}
  const tierNames = Object.keys(tiers)
  const defaultTiers = Array.isArray(manifest.default) ? manifest.default : []

  if (defaultTiers.length === 0) {
    errors.push(`'default' must contain at least one tier name.`)
  }
  const missingDefault = defaultTiers.filter((name) => !tierNames.includes(name))
  if (missingDefault.length > 0) {
    errors.push(`'default' references undefined tier(s): ${missingDefault.join(', ')}`)
  }

  const assigned = tierNames.flatMap((tier) => (Array.isArray(tiers[tier]?.skills) ? tiers[tier].skills : []))
  const uniqueAssigned = [...new Set(assigned)].sort()
  const multiAssigned = [...new Set(assigned.filter((skill, index) => assigned.indexOf(skill) !== index))].sort()
  const externalSkills = new Set(Array.isArray(manifest.external?.skills) ? manifest.external.skills : [])

  const externalAndTiered = uniqueAssigned.filter((skill) => externalSkills.has(skill))
  if (externalAndTiered.length > 0) {
    errors.push(
      `skill(s) listed both in a tier and in 'external.skills': ${externalAndTiered.join(', ')}\n` +
        `  External skills are installed via npx; remove them from the tier or from external.skills.`,
    )
  }

  const onDisk = skillFoldersOnDisk(skillsDir)
  const unassigned = onDisk.filter((skill) => !externalSkills.has(skill) && !uniqueAssigned.includes(skill))
  if (unassigned.length > 0) {
    errors.push(
      `skill folder(s) on disk but not assigned to any tier: ${unassigned.join(', ')}\n` +
        `  Add them to a tier in .ai/skills/tiers.json, or to external.skills if the folder is a repo-local override of an external skill.`,
    )
  }

  if (multiAssigned.length > 0) {
    errors.push(`skill(s) assigned to more than one tier: ${multiAssigned.join(', ')}`)
  }

  const stale = uniqueAssigned.filter((skill) => !onDisk.includes(skill))
  if (stale.length > 0) {
    errors.push(`tier(s) reference skill folder(s) that do not exist on disk: ${stale.join(', ')}`)
  }

  const unknownAgents = (Array.isArray(manifest.agents?.ignore) ? manifest.agents.ignore : []).filter(
    (agent) => !KNOWN_AGENTS.includes(agent),
  )
  if (unknownAgents.length > 0) {
    errors.push(`'agents.ignore' names unknown agent(s): ${unknownAgents.join(', ')}\n  Valid agents: ${KNOWN_AGENTS.join(' ')}`)
  }

  return { errors, manifest, skillCount: uniqueAssigned.length, tierCount: tierNames.length }
}

const isEntryPoint = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const result = validateSkillsTiers(rootDir)
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`validate-skills-tiers: ${error}`)
    process.exitCode = 1
  } else {
    console.log(`Validated ${result.skillCount} skills across ${result.tierCount} tiers.`)
  }
}
