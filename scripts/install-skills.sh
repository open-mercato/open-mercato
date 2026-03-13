#!/bin/sh
set -eu

ensure_skills_link() {
  target_path="$1"
  link_path="$2"

  echo "Linking $link_path -> $target_path"
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
echo "Skills installation complete."
echo ""
echo "Test the install:"
echo "   Claude Code:"
echo "     claude"
echo "     > /skills"
echo "   Codex:"
echo "     codex"
echo "     > /skills"
