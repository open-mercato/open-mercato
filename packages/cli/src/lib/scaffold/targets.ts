/**
 * Monorepo target resolution for `mercato module scaffold` (spec:
 * .ai/specs/2026-07-05-ds-module-ui-scaffold.md §CLI contract, `--target`).
 */
import path from 'node:path'
import type { PackageResolver } from '../resolver'

export type ScaffoldTargetKind = 'app' | 'packages/core'

export const SCAFFOLD_TARGETS: ScaffoldTargetKind[] = ['app', 'packages/core']

export type ScaffoldTarget = {
  kind: ScaffoldTargetKind
  /** Absolute path of the modules root the module directory lives under. */
  modulesRoot: string
  /** Absolute path of the module directory to scaffold into. */
  moduleDir: string
  /** `from` value for the modules.ts registration entry in the next-steps block. */
  registrationFrom: '@app' | '@open-mercato/core'
}

export class ScaffoldTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScaffoldTargetError'
  }
}

export function resolveScaffoldTarget(
  resolver: PackageResolver,
  target: string,
  moduleId: string,
): ScaffoldTarget {
  if (!resolver.isMonorepo()) {
    // PHASE-3 SEAM (standalone target resolution): in a standalone create-app
    // consumer the default and only target is `src/modules/<module_id>/` under
    // the app dir (`resolver.getAppDir()`), detected the same way
    // `createResolver()` detects `node_modules/@open-mercato/*/dist/modules/`.
    // Wire it here when Phase 3 lands; until then the command is monorepo-only.
    throw new ScaffoldTargetError(
      'module scaffold currently supports monorepo checkouts only — standalone app support lands in a later phase.',
    )
  }

  if (target === 'app') {
    const modulesRoot = path.join(resolver.getAppDir(), 'src', 'modules')
    return {
      kind: 'app',
      modulesRoot,
      moduleDir: path.join(modulesRoot, moduleId),
      registrationFrom: '@app',
    }
  }

  if (target === 'packages/core') {
    const modulesRoot = path.join(resolver.getRootDir(), 'packages', 'core', 'src', 'modules')
    return {
      kind: 'packages/core',
      modulesRoot,
      moduleDir: path.join(modulesRoot, moduleId),
      registrationFrom: '@open-mercato/core',
    }
  }

  throw new ScaffoldTargetError(
    `Unknown --target "${target}" — supported targets: ${SCAFFOLD_TARGETS.join(', ')}.`,
  )
}
