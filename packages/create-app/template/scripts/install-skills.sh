#!/usr/bin/env bash
set -euo pipefail

ensure_skills_link() {
  local target_path="$1"
  local link_path="$2"

  echo "Linking $link_path → $target_path"
  mkdir -p "$(dirname "$link_path")"

  if [ -e "$link_path" ] && [ ! -L "$link_path" ]; then
    echo "Expected $link_path to be a symlink. Remove the existing path and re-run." >&2
    exit 1
  fi

  if [ -L "$link_path" ]; then
    rm -f "$link_path"
  fi

  ln -s "$target_path" "$link_path"
  echo "Linked $link_path"
}

ensure_skills_link "../.ai/skills" ".codex/skills"
ensure_skills_link "../.ai/skills" ".claude/skills"
echo ""
echo "Skills installation complete."
echo ""
echo "Test the install:"
echo "  Claude Code: claude → /skills"
echo "  Codex: codex → /skills"
