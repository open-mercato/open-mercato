#!/bin/sh
set -eu

# Skill installer for a standalone Open Mercato app (Claude Code + Codex).
# Two sources are mixed in:
#
#   1. Local tiered skills: reads .ai/skills/tiers.json and creates per-skill
#      symlinks under .claude/skills/ and .codex/skills/. If a legacy
#      directory-level symlink (e.g. .claude/skills -> ../.ai/skills) is found,
#      it is replaced with a real directory of per-skill symlinks.
#   2. External shared skills: installs the subset this app ships from the
#      open-mercato/skills collection via `npx skills add` into .agents/skills/
#      (read natively by Codex; the CLI also symlinks .claude/skills/<name>),
#      then `npx skills update` so a re-run refreshes them to the latest
#      published versions. The external source + explicit skill list live under
#      `external` in tiers.json. A folder under .ai/skills/ matching an external
#      skill name is a repo-local override the external skill reads in place; it
#      is never symlinked into the harness directories.
#
# The scaffold is offline: `npx skills add`/`update` only run when you invoke
# this script (yarn install-skills). Pass --no-external (or set
# OM_SKIP_EXTERNAL_SKILLS=1) to skip the network step entirely.
#
# Usage:
#   install-skills.sh                           # default tier set (core) + install/update external skills
#   install-skills.sh --with <csv>              # default + extra tiers (additive)
#   install-skills.sh --tiers <csv>             # exactly the listed tiers (replaces default)
#   install-skills.sh --all                     # every tier
#   install-skills.sh --no-external             # skip the npx external-skills install/update step (offline)
#   install-skills.sh --list                    # print tier table and exit
#   install-skills.sh --clean                   # remove all skill symlinks and exit
#   install-skills.sh --help | -h               # show usage and exit

usage() {
  cat <<'EOF'
Usage: install-skills.sh [options]

Options:
  (no options)        Install the default tier set from .ai/skills/tiers.json
                      plus the external open-mercato/skills subset this app ships.
  --with <csv>        Install default tiers plus the given tier names (additive).
  --tiers <csv>       Install exactly the given tier names (replaces default).
  --all               Install every tier defined in tiers.json.
  --no-external       Skip the external-collection step — `npx skills add` on
                      first run and `npx skills update` on re-runs (also:
                      OM_SKIP_EXTERNAL_SKILLS=1). Use when offline.
  --list              Print the tier table and exit without installing.
  --clean             Remove all skill symlinks (local and external) and exit.
  --help, -h          Show this message.

--with, --tiers, and --all are mutually exclusive.
EOF
}

if ! command -v jq >/dev/null 2>&1; then
  echo "install-skills: jq is required but not installed." >&2
  echo "Install jq (e.g. 'sudo apt-get install jq' or 'brew install jq') and re-run." >&2
  exit 1
fi

# Resolve the app root from this script's own location (scripts/install-skills.sh),
# falling back to git and finally the current directory. A freshly scaffolded app
# may not be a git checkout yet, so git is optional here.
script_path="$0"
case "${script_path}" in
  /*) : ;;
  *) script_path="$(pwd)/${script_path}" ;;
esac
script_dir=$(CDPATH= cd -- "$(dirname -- "${script_path}")" && pwd)
repo_root=$(CDPATH= cd -- "${script_dir}/.." && pwd)
if [ ! -f "${repo_root}/.ai/skills/tiers.json" ]; then
  git_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "${git_root}" ] && [ -f "${git_root}/.ai/skills/tiers.json" ]; then
    repo_root="${git_root}"
  elif [ -f "$(pwd)/.ai/skills/tiers.json" ]; then
    repo_root="$(pwd)"
  fi
fi

manifest="${repo_root}/.ai/skills/tiers.json"
skills_dir="${repo_root}/.ai/skills"

if [ ! -f "${manifest}" ]; then
  echo "install-skills: missing manifest ${manifest}" >&2
  echo "  Run this from your app root (yarn install-skills)." >&2
  exit 1
fi

mode=""
with_csv=""
tiers_csv=""
list_only=0
clean_only=0
# Any non-empty value other than "0" skips the external npx step.
case "${OM_SKIP_EXTERNAL_SKILLS:-0}" in
  ""|0) no_external=0 ;;
  *) no_external=1 ;;
esac

set_mode() {
  new_mode="$1"
  if [ -n "${mode}" ] && [ "${mode}" != "${new_mode}" ]; then
    echo "install-skills: --with, --tiers, and --all are mutually exclusive." >&2
    usage >&2
    exit 1
  fi
  mode="${new_mode}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --list)
      list_only=1
      shift
      ;;
    --clean)
      clean_only=1
      shift
      ;;
    --no-external)
      no_external=1
      shift
      ;;
    --all)
      set_mode all
      shift
      ;;
    --with)
      set_mode with
      if [ $# -lt 2 ]; then
        echo "install-skills: --with requires a comma-separated list of tier names." >&2
        exit 1
      fi
      with_csv="$2"
      shift 2
      ;;
    --with=*)
      set_mode with
      with_csv="${1#--with=}"
      shift
      ;;
    --tiers)
      set_mode tiers
      if [ $# -lt 2 ]; then
        echo "install-skills: --tiers requires a comma-separated list of tier names." >&2
        exit 1
      fi
      tiers_csv="$2"
      shift 2
      ;;
    --tiers=*)
      set_mode tiers
      tiers_csv="${1#--tiers=}"
      shift
      ;;
    *)
      echo "install-skills: unknown option '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

split_csv() {
  printf '%s' "$1" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$' || true
}

all_tier_names=$(jq -r '.tiers | keys[]' "${manifest}")
default_tier_names=$(jq -r '.default[]' "${manifest}")

tier_defined() {
  needle="$1"
  for candidate in ${all_tier_names}; do
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

tier_skills() {
  jq -r --arg t "$1" '.tiers[$t].skills[]' "${manifest}"
}

tier_skill_count() {
  jq -r --arg t "$1" '.tiers[$t].skills | length' "${manifest}"
}

is_default_tier() {
  needle="$1"
  for candidate in ${default_tier_names}; do
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

dedup_lines() {
  awk 'NF && !seen[$0]++'
}

agents_dir="${repo_root}/.agents/skills"

resolves_into_skills_dir() {
  link_path="$1"
  resolved=$(readlink -f -- "${link_path}" 2>/dev/null || true)
  if [ -z "${resolved}" ]; then
    return 1
  fi
  case "${resolved}" in
    "${skills_dir}"/*)
      return 0
      ;;
  esac
  return 1
}

resolves_into_agents_dir() {
  link_path="$1"
  resolved=$(readlink -f -- "${link_path}" 2>/dev/null || true)
  if [ -z "${resolved}" ]; then
    return 1
  fi
  case "${resolved}" in
    "${agents_dir}"/*)
      return 0
      ;;
  esac
  return 1
}

clean_harness() {
  harness_dir="$1"
  if [ ! -d "${harness_dir}" ] && [ ! -L "${harness_dir}" ]; then
    return 0
  fi
  if [ -L "${harness_dir}" ]; then
    rm -f "${harness_dir}"
    return 0
  fi
  for entry in "${harness_dir}"/* "${harness_dir}"/.[!.]* "${harness_dir}"/..?*; do
    [ -e "${entry}" ] || [ -L "${entry}" ] || continue
    if [ -L "${entry}" ] && { resolves_into_skills_dir "${entry}" || resolves_into_agents_dir "${entry}"; }; then
      rm -f "${entry}"
    fi
  done
  if [ -d "${harness_dir}" ]; then
    rmdir "${harness_dir}" 2>/dev/null || true
  fi
}

# Replace any legacy directory-level symlink (.claude/skills -> ../.ai/skills)
# with a real directory holding per-skill symlinks.
prepare_harness_dir() {
  harness_dir="$1"
  parent_dir=$(dirname "${harness_dir}")
  mkdir -p "${parent_dir}"
  if [ -L "${harness_dir}" ]; then
    rm -f "${harness_dir}"
  fi
  if [ ! -d "${harness_dir}" ]; then
    mkdir -p "${harness_dir}"
  fi
}

sweep_harness() {
  harness_dir="$1"
  selected_list="$2"
  [ -d "${harness_dir}" ] || return 0
  for entry in "${harness_dir}"/*; do
    [ -L "${entry}" ] || continue
    base=$(basename "${entry}")
    keep=0
    for skill in ${selected_list}; do
      if [ "${skill}" = "${base}" ]; then
        keep=1
        break
      fi
    done
    if [ "${keep}" -eq 0 ] && resolves_into_skills_dir "${entry}"; then
      rm -f "${entry}"
    fi
  done
}

print_list() {
  for tier in ${all_tier_names}; do
    count=$(tier_skill_count "${tier}")
    if is_default_tier "${tier}"; then
      label="default"
    else
      label="opt-in"
    fi
    printf '%-12s (%s skills, %s):\n' "${tier}" "${count}" "${label}"
    skills=$(tier_skills "${tier}" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
    printf '  %s\n' "${skills}"
  done

  external_source=$(jq -r '.external.source // empty' "${manifest}")
  if [ -n "${external_source}" ]; then
    printf '\n'
    printf 'external     (from %s):\n' "${external_source}"
    ext=$(jq -r '.external.skills[]?' "${manifest}" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
    printf '  %s\n' "${ext}"
  fi
}

if [ "${list_only}" -eq 1 ]; then
  print_list
  exit 0
fi

if [ "${clean_only}" -eq 1 ]; then
  clean_harness "${repo_root}/.claude/skills"
  clean_harness "${repo_root}/.codex/skills"
  if [ -d "${agents_dir}" ]; then
    rm -rf "${agents_dir}"
    echo "info: removed external skill copies under .agents/skills/."
  fi
  echo "info: removed all skill symlinks under .claude/skills/ and .codex/skills/."
  exit 0
fi

selected_tiers=""

case "${mode}" in
  ""|"with")
    for tier in ${default_tier_names}; do
      selected_tiers="${selected_tiers}
${tier}"
    done
    if [ "${mode}" = "with" ]; then
      extra_tiers=$(split_csv "${with_csv}")
      if [ -z "${extra_tiers}" ]; then
        echo "install-skills: --with requires at least one tier name." >&2
        exit 1
      fi
      for tier in ${extra_tiers}; do
        if ! tier_defined "${tier}"; then
          echo "install-skills: unknown tier '${tier}'." >&2
          echo "  Valid tiers: $(printf '%s\n' ${all_tier_names} | tr '\n' ' ' | sed 's/ $//')" >&2
          exit 1
        fi
        selected_tiers="${selected_tiers}
${tier}"
      done
    fi
    ;;
  "tiers")
    requested_tiers=$(split_csv "${tiers_csv}")
    if [ -z "${requested_tiers}" ]; then
      echo "install-skills: --tiers requires at least one tier name." >&2
      exit 1
    fi
    for tier in ${requested_tiers}; do
      if ! tier_defined "${tier}"; then
        echo "install-skills: unknown tier '${tier}'." >&2
        echo "  Valid tiers: $(printf '%s\n' ${all_tier_names} | tr '\n' ' ' | sed 's/ $//')" >&2
        exit 1
      fi
      selected_tiers="${selected_tiers}
${tier}"
    done
    ;;
  "all")
    for tier in ${all_tier_names}; do
      selected_tiers="${selected_tiers}
${tier}"
    done
    ;;
esac

selected_tiers=$(printf '%s\n' "${selected_tiers}" | dedup_lines)

selected_skills=""
for tier in ${selected_tiers}; do
  for skill in $(tier_skills "${tier}"); do
    selected_skills="${selected_skills}
${skill}"
  done
done
selected_skills=$(printf '%s\n' "${selected_skills}" | dedup_lines)

if [ -z "${selected_skills}" ]; then
  echo "install-skills: no skills selected for installation." >&2
  exit 1
fi

external_skills_list=$(jq -r '.external.skills[]?' "${manifest}")

is_external_skill() {
  needle="$1"
  for candidate in ${external_skills_list}; do
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

install_into_harness() {
  harness_dir="$1"
  prepare_harness_dir "${harness_dir}"
  for skill in ${selected_skills}; do
    if is_external_skill "${skill}"; then
      # Owned by the external collection; a same-named .ai/skills/ folder is a
      # repo-local override and must not shadow the npx-installed skill.
      echo "install-skills: warning: '${skill}' is an external skill; skipping local symlink." >&2
      continue
    fi
    skill_target="${skills_dir}/${skill}"
    if [ ! -d "${skill_target}" ]; then
      echo "install-skills: skill folder '${skill_target}' is missing on disk." >&2
      exit 1
    fi
    link_path="${harness_dir}/${skill}"
    ln -sfn "../../.ai/skills/${skill}" "${link_path}"
  done
  sweep_harness "${harness_dir}" "${selected_skills}"
}

install_into_harness "${repo_root}/.claude/skills"
install_into_harness "${repo_root}/.codex/skills"

# Mix in the external shared collection (open-mercato/skills). Only the explicit
# subset this app ships (external.skills) is installed — never the whole
# collection. The npx CLI copies each skill into .agents/skills/ and symlinks
# .claude/skills/<name> because that directory exists.
external_source=$(jq -r '.external.source // empty' "${manifest}")
external_status="none"
# The skills CLI matches each --skill value against skill names verbatim (no
# comma splitting), so the subset must be passed as repeated --skill flags.
external_skill_args=""
for external_skill in $(printf '%s\n' "${external_skills_list}" | dedup_lines); do
  external_skill_args="${external_skill_args} --skill ${external_skill}"
done
if [ -n "${external_source}" ] && [ -n "${external_skill_args}" ]; then
  if [ "${no_external}" = "1" ]; then
    external_status="skipped (--no-external)"
  elif ! command -v npx >/dev/null 2>&1; then
    external_status="skipped (npx not found)"
    echo "install-skills: warning: npx not found; skipping external skills from ${external_source}." >&2
  elif (cd "${repo_root}" && npx -y skills add "${external_source}" ${external_skill_args} --agent claude-code --agent codex -y); then
    external_status="installed from ${external_source}"
    # `add` seeds the subset; a follow-up `update` bumps already-installed skills
    # to the latest published versions on a re-run. Non-fatal when offline mid-run.
    if (cd "${repo_root}" && npx -y skills update --project -y); then
      external_status="updated to latest from ${external_source}"
    else
      echo "install-skills: warning: could not update external skills to latest;" >&2
      echo "  the installed versions are kept. Re-run when online to refresh." >&2
    fi
    # The npx CLI symlinks .claude/skills/<name> itself and expects Codex to read
    # .agents/skills/ natively; mirror the symlinks into .codex/skills/ too.
    if [ -d "${agents_dir}" ]; then
      mkdir -p "${repo_root}/.codex/skills"
      for external_entry in "${agents_dir}"/*; do
        [ -d "${external_entry}" ] || continue
        ln -sfn "../../.agents/skills/$(basename "${external_entry}")" "${repo_root}/.codex/skills/$(basename "${external_entry}")"
      done
    fi
  else
    external_status="FAILED"
    echo "install-skills: warning: installing external skills from ${external_source} failed;" >&2
    echo "  local tier skills are installed. Re-run when online, or pass --no-external to silence this." >&2
  fi
fi

skill_count=$(printf '%s\n' "${selected_skills}" | grep -c '.' || true)
tier_count=$(printf '%s\n' "${selected_tiers}" | grep -c '.' || true)
tier_summary=$(printf '%s\n' "${selected_tiers}" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')

printf 'Installed %s local skills across %s tiers: %s.\n' "${skill_count}" "${tier_count}" "${tier_summary}"
if [ "${external_status}" != "none" ]; then
  printf 'External skills: %s.\n' "${external_status}"
fi

if [ -z "${mode}" ]; then
  cat <<'EOF'
Tip: opt into more skills with `yarn install-skills --with automation` or `--all`.
     See `yarn install-skills --list` for the full catalog.
EOF
fi
