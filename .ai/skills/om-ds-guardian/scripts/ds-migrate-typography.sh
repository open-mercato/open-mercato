#!/bin/bash
# ds-migrate-typography.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Run per module, then review the diff

set -euo pipefail
MODULE_PATH="${1:-}"

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-typography.sh <module-path>"
  echo "Example: bash ds-migrate-typography.sh packages/core/src/modules/customers/"
  exit 1
fi

if [ ! -d "$MODULE_PATH" ]; then
  echo "ERROR: Directory not found: $MODULE_PATH"
  exit 1
fi

echo "=== Typography migration: $MODULE_PATH ==="

replace() {
  find "$MODULE_PATH" \( -name "*.tsx" -o -name "*.ts" \) -exec perl -i -pe "$1" {} +
}

replace 's/text-\[10px\]/text-xs/g'
echo "  text-[10px] → text-xs: done"

replace 's/text-\[11px\]/text-overline/g'
echo "  text-[11px] → text-overline: done"

replace 's/text-\[12px\]/text-xs/g'
echo "  text-[12px] → text-xs: done"

replace 's/text-\[13px\]/text-sm/g'
echo "  text-[13px] → text-sm: done"

replace 's/text-\[14px\]/text-sm/g'
echo "  text-[14px] → text-sm: done"

replace 's/tracking-widest/tracking-wider/g'
echo "  tracking-widest → tracking-wider: done"

replace 's/tracking-\[0\.15em\]/tracking-wider/g'
echo "  tracking-[0.15em] → tracking-wider: done"

echo ""
echo "=== MANUAL CHECK NEEDED ==="
echo "  text-[15px] requires contextual decision (text-base or text-sm):"
{ grep -rn 'text-\[15px\]' "$MODULE_PATH" --include="*.tsx" --include="*.ts" 2>/dev/null || true; }

echo ""
echo "=== REMAINING (should be zero, except text-[9px] exception) ==="
REMAINING=$({ grep -rn 'text-\[[0-9]*px\]' "$MODULE_PATH" --include="*.tsx" --include="*.ts" 2>/dev/null \
  | grep -v 'text-\[9px\]' || true; } | wc -l | tr -d ' ')
echo "  Remaining arbitrary sizes (excluding 9px): $REMAINING"

echo ""
echo "=== Done. Review with: git diff $MODULE_PATH ==="
