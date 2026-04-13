#!/bin/bash
# ds-migrate-colors.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Run per module, then review the diff

set -euo pipefail
MODULE_PATH="${1:-}"

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-colors.sh <module-path>"
  echo "Example: bash ds-migrate-colors.sh packages/core/src/modules/customers/"
  exit 1
fi

if [ ! -d "$MODULE_PATH" ]; then
  echo "ERROR: Directory not found: $MODULE_PATH"
  exit 1
fi

echo "=== Color migration: $MODULE_PATH ==="

replace() {
  find "$MODULE_PATH" \( -name "*.tsx" -o -name "*.ts" \) -exec perl -i -pe "$1" {} +
}

# ERROR (red → status-error)
for shade in 600 700 800 900; do
  replace "s/text-red-$shade/text-status-error-text/g"
done
replace 's/text-red-500/text-status-error-icon/g'
for shade in 50 100; do
  replace "s/bg-red-$shade/bg-status-error-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-red-$shade/border-status-error-border/g"
done
echo "  Error colors: done"

# SUCCESS (green → status-success)
for shade in 500 600 700 800; do
  replace "s/text-green-$shade/text-status-success-text/g"
done
for shade in 50 100 200; do
  replace "s/bg-green-$shade/bg-status-success-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-green-$shade/border-status-success-border/g"
done
echo "  Success (green) colors: done"

# SUCCESS (emerald → status-success)
for shade in 300 600 700 800 900; do
  replace "s/text-emerald-$shade/text-status-success-text/g"
done
for shade in 50 100; do
  replace "s/bg-emerald-$shade/bg-status-success-bg/g"
done
for shade in 200 300; do
  replace "s/border-emerald-$shade/border-status-success-border/g"
done
echo "  Success (emerald) colors: done"

# WARNING (amber → status-warning)
for shade in 500 800 950; do
  replace "s/text-amber-$shade/text-status-warning-text/g"
done
replace "s/bg-amber-50/bg-status-warning-bg/g"
for shade in 200 500; do
  replace "s/border-amber-$shade/border-status-warning-border/g"
done
echo "  Warning colors: done"

# INFO (blue → status-info)
for shade in 600 700 800 900; do
  replace "s/text-blue-$shade/text-status-info-text/g"
done
replace 's/text-blue-500/text-status-info-icon/g'
for shade in 50 100; do
  replace "s/bg-blue-$shade/bg-status-info-bg/g"
done
for shade in 200 500; do
  replace "s/border-blue-$shade/border-status-info-border/g"
done
echo "  Info (blue) colors: done"

# INFO (sky → status-info)
replace 's/text-sky-900/text-status-info-text/g'
replace 's/border-sky-600\/30/border-status-info-border/g'
replace 's/bg-sky-500\/10/bg-status-info-bg/g'
echo "  Info (sky) colors: done"

echo ""
echo "=== MANUAL REVIEW NEEDED ==="
echo "  Solid backgrounds may need different tokens:"
echo "  - bg-red-600 → bg-destructive (button bg)"
echo "  - bg-emerald-500/600 → bg-status-success-icon (solid indicator)"
echo "  - bg-blue-600 → bg-status-info-icon (solid indicator)"
{ grep -rn 'bg-red-600\|bg-emerald-[56]00\|bg-blue-600' "$MODULE_PATH" --include="*.tsx" --include="*.ts" 2>/dev/null || true; }

echo ""
echo "=== REMAINING (should be zero) ==="
REMAINING=$({ grep -rn 'text-red-\|bg-red-\|text-green-\|bg-green-\|text-emerald-\|bg-emerald-\|text-amber-\|bg-amber-\|text-blue-[0-9]\|bg-blue-[0-9]' \
  "$MODULE_PATH" --include="*.tsx" --include="*.ts" 2>/dev/null || true; } | wc -l | tr -d ' ')
echo "  Remaining hardcoded colors: $REMAINING"

echo ""
echo "=== Done. Review with: git diff $MODULE_PATH ==="
