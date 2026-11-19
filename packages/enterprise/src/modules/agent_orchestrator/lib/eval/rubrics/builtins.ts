import { judgeRubricSchema, type JudgeRubric } from '../judgeRubric'

export type BuiltinRubric = {
  key: string
  title: string
  titleKey: string
  rubric: JudgeRubric
}

const TITLE_KEY_PREFIX = 'agent_orchestrator.evalRubrics.builtin'

function builtin(key: string, title: string, rubric: unknown): BuiltinRubric {
  return { key, title, titleKey: `${TITLE_KEY_PREFIX}.${key}.title`, rubric: judgeRubricSchema.parse(rubric) }
}

/**
 * Shared judge rubrics referenced by `{ "rubricRef": "<key>" }`. Each uses choice
 * scoring with pre-written evaluation steps, temperature 0 and a 3-sample
 * majority vote. Editing one changes every manifest frozen from it afterwards,
 * so a wording change shows up as a new dataset version.
 */
export const BUILTIN_RUBRICS: ReadonlyArray<BuiltinRubric> = [
  builtin('rationale_quality', 'Rationale quality', {
    promptTemplate:
      'Judge the rationale the agent gives for its decision. A good rationale cites the specific evidence from the input that drove the decision and names the rule or criterion it applies. It explains the decision rather than restating it.',
    evaluationSteps: [
      'Identify the decision or verdict the output reaches.',
      'Find the rationale and list the pieces of input evidence it cites.',
      'Check whether the rationale names the rule or criterion it applies to that evidence.',
      'Check whether the rationale adds reasoning beyond restating the verdict.',
    ],
    scoring: {
      kind: 'choice',
      choices: [
        { key: 'A', description: 'Cites the specific input evidence and the rule it applies, and explains rather than restates the verdict.', score: 1 },
        { key: 'B', description: 'Cites either the evidence or the rule but not both, or partly restates the verdict.', score: 0.5 },
        { key: 'C', description: 'Generic, missing, or only restates the verdict without evidence or rule.', score: 0 },
      ],
    },
    temperature: 0,
    samples: 3,
  }),
  builtin('groundedness', 'Groundedness', {
    promptTemplate:
      'Judge whether every factual claim in the agent output is traceable to the agent input or to tool output it received. Claims that cannot be traced are unsupported, even when they sound plausible.',
    evaluationSteps: [
      'List the factual claims the output makes.',
      'For each claim, look for its source in the input or in tool output included with the output.',
      'Classify each claim as traceable or unsupported.',
      'Weigh unsupported claims by whether they change the decision.',
    ],
    scoring: {
      kind: 'choice',
      choices: [
        { key: 'A', description: 'Every claim is traceable to the input or tool output.', score: 1 },
        { key: 'B', description: 'Minor details are unsupported, but no claim that affects the decision is.', score: 0.5 },
        { key: 'C', description: 'At least one claim that affects the decision is unsupported or contradicts the sources.', score: 0 },
      ],
    },
    temperature: 0,
    samples: 3,
  }),
  builtin('appropriate_abstention', 'Appropriate abstention', {
    promptTemplate:
      'Judge whether the agent abstains or flags the case for human review exactly when the available evidence is insufficient to decide, and decides when it is sufficient.',
    evaluationSteps: [
      'Decide whether the input and tool output contain enough evidence to reach a decision.',
      'Check whether the output decides, abstains, or flags the case for review.',
      'Compare the two: abstaining with sufficient evidence over-abstains; deciding with insufficient evidence over-commits.',
    ],
    scoring: {
      kind: 'choice',
      choices: [
        { key: 'A', description: 'Abstains or flags for review exactly when evidence is insufficient, and decides otherwise.', score: 1 },
        { key: 'B', description: 'Abstains or flags for review although the evidence is sufficient to decide.', score: 0.5 },
        { key: 'C', description: 'Commits to a decision although the evidence is insufficient.', score: 0 },
      ],
    },
    temperature: 0,
    samples: 3,
  }),
]

export const BUILTIN_RUBRICS_BY_KEY: ReadonlyMap<string, BuiltinRubric> = new Map(
  BUILTIN_RUBRICS.map((entry) => [entry.key, entry]),
)
