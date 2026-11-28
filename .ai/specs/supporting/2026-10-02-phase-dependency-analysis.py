#!/usr/bin/env python3
"""Measure how the marketing-automation module decomposes into delivery phases.

Self-contained: run it from the repository root and it rebuilds everything it needs.

    python3 .ai/specs/supporting/2026-10-02-phase-dependency-analysis.py

Why it builds its own import graph instead of using `dependency-cruiser`: the package's
cruiser config filters by extension, so a `src/**/*.ts` run silently omits every `.tsx`
file. That hid 23 backend screens and understated the first phase by five percentage
points — the kind of error that is invisible until the numbers are used for a decision.
"""
import collections
import re
import sys
from pathlib import Path

MODULE = Path('packages/marketing-automation/src/modules/marketing_automation')

# Libraries are claimed by domain; entry points are placed by what they depend on, because claiming
# them by path produced 78 false back-edges — routes like `campaigns/[id]/render` swept into the core.
LIB_RULES = [
    (1, r'^(data/|events\.ts|index\.ts|acl\.ts|di\.ts|setup\.ts|ce\.ts|encryption\.ts|notifications)'),
    (1, r'^lib/(scope|queue|subscriber-forward|order-filter|html-escape|redact|external/|capabilities'
        r'|occurrence|runs|dispatcher|revisions|run-context|send-slots|sweep-interval|trigger-catalog'
        r'|rate-limit|job-runs|progress|campaign-lookup|command-context|dead-letter)'),
    (1, r'^lib/(engine/|canvas/|audience/|sweep-sources|preview)'),
    (1, r'^commands/'),
    # Consent and the recipient's own preference are PINNED to the first phase. The graph would happily
    # move them later; a phase that can send without them is a phase that mails people who said no, and
    # a merged phase is a shippable state.
    (1, r'^lib/(consent|preferences)'),
    (2, r'^lib/(tracking/|content-blocks|deliverability|subject-document|render-values|interpolate|survey|email)'),
    (3, r'^lib/(analytics/|winner-metric|value-boundaries)'),
    (4, r'^lib/(segment|scores|score-rules|tiers|referrals|product-watches|lead-|recommendations|gdpr)'),
    (5, r'^(ai-|lib/(ai-copy|inbound))'),
]
ENTRY = re.compile(r'^(api/|backend/|frontend/|workers/|subscribers/|steps/|widgets/|components/|migrations/|i18n/)')

# The seven one-function imports whose inversion into registrations was costed. Not applied by default.
INVERTIBLE = {
    'lib/dispatcher.ts': ['lib/gdpr.ts', 'lib/segments.ts', 'lib/tiers.ts',
                          'lib/analytics/send-time.ts', 'lib/subject-document.ts'],
    'lib/audience/set-resolver.ts': ['lib/subject-document.ts'],
    'lib/engine/auto-winner.ts': ['lib/analytics/split-results.ts'],
    'lib/render-values.ts': ['lib/scores.ts', 'lib/tiers.ts'],
    'di.ts': ['steps/index.ts'],
}


def build_graph(invert: bool):
    root = MODULE.resolve()
    sources = [p for p in root.rglob('*') if p.suffix in ('.ts', '.tsx')
               and '__tests__' not in p.parts and '__integration__' not in p.parts]

    def resolve(origin: Path, spec: str):
        if spec.endswith('.js'):
            spec = spec[:-3]
        target = origin.parent / spec
        for candidate in (target, Path(f'{target}.ts'), Path(f'{target}.tsx'),
                          target / 'index.ts', target / 'index.tsx'):
            try:
                resolved = candidate.resolve()
            except OSError:
                continue
            if resolved.is_file():
                try:
                    return str(resolved.relative_to(root))
                except ValueError:
                    return None
        return None

    graph = {}
    for path in sources:
        deps = set()
        for match in re.finditer(r"from '(\.[^']+)'", path.read_text()):
            found = resolve(path, match.group(1))
            if found:
                deps.add(found)
        key = str(path.relative_to(root))
        if invert and key in INVERTIBLE:
            deps -= set(INVERTIBLE[key])
        graph[key] = sorted(deps)
    return graph


def assign_phases(graph):
    assign = {}
    for path in graph:
        if ENTRY.match(path):
            continue
        for phase, pattern in LIB_RULES:
            if re.match(pattern, path):
                assign[path] = phase
                break
    pending = [p for p in graph if p not in assign]
    for _ in range(60):
        for path in list(pending):
            phases = [assign.get(d) for d in graph[path] if d in graph]
            if any(p is None for p in phases):
                continue
            assign[path] = max(phases, default=1) or 1
            pending.remove(path)
        if not pending:
            break
    for path in pending:
        assign[path] = 1
    # Promote to a fixed point: no phase may import from a later one.
    for _ in range(60):
        moved = 0
        for src, deps in graph.items():
            for dep in deps:
                if dep in assign and assign[dep] > assign.get(src, 1):
                    stack, seen = [dep], set()
                    while stack:
                        node = stack.pop()
                        if node in seen or node not in graph:
                            continue
                        seen.add(node)
                        stack.extend(graph[node])
                    for f in seen:
                        if assign.get(f, 1) > assign[src]:
                            assign[f] = assign[src]
                            moved += 1
        if not moved:
            break
    back = [(assign[s], s, assign[d], d) for s, deps in graph.items() if s in assign
            for d in deps if d in assign and assign[d] > assign[s]]
    return assign, back


def report(label: str, invert: bool):
    graph = build_graph(invert)
    assign, back = assign_phases(graph)

    entities = re.findall(r'^export class (\w+)', (MODULE / 'data/entities.ts').read_text(), re.M)
    first = collections.defaultdict(lambda: 99)
    for path, phase in assign.items():
        if path == 'data/entities.ts':
            continue
        text = (MODULE / path).read_text()
        for entity in entities:
            if re.search(rf'\b{entity}\b', text):
                first[entity] = min(first[entity], phase)
    tables = collections.Counter(first[e] for e in entities)

    lines, files, tsx = collections.Counter(), collections.Counter(), collections.Counter()
    for path, phase in assign.items():
        lines[phase] += len((MODULE / path).read_text().splitlines())
        files[phase] += 1
        if path.endswith('.tsx'):
            tsx[phase] += 1

    total = sum(lines.values())
    print(f'\n=== {label} ===')
    print(f'files {len(graph)} ({sum(tsx.values())} tsx)  edges {sum(len(v) for v in graph.values())}  '
          f'back-edges {len(back)}')
    cumulative = 0
    for phase in sorted(lines):
        cumulative += lines[phase]
        print(f'  P{phase}: {files[phase]:4d} files ({tsx[phase]:2d} tsx)  {lines[phase]:6d} lines  '
              f'{100 * lines[phase] / total:5.1f}%  cumulative {100 * cumulative / total:5.1f}%  '
              f'tables first needed here: {tables.get(phase, 0)}')
    for a, s, b, d in back[:5]:
        print(f'  BACK-EDGE  P{a} {s} -> P{b} {d}')


if __name__ == '__main__':
    if not MODULE.is_dir():
        sys.exit('run this from the repository root')
    report('as delivered — the seven one-function imports left alone', invert=False)
    report('if those imports became registrations', invert=True)
