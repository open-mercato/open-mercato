#!/usr/bin/env node

// Cross-platform skill installer (Node port of the former POSIX-only
// install-skills.sh; the .sh file remains as a thin compatibility wrapper).
//
// Skills live in ONE canonical place — the cross-agent directory
// .agents/skills/ — and two sources are mixed into it:
//
//   1. Local tiered skills: reads .ai/skills/tiers.json (validated by
//      scripts/validate-skills-tiers.mjs) and links each selected skill into
//      .agents/skills/<name> -> .ai/skills/<name>.
//   2. External shared skills: installs the open-mercato/skills collection via
//      `npx skills add` into the same .agents/skills/ directory, then runs
//      `npx skills update` so a re-run always refreshes the already installed
//      external skills to the latest published versions (the lockfile is
//      gitignored, so `add` seeds and `update` keeps them current).
//      The external source and skill list live under `external` in tiers.json.
//      A folder under .ai/skills/ matching an external skill name is a
//      repo-local override that the external skill reads in place; it is never
//      linked into the canonical or per-agent directories.
//
// Agent support matrix. Per-agent links are created ONLY for agents that
// cannot read the canonical project-level .agents/skills/ directory, so no
// skill is duplicated across agent folders without reason:
//
//   agent id     project directory   reads .agents/skills/   per-agent links
//   claude-code  .claude/skills      no                      yes (written by this script)
//   codex        .codex/skills       yes                     no
//   cursor       .cursor/skills      yes                     no
//
// The "reads .agents/skills/" column follows the universal-agent list of the
// `skills` CLI (vercel-labs/skills). Re-check it when an agent gains support:
// an agent that cannot read the canonical directory MUST keep its links, or
// its skills silently disappear.
//
// Links are relative directory symlinks on POSIX and directory junctions on
// Windows (junctions need no elevation or Developer Mode). External commands
// are spawned through `process.execPath` + npm's npx-cli.js, never through a
// `.cmd` shim looked up on PATH (cmd.exe decodes batch files with the OEM code
// page, which breaks on non-ASCII checkout paths).

import {
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNodeBundledCli, runCli } from './lib/spawn-cli.mjs'
import { KNOWN_AGENTS, validateSkillsTiers } from './validate-skills-tiers.mjs'

const AGENT_DIRECTORIES = {
  'claude-code': ['.claude', 'skills'],
  codex: ['.codex', 'skills'],
  cursor: ['.cursor', 'skills'],
}
const CANONICAL_READERS = ['codex', 'cursor']
const LEGACY_AGENTS = ['claude-code', 'codex']

const USAGE = `Usage: install-skills [options]

Options:
  (no options)        Install the default tier set from .ai/skills/tiers.json
                      plus the external open-mercato/skills collection into the
                      canonical .agents/skills/ directory. Agents that cannot
                      read it (Claude Code) also get per-skill links.
  --with <csv>        Install default tiers plus the given tier names (additive).
  --tiers <csv>       Install exactly the given tier names (replaces default).
  --all               Install every tier defined in tiers.json.
  --legacy-links      Restore the pre-canonical layout: link every skill into
                      .claude/skills/ AND .codex/skills/, even for agents that
                      read .agents/skills/ natively.
  --ignore-agents <csv>
                      Never write these agents' directories (claude-code, codex,
                      cursor). Defaults to \`agents.ignore\` in tiers.json; this
                      flag overrides it.
  --no-external       Skip the external-collection step for the external
                      collection — \`npx skills add\` on first run and
                      \`npx skills update\` on re-runs (also:
                      OM_SKIP_EXTERNAL_SKILLS=1). Use when offline.
  --list              Print the tier table, the external shared collection,
                      and the current install state, then exit.
  --clean             Remove all skill links (local and external) and exit.
  --help, -h          Show this message.

--with, --tiers, and --all are mutually exclusive.`

function fail(message) {
  throw new Error(`install-skills: ${message}`)
}

function unique(values) {
  return [...new Set(values)]
}

function csv(value) {
  return unique(String(value).split(',').map((entry) => entry.trim()).filter(Boolean))
}

export function parseArgs(args, env = {}) {
  const skipExternal = env.OM_SKIP_EXTERNAL_SKILLS
  const options = {
    mode: 'default',
    tierValues: [],
    list: false,
    clean: false,
    legacyLinks: false,
    ignoreAgents: undefined,
    noExternal: Boolean(skipExternal && skipExternal !== '0'),
    help: false,
  }
  let selectionFlag
  const selectMode = (flag) => {
    if (selectionFlag && selectionFlag !== flag) fail('--with, --tiers, and --all are mutually exclusive.')
    selectionFlag = flag
    options.mode = flag === '--all' ? 'all' : flag === '--with' ? 'with' : 'tiers'
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--list') options.list = true
    else if (arg === '--clean') options.clean = true
    else if (arg === '--no-external') options.noExternal = true
    else if (arg === '--legacy-links') options.legacyLinks = true
    else if (arg === '--all') selectMode('--all')
    else if (arg === '--with' || arg === '--tiers' || arg === '--ignore-agents') {
      const value = args[index + 1]
      if (value === undefined) fail(`${arg} requires a comma-separated list.`)
      index += 1
      if (arg === '--ignore-agents') options.ignoreAgents = csv(value)
      else {
        selectMode(arg)
        options.tierValues = csv(value)
        if (options.tierValues.length === 0) fail(`${arg} requires at least one tier name.`)
      }
    } else if (arg.startsWith('--with=') || arg.startsWith('--tiers=') || arg.startsWith('--ignore-agents=')) {
      const [flag, value = ''] = arg.split(/=(.*)/s, 2)
      if (flag === '--ignore-agents') options.ignoreAgents = csv(value)
      else {
        selectMode(flag)
        options.tierValues = csv(value)
        if (options.tierValues.length === 0) fail(`${flag} requires at least one tier name.`)
      }
    } else fail(`unknown option '${arg}'`)
  }
  return options
}

function isWithin(candidate, root) {
  let child = resolve(candidate)
  let parent = resolve(root)
  if (process.platform === 'win32') {
    child = child.toLowerCase()
    parent = parent.toLowerCase()
  }
  const pathFromRoot = relative(parent, child)
  return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
}

// Follow the full link chain (`readlink -f`): per-agent links point into the
// canonical directory whose entries are themselves links into .ai/skills/.
function finalTarget(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function isLink(path) {
  return Boolean(lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
}

function createLink(linkPath, targetAbs, platform, warn) {
  const entry = lstatSync(linkPath, { throwIfNoEntry: false })
  if (entry) {
    if (!entry.isSymbolicLink()) {
      warn(`install-skills: warning: refusing to replace non-link path ${linkPath}`)
      return
    }
    unlinkSync(linkPath)
  }
  if (platform === 'win32') {
    symlinkSync(resolve(targetAbs), linkPath, 'junction')
  } else {
    const relativeTarget = relative(dirname(linkPath), targetAbs).split(sep).join('/')
    symlinkSync(relativeTarget, linkPath, 'dir')
  }
}

function listEntries(directory, { includeHidden = false } = {}) {
  const entry = lstatSync(directory, { throwIfNoEntry: false })
  if (!entry?.isDirectory() || entry.isSymbolicLink()) return []
  return readdirSync(directory).filter((name) => includeHidden || !name.startsWith('.'))
}

export function createInstaller({
  rootDir,
  platform = process.platform,
  log = console.log,
  warn = (message) => console.error(message),
  runNpx = defaultRunNpx,
} = {}) {
  const repoRoot = resolve(rootDir)
  const skillsDir = join(repoRoot, '.ai', 'skills')
  const agentsDir = join(repoRoot, '.agents', 'skills')
  const realSkillsDir = () => finalTarget(skillsDir) ?? skillsDir
  const realAgentsDir = () => finalTarget(agentsDir) ?? agentsDir

  const agentDir = (agent) => join(repoRoot, ...AGENT_DIRECTORIES[agent])

  const resolvesIntoSkillsDir = (linkPath) => {
    const target = finalTarget(linkPath)
    return Boolean(target && isWithin(target, realSkillsDir()) && resolve(target) !== resolve(realSkillsDir()))
  }

  const resolvesIntoAgentsDir = (linkPath) => {
    const target = finalTarget(linkPath)
    return Boolean(target && isWithin(target, realAgentsDir()) && resolve(target) !== resolve(realAgentsDir()))
  }

  function cleanHarness(harnessDir) {
    const entry = lstatSync(harnessDir, { throwIfNoEntry: false })
    if (!entry) return
    if (entry.isSymbolicLink()) {
      // Legacy layout: the whole directory was a link to .ai/skills/.
      if (finalTarget(harnessDir) === realSkillsDir()) unlinkSync(harnessDir)
      return
    }
    if (!entry.isDirectory()) return
    for (const name of listEntries(harnessDir, { includeHidden: true })) {
      const candidate = join(harnessDir, name)
      if (isLink(candidate) && (resolvesIntoSkillsDir(candidate) || resolvesIntoAgentsDir(candidate))) {
        unlinkSync(candidate)
      }
    }
    if (readdirSync(harnessDir).length === 0) rmdirSync(harnessDir)
  }

  function prepareHarnessDir(harnessDir) {
    mkdirSync(dirname(harnessDir), { recursive: true })
    if (isLink(harnessDir)) unlinkSync(harnessDir)
    mkdirSync(harnessDir, { recursive: true })
  }

  function sweepHarness(harnessDir, selected) {
    const keep = new Set(selected)
    for (const name of listEntries(harnessDir)) {
      const candidate = join(harnessDir, name)
      if (isLink(candidate) && !keep.has(name) && resolvesIntoSkillsDir(candidate)) unlinkSync(candidate)
    }
  }

  // Drop links to skills the external collection no longer ships: their target
  // under .agents/skills/ is gone, so the link dangles.
  function pruneBrokenLinks(harnessDir) {
    for (const name of listEntries(harnessDir)) {
      const candidate = join(harnessDir, name)
      if (isLink(candidate) && finalTarget(candidate) === null) unlinkSync(candidate)
    }
  }

  function installCanonical(selectedSkills, externalSkills) {
    prepareHarnessDir(agentsDir)
    for (const skill of selectedSkills) {
      if (externalSkills.includes(skill)) {
        // Owned by the external collection; a same-named .ai/skills/ folder is a
        // repo-local override and must not shadow the npx-installed skill.
        warn(`install-skills: warning: '${skill}' is an external skill; skipping local link.`)
        continue
      }
      const skillTarget = join(skillsDir, skill)
      const entry = lstatSync(skillTarget, { throwIfNoEntry: false })
      if (!entry?.isDirectory()) fail(`skill folder '${skillTarget}' is missing on disk.`)
      createLink(join(agentsDir, skill), skillTarget, platform, warn)
    }
    sweepHarness(agentsDir, selectedSkills)
  }

  // Mirror every external skill (a real directory under the canonical dir) into
  // an agent's own directory. Local tier skills are links and are skipped here.
  function linkExternalSkills(harnessDir) {
    for (const name of listEntries(agentsDir)) {
      const candidate = join(agentsDir, name)
      const entry = lstatSync(candidate, { throwIfNoEntry: false })
      if (!entry?.isDirectory() || entry.isSymbolicLink()) continue
      createLink(join(harnessDir, name), candidate, platform, warn)
    }
  }

  // Link layer for agents that cannot read the canonical directory. Two kinds
  // of skill live there and both must be linked: local tier skills (links into
  // .ai/skills/) and external skills (real directories the skills CLI copies
  // in). The script owns this layer end to end — `npx skills add --agent <id>`
  // only writes it reliably for a pre-existing agent directory (see
  // vercel-labs/skills#744).
  function installAgentLinks(agent, selectedSkills, externalSkills, legacyLinks) {
    const harnessDir = agentDir(agent)
    prepareHarnessDir(harnessDir)
    for (const skill of selectedSkills) {
      if (externalSkills.includes(skill)) continue
      const target = legacyLinks ? join(skillsDir, skill) : join(agentsDir, skill)
      createLink(join(harnessDir, skill), target, platform, warn)
    }
    linkExternalSkills(harnessDir)
    sweepHarness(harnessDir, selectedSkills)
    pruneBrokenLinks(harnessDir)
  }

  function installedLocalSkills() {
    const installed = []
    for (const name of listEntries(agentsDir)) {
      const candidate = join(agentsDir, name)
      if (isLink(candidate) && resolvesIntoSkillsDir(candidate)) installed.push(name)
    }
    return installed.sort()
  }

  function installedExternalCount() {
    let count = 0
    for (const name of listEntries(agentsDir)) {
      const candidate = join(agentsDir, name)
      const entry = lstatSync(candidate, { throwIfNoEntry: false })
      if (entry?.isDirectory() && !entry.isSymbolicLink()) count += 1
    }
    return count
  }

  function printList(manifest) {
    const tierNames = Object.keys(manifest.tiers)
    for (const tier of tierNames) {
      const skills = manifest.tiers[tier].skills
      const label = manifest.default.includes(tier) ? 'default' : 'opt-in'
      log(`${tier.padEnd(12)} (${skills.length} skills, ${label}):`)
      log(`  ${skills.join(', ')}`)
    }
    const externalSource = manifest.external?.source
    const externalSkills = manifest.external?.skills ?? []
    if (externalSource) {
      log(`${'external'.padEnd(12)} (${externalSkills.length} skills, from ${externalSource}):`)
      log(`  ${externalSkills.join(', ')}`)
    }
    const installed = installedLocalSkills()
    log('')
    if (installed.length === 0) {
      log('Currently installed: none (0 local skills)')
    } else {
      const installedTiers = tierNames.filter((tier) => manifest.tiers[tier].skills.every((skill) => installed.includes(skill)))
      log(`Currently installed: ${installedTiers.join(', ') || 'unknown'} (${installed.length} local skills)`)
    }
    if (externalSource) {
      const externalCount = installedExternalCount()
      if (externalCount === 0) {
        log(`External skills installed: none (run \`yarn install-skills\` to fetch from ${externalSource})`)
      } else {
        log(`External skills installed: ${externalCount} from ${externalSource} (under .agents/skills/)`)
      }
    }
  }

  // Mix in the external shared collection (open-mercato/skills). The npx CLI
  // copies each skill into .agents/skills/. This runs BEFORE the link layer is
  // written: `skills update --project` owns .agents/skills/ and would otherwise
  // prune entries it does not know about.
  function installExternal(manifest, linkAgents, noExternal) {
    const source = manifest.external?.source
    if (!source) return 'none'
    if (noExternal) return 'skipped (--no-external)'
    const agentArgs = linkAgents.length > 0
      ? linkAgents.flatMap((agent) => ['--agent', agent])
      : ['--agent', 'universal']
    const addResult = runNpx(['-y', 'skills', 'add', source, '--skill', '*', ...agentArgs, '-y'], repoRoot)
    if (addResult === null) {
      warn(`install-skills: warning: npx not found; skipping external skills from ${source}.`)
      return 'skipped (npx not found)'
    }
    if (!addResult) {
      warn(`install-skills: warning: installing external skills from ${source} failed;`)
      warn('  local tier skills are installed. Re-run when online, or pass --no-external to silence this.')
      return 'FAILED'
    }
    // `add` seeds the collection (and re-resolves on a fresh checkout), but on a
    // clone that already has the skills a follow-up `update` guarantees they are
    // bumped to the latest published versions — the point of a re-run. The
    // lockfile is gitignored, so this is how contributors pick up new skills and
    // fixes without a manual reinstall. Non-fatal when offline mid-run: the
    // freshly added skills stay installed.
    if (runNpx(['-y', 'skills', 'update', '--project', '-y'], repoRoot)) {
      return `updated to latest from ${source}`
    }
    warn('install-skills: warning: could not update external skills to latest;')
    warn('  the installed versions are kept. Re-run when online to refresh.')
    return `installed from ${source}`
  }

  function run(args = [], env = process.env) {
    const options = parseArgs(args, env)
    if (options.help) {
      log(USAGE)
      return 0
    }

    const validation = validateSkillsTiers(repoRoot)
    if (validation.errors.length > 0) {
      for (const error of validation.errors) warn(`validate-skills-tiers: ${error}`)
      fail('tier manifest validation failed; aborting.')
    }
    const manifest = validation.manifest

    if (options.list) {
      printList(manifest)
      return 0
    }

    if (options.clean) {
      // Sweep every known agent directory (both the canonical link layer and any
      // leftovers from the legacy per-agent layout), then the canonical directory.
      for (const agent of KNOWN_AGENTS) cleanHarness(agentDir(agent))
      const agentsEntry = lstatSync(agentsDir, { throwIfNoEntry: false })
      if (agentsEntry) {
        if (agentsEntry.isSymbolicLink()) unlinkSync(agentsDir)
        else rmSync(agentsDir, { recursive: true, force: true })
        log('info: removed skills under .agents/skills/.')
      }
      log('info: removed all skill links under .claude/skills/, .codex/skills/ and .cursor/skills/.')
      return 0
    }

    const allTierNames = Object.keys(manifest.tiers)
    const ignoredAgents = options.ignoreAgents ?? manifest.agents?.ignore ?? []
    for (const agent of ignoredAgents) {
      if (!KNOWN_AGENTS.includes(agent)) fail(`unknown agent '${agent}'.\n  Valid agents: ${KNOWN_AGENTS.join(' ')}`)
    }

    let selectedTiers
    if (options.mode === 'all') selectedTiers = allTierNames
    else if (options.mode === 'tiers') selectedTiers = options.tierValues
    else selectedTiers = [...manifest.default, ...(options.mode === 'with' ? options.tierValues : [])]
    selectedTiers = unique(selectedTiers)
    for (const tier of selectedTiers) {
      if (!manifest.tiers[tier]) fail(`unknown tier '${tier}'.\n  Valid tiers: ${allTierNames.join(' ')}`)
    }

    const selectedSkills = unique(selectedTiers.flatMap((tier) => manifest.tiers[tier].skills))
    if (selectedSkills.length === 0) fail('no skills selected for installation.')
    const externalSkills = manifest.external?.skills ?? []

    // Agents that get their own per-skill links: in the default layout only the
    // ones that cannot read .agents/skills/; with --legacy-links the historical pair.
    const linkAgents = KNOWN_AGENTS.filter((agent) => {
      if (ignoredAgents.includes(agent)) return false
      if (options.legacyLinks) return LEGACY_AGENTS.includes(agent)
      return !CANONICAL_READERS.includes(agent)
    })

    const externalStatus = installExternal(manifest, linkAgents, options.noExternal)

    installCanonical(selectedSkills, externalSkills)

    for (const agent of KNOWN_AGENTS) {
      if (linkAgents.includes(agent)) {
        installAgentLinks(agent, selectedSkills, externalSkills, options.legacyLinks)
      } else {
        // Not a link target (reads the canonical directory, or ignored): drop any
        // stale links left behind by the legacy per-agent layout.
        cleanHarness(agentDir(agent))
      }
    }

    log(`Installed ${selectedSkills.length} local skills across ${selectedTiers.length} tiers: ${selectedTiers.join(', ')}.`)
    if (externalStatus !== 'none') log(`External skills: ${externalStatus}.`)
    if (linkAgents.length === 0) log('Layout: .agents/skills/ (canonical); no per-agent links.')
    else log(`Layout: .agents/skills/ (canonical); per-agent links: ${linkAgents.join(', ')}.`)

    if (options.mode === 'default') {
      log('Tip: opt into more skills with `yarn install-skills --with automation` or `--all`.')
      log('     See `yarn install-skills --list` for the full catalog.')
    }
    return 0
  }

  return { run }
}

function defaultRunNpx(npxArgs, cwd) {
  const invocation = resolveNodeBundledCli('npx')
  if (!invocation) return null
  return runCli(invocation, npxArgs, { cwd })
}

const isEntryPoint = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    process.exitCode = createInstaller({ rootDir }).run(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
