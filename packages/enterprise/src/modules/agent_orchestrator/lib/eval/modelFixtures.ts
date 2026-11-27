import { readRegularFixtureFile } from './fixtureFileRead'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { fixtureFileSegment, type EvalToolFixtureCaseRef } from './toolFixtures'
import { modelRecordingSchema, createModelReplaySession, ModelReplayError } from './modelReplay'

const MAX_BYTES = 5 * 1024 * 1024
export const modelFixtureFileSchema = z.object({
  format: z.literal('open-mercato.agent-eval-model-fixtures'),
  formatVersion: z.literal(1),
  agentId: z.string().min(1).max(100),
  caseKey: z.string().min(1).max(200),
  trialIndex: z.number().int().nonnegative(),
  containsTenantData: z.literal(true),
  recordings: z.array(modelRecordingSchema).max(1000),
}).strict()

export type EvalModelFixtureOptions = {
  mode: 'record' | 'replay'
  directory?: string
  evalSetDir?: string | null
  /** Replay only cases that declare `fixtures.model`; every other case calls the live model. */
  declaredOnly?: boolean
}

export function modelFixturesForCase(
  options: EvalModelFixtureOptions | undefined,
  ref: Pick<EvalToolFixtureCaseRef, 'fixturePath'>,
): EvalModelFixtureOptions | undefined {
  if (!options?.declaredOnly || ref.fixturePath) return options
  return undefined
}

function inside(base: string, target: string): boolean {
  const relative = path.relative(base, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function fixturePath(options: EvalModelFixtureOptions, ref: EvalToolFixtureCaseRef): { base: string; file: string } {
  if (options.directory) {
    const base = path.resolve(options.directory)
    return { base, file: path.join(base, fixtureFileSegment(ref.agentId), `${fixtureFileSegment(ref.caseKey)}.${ref.trialIndex}.model.json`) }
  }
  if (!options.evalSetDir || !ref.fixturePath) throw new ModelReplayError('model_fixture_missing')
  const base = path.resolve(options.evalSetDir)
  const file = path.resolve(base, ref.fixturePath)
  if (!inside(base, file)) throw new ModelReplayError('model_fixture_path_invalid')
  return { base, file }
}

export async function withCaseModelFixtures<T>(
  options: EvalModelFixtureOptions | undefined,
  ref: EvalToolFixtureCaseRef,
  run: () => Promise<T>,
): Promise<T> {
  options = modelFixturesForCase(options, ref)
  if (!options) return run()
  const { base, file } = fixturePath(options, ref)
  let recordings: z.infer<typeof modelRecordingSchema>[] = []
  if (options.mode === 'replay') {
    try {
      if (!inside(fs.realpathSync(base), fs.realpathSync(file))) throw new ModelReplayError('model_fixture_path_invalid')
      const parsed = modelFixtureFileSchema.parse(JSON.parse(readRegularFixtureFile(file, MAX_BYTES)))
      if (parsed.agentId !== ref.agentId || parsed.caseKey !== ref.caseKey || parsed.trialIndex !== ref.trialIndex) {
        throw new ModelReplayError('model_fixture_identity_mismatch')
      }
      recordings = parsed.recordings
    } catch (error) {
      if (error instanceof ModelReplayError) throw error
      throw new ModelReplayError('model_fixture_invalid_or_missing')
    }
  }
  const session = createModelReplaySession(options.mode, recordings)
  const result = await session.run(run)
  session.assertComplete()
  if (options.mode === 'record') {
    const payload = JSON.stringify(modelFixtureFileSchema.parse({
      format: 'open-mercato.agent-eval-model-fixtures', formatVersion: 1,
      agentId: ref.agentId, caseKey: ref.caseKey, trialIndex: ref.trialIndex,
      containsTenantData: true, recordings: session.recorded,
    }), null, 2)
    if (Buffer.byteLength(payload) > MAX_BYTES) throw new ModelReplayError('model_fixture_too_large')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!inside(fs.realpathSync(base), fs.realpathSync(path.dirname(file)))) throw new ModelReplayError('model_fixture_path_invalid')
    const temporary = path.join(path.dirname(file), `.model-${randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporary, payload, { flag: 'wx', mode: 0o600 })
      fs.renameSync(temporary, file)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  }
  return result
}

export function parseEvalCliModelFixtureFlags(flags: {
  offline?: string
  record?: string
  replay?: string
  onFixtureMiss?: string
  evalSetDir?: string | null
  repeatCount?: number
  casesFile?: { cases: ReadonlyArray<{ fixtures?: { model?: string } | null }> } | null
}): { ok: true; options?: EvalModelFixtureOptions } | { ok: false; message: string } {
  if (flags.offline !== undefined && flags.offline !== 'true' && flags.offline !== 'false') {
    return { ok: false, message: '--offline takes true or false' }
  }
  const implicitReplay = flags.casesFile?.cases.some((entry) => entry.fixtures?.model)
  if (flags.offline === 'true' && (flags.record || flags.onFixtureMiss === 'live' || (!flags.replay && !implicitReplay))) {
    return { ok: false, message: '--offline true requires --replay <dir> or fixtures.model, and forbids --record and live fixture fallback' }
  }
  if (flags.record) return { ok: true, options: { mode: 'record', directory: flags.record } }
  if (implicitReplay && !flags.replay && (flags.repeatCount ?? 1) > 1) {
    return { ok: false, message: '--repeat greater than 1 cannot be combined with cases that declare fixtures.model: a fixtures.model file holds one recorded trial. Use --repeat 1, or record and replay per-trial files with --record <dir> / --replay <dir>' }
  }
  if (flags.offline === 'true' || implicitReplay) {
    if (flags.onFixtureMiss === 'live') return { ok: false, message: 'Model replay forbids live tool fixture fallback' }
    return {
      ok: true,
      options: {
        mode: 'replay', directory: flags.replay, evalSetDir: flags.evalSetDir,
        ...(flags.offline === 'true' ? {} : { declaredOnly: true }),
      },
    }
  }
  return { ok: true }
}
