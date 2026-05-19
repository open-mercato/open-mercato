#!/bin/sh
set -eu

# Tiered, per-skill installer for Claude Code and Codex harnesses.
#
# Reads .ai/skills/tiers.json (validated by scripts/validate-skills-tiers.sh)
# and creates per-skill symlinks under .claude/skills/ and .codex/skills/.
#
# Usage:
#   install-skills.sh                           # default tier set (core)
#   install-skills.sh --with <csv>              # default + extra tiers (additive)
#   install-skills.sh --tiers <csv>             # exactly the listed tiers (replaces default)
#   install-skills.sh --all                     # every tier
#   install-skills.sh --list                    # print tier table and exit
#   install-skills.sh --clean                   # remove all skill symlinks and exit
#   install-skills.sh --help | -h               # show usage and exit

usage() {
  cat <<'EOF'
Usage: install-skills.sh [options]

Options:
  (no options)        Install the default tier set from .ai/skills/tiers.json.
  --with <csv>        Install default tiers plus the given tier names (additive).
  --tiers <csv>       Install exactly the given tier names (replaces default).
  --all               Install every tier defined in tiers.json.
  --list              Print the tier table and exit without installing.
  --clean             Remove all skill symlinks and exit.
  --help, -h          Show this message.

--with, --tiers, and --all are mutually exclusive.
EOF
}

if ! command -v jq >/dev/null 2>&1; then
  echo "install-skills: jq is required but not installed." >&2
  echo "Install jq (e.g. 'sudo apt-get install jq' or 'brew install jq') and re-run." >&2
  exit 1
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "${repo_root}" ]; then
  echo "install-skills: must be run from inside the open-mercato git checkout." >&2
  exit 1
fi

manifest="${repo_root}/.ai/skills/tiers.json"
skills_dir="${repo_root}/.ai/skills"

if [ ! -f "${manifest}" ]; then
  echo "install-skills: missing manifest ${manifest}" >&2
  exit 1
fi

validator="${repo_root}/scripts/validate-skills-tiers.sh"
if [ ! -x "${validator}" ] && [ ! -f "${validator}" ]; then
  echo "install-skills: missing validator ${validator}" >&2
  exit 1
fi

if ! sh "${validator}" >/dev/null; then
  # Re-run to surface its diagnostics on stderr.
  sh "${validator}" >&2 || true
  echo "install-skills: tier manifest validation failed; aborting." >&2
  exit 1
fi

mode=""
with_csv=""
tiers_csv=""
list_only=0
clean_only=0

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

tier_description() {
  jq -r --arg t "$1" '.tiers[$t].description' "${manifest}"
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

clean_harness() {
  harness_dir="$1"
  if [ ! -d "${harness_dir}" ] && [ ! -L "${harness_dir}" ]; then
    return 0
  fi
  if [ -L "${harness_dir}" ]; then
    target=$(readlink -f -- "${harness_dir}" 2>/dev/null || true)
    case "${target}" in
      "${skills_dir}")
        rm -f "${harness_dir}"
        return 0
        ;;
    esac
    return 0
  fi
  for entry in "${harness_dir}"/* "${harness_dir}"/.[!.]* "${harness_dir}"/..?*; do
    [ -e "${entry}" ] || [ -L "${entry}" ] || continue
    if [ -L "${entry}" ] && resolves_into_skills_dir "${entry}"; then
      rm -f "${entry}"
    fi
  done
  if [ -d "${harness_dir}" ]; then
    rmdir "${harness_dir}" 2>/dev/null || true
  fi
}

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

  installed_dir="${repo_root}/.claude/skills"
  installed_count=0
  installed_tiers=""
  if [ -d "${installed_dir}" ] && [ ! -L "${installed_dir}" ]; then
    installed_skills=$(ls -1 "${installed_dir}" 2>/dev/null | sort)
    if [ -n "${installed_skills}" ]; then
      installed_count=$(printf '%s\n' "${installed_skills}" | grep -c '.' || true)
      for tier in ${all_tier_names}; do
        tier_member_skills=$(tier_skills "${tier}")
        all_present=1
        any_present=0
        for skill in ${tier_member_skills}; do
          match=0
          for inst in ${installed_skills}; do
            if [ "${inst}" = "${skill}" ]; then
              match=1
              any_present=1
              break
            fi
          done
          if [ "${match}" -eq 0 ]; then
            all_present=0
          fi
        done
        if [ "${any_present}" -eq 1 ] && [ "${all_present}" -eq 1 ]; then
          if [ -z "${installed_tiers}" ]; then
            installed_tiers="${tier}"
          else
            installed_tiers="${installed_tiers}, ${tier}"
          fi
        fi
      done
    fi
  fi
  printf '\n'
  if [ "${installed_count}" -eq 0 ]; then
    printf 'Currently installed: none (0 skills)\n'
  else
    if [ -z "${installed_tiers}" ]; then
      installed_tiers="unknown"
    fi
    printf 'Currently installed: %s (%s skills)\n' "${installed_tiers}" "${installed_count}"
  fi
}

if [ "${list_only}" -eq 1 ]; then
  print_list
  exit 0
fi

if [ "${clean_only}" -eq 1 ]; then
  clean_harness "${repo_root}/.claude/skills"
  clean_harness "${repo_root}/.codex/skills"
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

install_into_harness() {
  harness_dir="$1"
  prepare_harness_dir "${harness_dir}"
  for skill in ${selected_skills}; do
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

skill_count=$(printf '%s\n' "${selected_skills}" | grep -c '.' || true)
tier_count=$(printf '%s\n' "${selected_tiers}" | grep -c '.' || true)
tier_summary=$(printf '%s\n' "${selected_tiers}" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')

printf 'Installed %s skills across %s tiers: %s.\n' "${skill_count}" "${tier_count}" "${tier_summary}"

if [ -z "${mode}" ]; then
  cat <<'EOF'
Tip: opt into more skills with `yarn install-skills --with automation` or `--all`.
     See `yarn install-skills --list` for the full catalog.
EOF
fi
