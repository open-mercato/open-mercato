#!/bin/bash
# ds-health-check.sh — run every sprint
# Usage: bash .ai/scripts/ds-health-check.sh [--lint]
#   --lint  When node_modules is present, additionally runs the DS ESLint
#           ruleset (eslint.ds.config.mjs) and merges authoritative per-rule ×
#           per-module counts into the per-module breakdown (lint:* columns).
#           Without --lint the grep proxies still print, so the script stays
#           dependency-free for quick checks. The per-rule × per-module zeros
#           in this report are the warn→error escalation ledger — see
#           .ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md.
# Portable: works on macOS (bash 3.2) and Linux (uses grep, no rg dependency)

set -euo pipefail

LINT_MODE=0
if [ "${1:-}" = "--lint" ]; then
  LINT_MODE=1
fi

REPORT_DIR=".ai/reports"
mkdir -p "$REPORT_DIR"

DATE=$(date +%Y-%m-%d)
REPORT_FILE="$REPORT_DIR/ds-health-$DATE.txt"

report() {
  echo "$1" | tee -a "$REPORT_FILE"
}

> "$REPORT_FILE"

# Module roots covered by per-module breakdown and coverage metrics.
# Global metrics scan all of packages/ and apps/.
MODULE_ROOTS="packages/core/src/modules packages/enterprise/src/modules"

report "=== DESIGN SYSTEM HEALTH CHECK ==="
report "Date: $DATE"
report ""

# Count matching lines across .ts/.tsx files, excluding tests and node_modules
count_matches() {
  local pattern="$1"
  { grep -r -E "$pattern" \
    --include='*.ts' --include='*.tsx' \
    packages/ apps/ \
    2>/dev/null \
    | grep -v '__tests__' | grep -v 'node_modules' | grep -v '.generated.' \
    || true; } | wc -l | tr -d ' '
}

# Count files with at least one match
count_files() {
  local pattern="$1"
  { grep -r -l -E "$pattern" \
    --include='*.ts' --include='*.tsx' \
    packages/ apps/ \
    2>/dev/null \
    | grep -v '__tests__' | grep -v 'node_modules' | grep -v '.generated.' \
    || true; } | wc -l | tr -d ' '
}

# Scoped variants for the per-module breakdown
count_matches_in() {
  local dir="$1" pattern="$2"
  { grep -r -E "$pattern" \
    --include='*.ts' --include='*.tsx' \
    "$dir" \
    2>/dev/null \
    | grep -v '__tests__' | grep -v '.generated.' \
    || true; } | wc -l | tr -d ' '
}

count_files_in() {
  local dir="$1" pattern="$2"
  { grep -r -l -E "$pattern" \
    --include='*.ts' --include='*.tsx' \
    "$dir" \
    2>/dev/null \
    | grep -v '__tests__' | grep -v '.generated.' \
    || true; } | wc -l | tr -d ' '
}

HC_PATTERN='text-red-[0-9]|bg-red-[0-9]|border-red-[0-9]|text-green-[0-9]|bg-green-[0-9]|border-green-[0-9]|text-emerald-[0-9]|bg-emerald-[0-9]|border-emerald-[0-9]|text-amber-[0-9]|bg-amber-[0-9]|border-amber-[0-9]|text-blue-[0-9]|bg-blue-[0-9]|border-blue-[0-9]'

report "--- Hardcoded Status Colors ---"
HC=$(count_matches "$HC_PATTERN")
report "  Count: $HC (target: 0)"

report ""
report "--- Arbitrary Text Sizes ---"
AT=$(count_matches 'text-\[[0-9]+px\]')
report "  Count: $AT (target: 1)"

report ""
report "--- Deprecated Notice Usage ---"
NC=$(count_files "from.*primitives/Notice")
report "  Notice imports: $NC (target: 0)"
EN=$(count_files "ErrorNotice")
report "  ErrorNotice imports: $EN (target: 0)"

report ""
report "--- Legacy Alert variant API ---"
LA=$(count_matches '<Alert[^>]*variant=')
report "  Legacy Alert variant usages: $LA (target: 0)"

report ""
report "--- Arbitrary Z-Index ---"
AZ=$(count_matches 'z-\[[0-9]+\]')
report "  Arbitrary z-index usages: $AZ (target: 0)"

report ""
report "--- Inline SVG ---"
SVG=$(count_files '<svg ')
report "  Files with inline SVG: $SVG (target: 0)"

report ""
report "--- Raw fetch() in Backend ---"
RF=$({ grep -r -l -E 'fetch\(' \
  --include='*.ts' --include='*.tsx' \
  packages/*/src/**/backend/ packages/core/src/modules/*/backend/ apps/*/src/**/backend/ \
  2>/dev/null \
  | grep -v 'node_modules' | grep -v '__tests__' | grep -v 'apiCall' \
  || true; } | wc -l | tr -d ' ')
report "  Raw fetch files: $RF (target: 0)"

report ""
report "--- Empty State Coverage ---"
PAGES=0
for root in $MODULE_ROOTS; do
  [ -d "$root" ] || continue
  N=$(find "$root"/*/backend -name "page.tsx" 2>/dev/null | wc -l | tr -d ' ')
  PAGES=$(( PAGES + N ))
done
if [ "$PAGES" -gt 0 ]; then
  ES=0
  for root in $MODULE_ROOTS; do
    [ -d "$root" ] || continue
    N=$({ grep -r -l -E 'EmptyState|TabEmptyState|emptyState' \
      --include='page.tsx' \
      "$root"/*/backend/ \
      2>/dev/null || true; } | wc -l | tr -d ' ')
    ES=$(( ES + N ))
  done
  PCT=$(( ES * 100 / PAGES ))
  report "  Pages with empty state: $ES / $PAGES ($PCT%)"
else
  report "  Pages with empty state: N/A (no pages found)"
fi

report ""
report "--- Loading State Coverage ---"
if [ "$PAGES" -gt 0 ]; then
  LS=0
  for root in $MODULE_ROOTS; do
    [ -d "$root" ] || continue
    N=$({ grep -r -l -E 'LoadingMessage|isLoading|Spinner|DataLoader' \
      --include='page.tsx' \
      "$root"/*/backend/ \
      2>/dev/null || true; } | wc -l | tr -d ' ')
    LS=$(( LS + N ))
  done
  LPCT=$(( LS * 100 / PAGES ))
  report "  Pages with loading state: $LS / $PAGES ($LPCT%)"
else
  report "  Pages with loading state: N/A (no pages found)"
fi

report ""
report "--- Semantic Token Adoption ---"
ST=$(count_matches 'status-error-|status-success-|status-warning-|status-info-|status-neutral-|status-pink-')
report "  Semantic token usages: $ST"

report ""
report "--- DS Lint Opt-Outs ---"
OO=$(count_matches 'eslint-disable.*om-ds/')
report "  DS lint opt-out directives: $OO (target: 0)"

report ""
report "=== END REPORT ==="

# --- Per-module breakdown (appended after END REPORT; rows use table syntax
# --- so the delta grep below never picks them up) ---
# Escalation units: one directory under packages/{core,enterprise}/src/modules/
# plus packages/ui/src/backend treated as the pseudo-module "ui/backend".

# In --lint mode, run the DS ESLint ruleset once (through the TypeScript 7
# require hook — the native compiler has no JS API) and aggregate authoritative
# per-rule × per-module counts into TAB-separated "module<TAB>rule<TAB>count"
# rows for the table below.
LINT_ROWS=""
LINT_RULES="require-empty-state require-page-wrapper no-raw-table require-loading-state require-status-badge no-hardcoded-status-colors no-legacy-alert-variant"
if [ "$LINT_MODE" -eq 1 ]; then
  if [ -d node_modules ]; then
    LINT_JSON=$(mktemp)
    LINT_ROWS=$(mktemp)
    node --require ./scripts/typescript-js-require-hook.cjs \
      node_modules/eslint/bin/eslint.js --config eslint.ds.config.mjs \
      packages apps --format json --output-file "$LINT_JSON" >/dev/null 2>&1 || true
    if [ -s "$LINT_JSON" ]; then
      node -e '
        const fs = require("fs")
        const results = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
        const cwd = process.cwd() + "/"
        const counts = new Map()
        const moduleKey = (rel) => {
          let m
          if ((m = rel.match(/^packages\/core\/src\/modules\/([^/]+)\//))) return m[1]
          if ((m = rel.match(/^packages\/enterprise\/src\/modules\/([^/]+)\//))) return "ent:" + m[1]
          if (rel.startsWith("packages/ui/src/backend/")) return "ui/backend"
          return "(outside module roots)"
        }
        for (const entry of results) {
          const rel = entry.filePath.startsWith(cwd) ? entry.filePath.slice(cwd.length) : entry.filePath
          for (const msg of entry.messages ?? []) {
            if (!msg.ruleId || !msg.ruleId.startsWith("om-ds/")) continue
            const key = moduleKey(rel) + "\t" + msg.ruleId.slice("om-ds/".length)
            counts.set(key, (counts.get(key) ?? 0) + 1)
          }
        }
        const out = []
        for (const [key, n] of counts) out.push(key + "\t" + n)
        out.push("__lint_ok__\tmarker\t0")
        fs.writeFileSync(process.argv[2], out.join("\n") + "\n")
      ' "$LINT_JSON" "$LINT_ROWS" || true
    fi
    if ! grep -q "__lint_ok__" "$LINT_ROWS" 2>/dev/null; then
      # A crashed eslint run or failed aggregation must never masquerade as
      # zero findings — all-zero columns are exactly the escalation criterion.
      report ""
      report "(--lint requested but the eslint run produced no data — lint columns skipped)"
      LINT_MODE=0
    fi
    rm -f "$LINT_JSON"
  else
    report ""
    report "(--lint requested but node_modules is missing — lint columns skipped)"
    LINT_MODE=0
  fi
fi

lint_count() {
  # lint_count <module> <rule-short-name>
  awk -F'\t' -v m="$1" -v r="$2" '$1==m && $2==r {s+=$3} END {print s+0}' "$LINT_ROWS"
}

lint_total() {
  awk -F'\t' -v m="$1" '$1==m {s+=$3} END {print s+0}' "$LINT_ROWS"
}

report ""
report "=== PER-MODULE BREAKDOWN (top offenders first) ==="
if [ "$LINT_MODE" -eq 1 ]; then
  report "| module | colors | text | svg-files | pages-no-empty | alert-variant | lint:empty | lint:page | lint:table | lint:loading | lint:badge | lint:colors | lint:alert | total |"
  report "|--------|--------|------|-----------|----------------|---------------|------------|-----------|------------|--------------|------------|-------------|------------|-------|"
else
  report "| module | colors | text | svg-files | pages-no-empty | alert-variant | total |"
  report "|--------|--------|------|-----------|----------------|---------------|-------|"
fi

TMP_ROWS=$(mktemp)

collect_module_row() {
  # collect_module_row <dir> <name>
  local mod="$1" name="$2"
  local MHC MAT MSVG MPAGES MES MNOEMPTY MALERT TOTAL LINTCOLS MLINT rule
  MHC=$(count_matches_in "$mod" "$HC_PATTERN")
  MAT=$(count_matches_in "$mod" 'text-\[[0-9]+px\]')
  MSVG=$(count_files_in "$mod" '<svg ')
  MPAGES=$(find "$mod" -path '*/backend/*' -name "page.tsx" 2>/dev/null | wc -l | tr -d ' ')
  MES=0
  if [ "$MPAGES" -gt 0 ]; then
    MES=$({ grep -r -l -E 'EmptyState|TabEmptyState|emptyState' \
      --include='page.tsx' "$mod" 2>/dev/null || true; } | wc -l | tr -d ' ')
  fi
  MNOEMPTY=$(( MPAGES - MES ))
  MALERT=$(count_matches_in "$mod" '<Alert[^>]*variant=')
  TOTAL=$(( MHC + MAT + MSVG + MNOEMPTY + MALERT ))
  LINTCOLS=""
  MLINT=0
  if [ "$LINT_MODE" -eq 1 ]; then
    for rule in $LINT_RULES; do
      n=$(lint_count "$name" "$rule")
      LINTCOLS="$LINTCOLS|$n"
      MLINT=$(( MLINT + n ))
    done
  fi
  if [ "$TOTAL" -gt 0 ] || [ "$MLINT" -gt 0 ]; then
    echo "$TOTAL|$name|$MHC|$MAT|$MSVG|$MNOEMPTY|$MALERT$LINTCOLS" >> "$TMP_ROWS"
  fi
}

for root in $MODULE_ROOTS; do
  [ -d "$root" ] || continue
  prefix=""
  case "$root" in
    packages/enterprise/*) prefix="ent:" ;;
  esac
  for mod in "$root"/*/; do
    [ -d "$mod" ] || continue
    collect_module_row "$mod" "$prefix$(basename "$mod")"
  done
done
if [ -d packages/ui/src/backend ]; then
  collect_module_row "packages/ui/src/backend/" "ui/backend"
fi

if [ -s "$TMP_ROWS" ]; then
  sort -t'|' -k1,1nr "$TMP_ROWS" | while IFS='|' read -r total name rest; do
    report "| $name | $(echo "$rest" | sed 's/|/ | /g') | $total |"
  done
else
  report "| (no module violations found) | - | - | - | - | - | - |"
fi
rm -f "$TMP_ROWS"

# Findings the eslint run attributes to files outside the escalation units
# (the widened no-legacy-alert-variant glob covers every workspace).
if [ "$LINT_MODE" -eq 1 ]; then
  OUTSIDE=$(lint_total "(outside module roots)")
  if [ "$OUTSIDE" -gt 0 ]; then
    report ""
    report "Lint findings outside module roots (other workspaces/apps): $OUTSIDE"
  fi
  rm -f "$LINT_ROWS"
fi

report ""
report "Suggested next module: highest total above."

# Compare with previous report
PREV=$(ls -1 "$REPORT_DIR"/ds-health-*.txt 2>/dev/null | grep -v "$DATE" | sort | tail -1 || true)
if [ -n "${PREV:-}" ] && [ -f "$PREV" ]; then
  echo ""
  echo "=== DELTA vs $(basename "$PREV") ==="
  diff --unified=0 "$PREV" "$REPORT_FILE" | grep '^[+-]  ' | head -30 || echo "  (no changes)"
else
  echo ""
  echo "=== First report — no previous data to compare ==="
fi

echo ""
echo "Report saved to: $REPORT_FILE"
