#!/bin/bash
# ds-health-check.sh — run every sprint
# Usage: bash .ai/scripts/ds-health-check.sh
# Portable: works on macOS (bash 3.2) and Linux (uses grep, no rg dependency)

set -euo pipefail

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
report "--- Token Snapshot Drift ---"
TD=$(node scripts/ds-tokens-export.mjs --check --count 2>/dev/null || echo "unavailable")
report "  Drifted tokens: $TD (target: 0)"

report ""
report "=== END REPORT ==="

# --- Per-module breakdown (appended after END REPORT; rows use table syntax
# --- so the delta grep below never picks them up) ---
report ""
report "=== PER-MODULE BREAKDOWN (top offenders first) ==="
report "| module | colors | text | svg-files | pages-no-empty | total |"
report "|--------|--------|------|-----------|----------------|-------|"

TMP_ROWS=$(mktemp)
for root in $MODULE_ROOTS; do
  [ -d "$root" ] || continue
  prefix=""
  case "$root" in
    packages/enterprise/*) prefix="ent:" ;;
  esac
  for mod in "$root"/*/; do
    [ -d "$mod" ] || continue
    name="$prefix$(basename "$mod")"
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
    TOTAL=$(( MHC + MAT + MSVG + MNOEMPTY ))
    if [ "$TOTAL" -gt 0 ]; then
      echo "$TOTAL|$name|$MHC|$MAT|$MSVG|$MNOEMPTY" >> "$TMP_ROWS"
    fi
  done
done

if [ -s "$TMP_ROWS" ]; then
  sort -t'|' -k1,1nr "$TMP_ROWS" | while IFS='|' read -r total name mhc mat msvg mnoempty; do
    report "| $name | $mhc | $mat | $msvg | $mnoempty | $total |"
  done
else
  report "| (no module violations found) | - | - | - | - | - |"
fi
rm -f "$TMP_ROWS"

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
