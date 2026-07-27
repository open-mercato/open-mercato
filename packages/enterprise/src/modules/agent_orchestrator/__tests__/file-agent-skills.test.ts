import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadFileAgentDir } from '../lib/sdk/defineFileAgent'

// Phase 3: an agent-local skill authored under agents/<id>/skills/<skill_id>/
// must (1) load its instructions/template/examples content, and (2) union its
// read-only tools into the agent's effective allowlist (entry.tools).
function makeAgentDir(opts: {
  skills?: string
  skill?: { dir: string; skillMd: string; template?: string; examples?: Record<string, string> }
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-skill-'))
  fs.writeFileSync(
    path.join(dir, 'AGENT.md'),
    [
      '---',
      'id: deals.health_check',
      'label: Deal health check',
      'description: Assess a deal.',
      ...(opts.skills ? [`skills: ${opts.skills}`] : []),
      'tools: [customers.get_deal]',
      '---',
      'You assess a deal.',
    ].join('\n'),
    'utf8',
  )
  fs.writeFileSync(
    path.join(dir, 'OUTCOME.md'),
    [
      '---',
      'kind: actionable',
      '---',
      '```json',
      JSON.stringify({
        type: 'object',
        required: ['confidence'],
        properties: { confidence: { type: 'number', minimum: 0, maximum: 1 } },
      }),
      '```',
    ].join('\n'),
    'utf8',
  )
  if (opts.skill) {
    const skillDir = path.join(dir, 'skills', opts.skill.dir)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), opts.skill.skillMd, 'utf8')
    if (opts.skill.template != null) {
      fs.writeFileSync(path.join(skillDir, 'TEMPLATE.md'), opts.skill.template, 'utf8')
    }
    if (opts.skill.examples) {
      const examplesDir = path.join(skillDir, 'examples')
      fs.mkdirSync(examplesDir, { recursive: true })
      for (const [name, body] of Object.entries(opts.skill.examples)) {
        fs.writeFileSync(path.join(examplesDir, name), body, 'utf8')
      }
    }
  }
  return dir
}

const SKILL_MD = [
  '---',
  'id: stage_playbook',
  'label: Stage playbook',
  'description: Pick the next stage.',
  'tools: [customers.analyze_deals]',
  '---',
  'STAGE_PLAYBOOK_BODY',
].join('\n')

describe('loadFileAgentDir — agent-local skills (Phase 3)', () => {
  const created: string[] = []
  afterAll(() => {
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('loads skill content and unions skill tools into entry.tools', () => {
    const dir = makeAgentDir({
      skills: '[stage_playbook]',
      skill: {
        dir: 'stage_playbook',
        skillMd: SKILL_MD,
        template: 'TEMPLATE_BODY',
        examples: { 'b-second.md': 'EXAMPLE_TWO', 'a-first.md': 'EXAMPLE_ONE' },
      },
    })
    created.push(dir)
    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()

    // skill tool unioned into the agent allowlist (deduped, agent's own tool kept)
    expect(loaded!.entry.tools).toEqual(
      expect.arrayContaining(['customers.get_deal', 'customers.analyze_deals']),
    )

    // skill content carried for the manifest / load_skill
    expect(loaded!.skillsContent).toHaveLength(1)
    const skill = loaded!.skillsContent[0]
    expect(skill.id).toBe('stage_playbook')
    expect(skill.instructions).toBe('STAGE_PLAYBOOK_BODY')
    expect(skill.template).toBe('TEMPLATE_BODY')
    // examples are ordered by filename
    expect(skill.examples).toEqual(['EXAMPLE_ONE', 'EXAMPLE_TWO'])
    expect(skill.tools).toEqual(['customers.analyze_deals'])
  })

  it('derives the skill id from the dir name when frontmatter id is absent', () => {
    const dir = makeAgentDir({
      skills: '[stage_playbook]',
      skill: {
        dir: 'stage_playbook',
        skillMd: ['---', 'description: No id here.', '---', 'BODY'].join('\n'),
      },
    })
    created.push(dir)
    const loaded = loadFileAgentDir(dir)
    expect(loaded!.skillsContent).toHaveLength(1)
    expect(loaded!.skillsContent[0].id).toBe('stage_playbook')
  })

  it('skips an unknown referenced skill without failing the agent', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const dir = makeAgentDir({ skills: '[does_not_exist]' })
    created.push(dir)
    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.skillsContent).toEqual([])
    // only the agent's own tool remains
    expect(loaded!.entry.tools).toEqual(['customers.get_deal'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('does_not_exist'))
    warn.mockRestore()
  })

  it('carries no skill content when the agent declares no skills', () => {
    const dir = makeAgentDir({})
    created.push(dir)
    const loaded = loadFileAgentDir(dir)
    expect(loaded!.skillsContent).toEqual([])
    expect(loaded!.entry.tools).toEqual(['customers.get_deal'])
  })
})
