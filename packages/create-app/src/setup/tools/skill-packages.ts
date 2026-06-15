// Pure helpers for the standalone skill-package manifest (packages.json).
// No filesystem access here — the loader lives in shared.ts. Keeping selection
// logic pure makes it unit-testable without scaffolding a temp app.

export const CORE_PACKAGE = 'core'

export interface SkillPackage {
  description: string
  skills: string[]
  extraFiles?: string[]
}

export interface SkillPackageManifest {
  default: string[]
  packages: Record<string, SkillPackage>
}

export interface ResolvedSkillSelection {
  /** Effective package names: core forced first, then the valid requested ones, deduped. */
  packages: string[]
  /** Skill folder names to copy (under .ai/skills/). */
  skills: string[]
  /** Package-owned extra files to ship for the selected packages (relative to .ai/skills/). */
  includeExtraFiles: string[]
  /** Every package's extra files — skipped during folder copy unless explicitly included. */
  gatedFiles: string[]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/** Normalize raw CSV / user input into clean, deduped, lower-cased package names. */
export function parseSkillPackagesInput(raw: string): string[] {
  return unique(
    raw
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0),
  )
}

/** Return the requested names that are not defined in the manifest (for friendly CLI errors). */
export function findUnknownPackages(requested: string[], manifest: SkillPackageManifest): string[] {
  const known = new Set(Object.keys(manifest.packages))
  return requested.filter((name) => !known.has(name))
}

/**
 * Resolve which skill folders and extra files to ship.
 * `core` is always included. Unknown names are ignored (validate upstream for errors).
 */
export function resolveSkillSelection(
  requested: string[],
  manifest: SkillPackageManifest,
): ResolvedSkillSelection {
  const known = manifest.packages
  const effective = unique([CORE_PACKAGE, ...requested]).filter((name) => name in known)

  const skills: string[] = []
  const includeExtraFiles: string[] = []
  for (const name of effective) {
    const pkg = known[name]
    skills.push(...pkg.skills)
    if (pkg.extraFiles) includeExtraFiles.push(...pkg.extraFiles)
  }

  const gatedFiles: string[] = []
  for (const pkg of Object.values(known)) {
    if (pkg.extraFiles) gatedFiles.push(...pkg.extraFiles)
  }

  return {
    packages: effective,
    skills: unique(skills),
    includeExtraFiles: unique(includeExtraFiles),
    gatedFiles: unique(gatedFiles),
  }
}
