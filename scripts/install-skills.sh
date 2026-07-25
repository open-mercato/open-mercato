#!/bin/sh
set -eu

# Skill installer. Skills live in ONE canonical place — the cross-agent
# directory .agents/skills/ — and two sources are mixed into it:
#
#   1. Local tiered skills: reads .ai/skills/tiers.json (validated by
#      scripts/validate-skills-tiers.sh) and symlinks each selected skill into
#      .agents/skills/<name> -> ../../.ai/skills/<name>.
#   2. External shared skills: installs the open-mercato/skills collection via
#      `npx skills add` into the same .agents/skills/ directory, then runs
#      `npx skills update` so a re-run always refreshes the already installed
#      external skills to the latest published versions (the lockfile is
#      gitignored, so `add` seeds and `update` keeps them current).
#      The external source and skill list live under `external` in tiers.json.
#      A folder under .ai/skills/ matching an external skill name is a
#      repo-local override that the external skill reads in place; it is never
#      symlinked into the canonical or per-agent directories.
#
# Agent support matrix. Per-agent symlinks are created ONLY for agents that
# cannot read the canonical project-level .agents/skills/ directory, so no skill
# is duplicated across agent folders without reason:
#
#   agent id     project directory   reads .agents/skills/   per-agent symlinks
#   claude-code  .claude/skills      no                      yes (written by this script)
#   codex        .codex/skills       yes                     no
#   cursor       .cursor/skills      yes                     no
#
# The "reads .agents/skills/" column follows the universal-agent list of the
# `skills` CLI (vercel-labs/skills). Re-check it when an agent gains support:
# an agent that cannot read the canonical directory MUST keep its symlinks, or
# its skills silently disappear.
#
# Usage:
#   install-skills.sh                           # default tier set (core) + install/update external skills
#   install-skills.sh --with <csv>              # default + extra tiers (additive)
#   install-skills.sh --tiers <csv>             # exactly the listed tiers (replaces default)
#   install-skills.sh --all                     # every tier
#   install-skills.sh --legacy-links            # also symlink every skill into .claude/skills/ and .codex/skills/
#   install-skills.sh --ignore-agents <csv>     # never write these agents' directories
#   install-skills.sh --no-external             # skip the npx external-skills install/update step (offline)
#   install-skills.sh --list                    # print tier table + external collection and exit
#   install-skills.sh --clean                   # remove all skill symlinks and exit
#   install-skills.sh --help | -h               # show usage and exit

usage() {
  cat <<'EOF'
Usage: install-skills.sh [options]

Options:
  (no options)        Install the default tier set from .ai/skills/tiers.json
                      plus the external open-mercato/skills collection into the
                      canonical .agents/skills/ directory. Agents that cannot
                      read it (Claude Code) also get per-skill symlinks.
  --with <csv>        Install default tiers plus the given tier names (additive).
  --tiers <csv>       Install exactly the given tier names (replaces default).
  --all               Install every tier defined in tiers.json.
  --legacy-links      Restore the pre-canonical layout: symlink every skill into
                      .claude/skills/ AND .codex/skills/, even for agents that
                      read .agents/skills/ natively.
  --ignore-agents <csv>
                      Never write these agents' directories (claude-code, codex,
                      cursor). Defaults to `agents.ignore` in tiers.json; this
                      flag overrides it.
  --no-external       Skip the external-collection step for the external
                      collection — `npx skills add` on first run and
                      `npx skills update` on re-runs (also:
                      OM_SKIP_EXTERNAL_SKILLS=1). Use when offline.
  --list              Print the tier table, the external shared collection,
                      and the current install state, then exit.
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
legacy_links=0
ignore_agents_csv=""
ignore_agents_set=0
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
    --legacy-links)
      legacy_links=1
      shift
      ;;
    --ignore-agents)
      if [ $# -lt 2 ]; then
        echo "install-skills: --ignore-agents requires a comma-separated list of agent ids." >&2
        exit 1
      fi
      ignore_agents_csv="$2"
      ignore_agents_set=1
      shift 2
      ;;
    --ignore-agents=*)
      ignore_agents_csv="${1#--ignore-agents=}"
      ignore_agents_set=1
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

agents_dir="${repo_root}/.agents/skills"

# See the agent support matrix in the header comment.
known_agents="claude-code codex cursor"
legacy_agents="claude-code codex"

agent_dir() {
  case "$1" in
    claude-code) printf '%s' "${repo_root}/.claude/skills" ;;
    codex) printf '%s' "${repo_root}/.codex/skills" ;;
    cursor) printf '%s' "${repo_root}/.cursor/skills" ;;
  esac
}

agent_reads_canonical() {
  case "$1" in
    codex|cursor) return 0 ;;
    *) return 1 ;;
  esac
}

agent_known() {
  needle="$1"
  for candidate in ${known_agents}; do
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

is_legacy_agent() {
  needle="$1"
  for candidate in ${legacy_agents}; do
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

# The CLI flag overrides `agents.ignore` in tiers.json.
if [ "${ignore_agents_set}" -eq 1 ]; then
  ignored_agents=$(split_csv "${ignore_agents_csv}")
else
  ignored_agents=$(jq -r '.agents.ignore[]?' "${manifest}")
fi

for agent in ${ignored_agents}; do
  if ! agent_known "${agent}"; then
    echo "install-skills: unknown agent '${agent}'." >&2
    echo "  Valid agents: $(printf '%s' "${known_agents}")" >&2
    exit 1
  fi
done

is_ignored_agent() {
  needle="$1"
  for candidate in ${ignored_agents}; do
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

# Agents that get their own per-skill symlinks: in the default layout only the
# ones that cannot read .agents/skills/; with --legacy-links the historical pair.
link_agents=""
for agent in ${known_agents}; do
  if is_ignored_agent "${agent}"; then
    continue
  fi
  if [ "${legacy_links}" -eq 1 ]; then
    if is_legacy_agent "${agent}"; then
      link_agents="${link_agents} ${agent}"
    fi
  elif ! agent_reads_canonical "${agent}"; then
    link_agents="${link_agents} ${agent}"
  fi
done

is_link_agent() {
  needle="$1"
  for candidate in ${link_agents}; do
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
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
    if [ -L "${entry}" ] && { resolves_into_skills_dir "${entry}" || resolves_into_agents_dir "${entry}"; }; then
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

# Drop links to skills the external collection no longer ships: their target
# under .agents/skills/ is gone, so the link dangles.
prune_broken_links() {
  harness_dir="$1"
  [ -d "${harness_dir}" ] || return 0
  for entry in "${harness_dir}"/*; do
    [ -L "${entry}" ] || continue
    [ -e "${entry}" ] && continue
    rm -f "${entry}"
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

  list_external_source=$(jq -r '.external.source // empty' "${manifest}")
  list_external_skills=$(jq -r '.external.skills[]?' "${manifest}")
  if [ -n "${list_external_source}" ]; then
    list_external_count=$(printf '%s\n' "${list_external_skills}" | grep -c '.' || true)
    printf '%-12s (%s skills, from %s):\n' "external" "${list_external_count}" "${list_external_source}"
    skills=$(printf '%s\n' "${list_external_skills}" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
    printf '  %s\n' "${skills}"
  fi

  installed_dir="${agents_dir}"
  installed_count=0
  installed_tiers=""
  if [ -d "${installed_dir}" ] && [ ! -L "${installed_dir}" ]; then
    installed_skills=""
    for entry in "${installed_dir}"/*; do
      [ -L "${entry}" ] || continue
      resolves_into_skills_dir "${entry}" || continue
      installed_skills="${installed_skills}
$(basename "${entry}")"
    done
    installed_skills=$(printf '%s\n' "${installed_skills}" | dedup_lines | sort)
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
    printf 'Currently installed: none (0 local skills)\n'
  else
    if [ -z "${installed_tiers}" ]; then
      installed_tiers="unknown"
    fi
    printf 'Currently installed: %s (%s local skills)\n' "${installed_tiers}" "${installed_count}"
  fi
  if [ -n "${list_external_source}" ]; then
    installed_external_count=0
    if [ -d "${agents_dir}" ]; then
      for entry in "${agents_dir}"/*; do
        # Local tier skills are symlinks into .ai/skills/; external skills are
        # real directories copied in by the skills CLI.
        [ -L "${entry}" ] && continue
        [ -d "${entry}" ] || continue
        installed_external_count=$((installed_external_count + 1))
      done
    fi
    if [ "${installed_external_count}" -eq 0 ]; then
      printf 'External skills installed: none (run `yarn install-skills` to fetch from %s)\n' "${list_external_source}"
    else
      printf 'External skills installed: %s from %s (under .agents/skills/)\n' "${installed_external_count}" "${list_external_source}"
    fi
  fi
}

if [ "${list_only}" -eq 1 ]; then
  print_list
  exit 0
fi

if [ "${clean_only}" -eq 1 ]; then
  # Sweep every known agent directory (both the canonical link layer and any
  # leftovers from the legacy per-agent layout), then the canonical directory.
  for agent in ${known_agents}; do
    clean_harness "$(agent_dir "${agent}")"
  done
  if [ -d "${agents_dir}" ]; then
    rm -rf "${agents_dir}"
    echo "info: removed skills under .agents/skills/."
  fi
  echo "info: removed all skill symlinks under .claude/skills/, .codex/skills/ and .cursor/skills/."
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

# Local tier skills live once, in the canonical cross-agent directory.
install_canonical() {
  prepare_harness_dir "${agents_dir}"
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
    ln -sfn "../../.ai/skills/${skill}" "${agents_dir}/${skill}"
  done
  sweep_harness "${agents_dir}" "${selected_skills}"
}

# Link layer for agents that cannot read the canonical directory. Two kinds of
# skill live there and both must be linked:
#
#   - local tier skills, which are symlinks into .ai/skills/
#   - external skills, which the skills CLI copies in as real directories
#
# `npx skills add --agent <id>` is supposed to write the external links itself,
# but it only does so reliably for an agent directory that already exists (see
# vercel-labs/skills#744) and the canonical layout no longer pre-creates one. So
# the script owns this layer end to end: an agent that cannot read
# .agents/skills/ would otherwise silently lose the whole shared collection.
install_agent_links() {
  agent="$1"
  harness_dir=$(agent_dir "${agent}")
  prepare_harness_dir "${harness_dir}"
  for skill in ${selected_skills}; do
    if is_external_skill "${skill}"; then
      continue
    fi
    if [ "${legacy_links}" -eq 1 ]; then
      ln -sfn "../../.ai/skills/${skill}" "${harness_dir}/${skill}"
    else
      ln -sfn "../../.agents/skills/${skill}" "${harness_dir}/${skill}"
    fi
  done
  link_external_skills "${harness_dir}"
  sweep_harness "${harness_dir}" "${selected_skills}"
  prune_broken_links "${harness_dir}"
}

# Mirror every external skill (a real directory under the canonical dir) into an
# agent's own directory. Local tier skills are symlinks and are skipped here.
link_external_skills() {
  harness_dir="$1"
  [ -d "${agents_dir}" ] || return 0
  for entry in "${agents_dir}"/*; do
    [ -L "${entry}" ] && continue
    [ -d "${entry}" ] || continue
    external_name=$(basename "${entry}")
    ln -sfn "../../.agents/skills/${external_name}" "${harness_dir}/${external_name}"
  done
}

# Mix in the external shared collection (open-mercato/skills). The npx CLI copies
# each skill into .agents/skills/. This runs BEFORE the link layer is written:
# `skills update --project` owns .agents/skills/ and would otherwise prune entries
# it does not know about. The agent directories are written afterwards by
# install_agent_links, which does not rely on the CLI's own symlinking.
external_source=$(jq -r '.external.source // empty' "${manifest}")
external_status="none"
external_agent_args=""
for agent in ${link_agents}; do
  external_agent_args="${external_agent_args} --agent ${agent}"
done
if [ -z "${external_agent_args}" ]; then
  # No agent needs its own directory — install into .agents/skills/ only.
  external_agent_args=" --agent universal"
fi
if [ -n "${external_source}" ]; then
  if [ "${no_external}" = "1" ]; then
    external_status="skipped (--no-external)"
  elif ! command -v npx >/dev/null 2>&1; then
    external_status="skipped (npx not found)"
    echo "install-skills: warning: npx not found; skipping external skills from ${external_source}." >&2
  elif (cd "${repo_root}" && npx -y skills add "${external_source}" --skill '*' ${external_agent_args} -y); then
    external_status="installed from ${external_source}"
    # `add` seeds the collection (and re-resolves on a fresh checkout), but on a
    # clone that already has the skills a follow-up `update` guarantees they are
    # bumped to the latest published versions — the point of a re-run. The
    # lockfile is gitignored, so this is how contributors pick up new skills and
    # fixes without a manual reinstall. Non-fatal when offline mid-run: the
    # freshly added skills stay installed.
    if (cd "${repo_root}" && npx -y skills update --project -y); then
      external_status="updated to latest from ${external_source}"
    else
      echo "install-skills: warning: could not update external skills to latest;" >&2
      echo "  the installed versions are kept. Re-run when online to refresh." >&2
    fi
  else
    external_status="FAILED"
    echo "install-skills: warning: installing external skills from ${external_source} failed;" >&2
    echo "  local tier skills are installed. Re-run when online, or pass --no-external to silence this." >&2
  fi
fi

install_canonical

for agent in ${known_agents}; do
  if is_link_agent "${agent}"; then
    install_agent_links "${agent}"
  else
    # Not a link target (reads the canonical directory, or ignored): drop any
    # stale symlinks left behind by the legacy per-agent layout.
    clean_harness "$(agent_dir "${agent}")"
  fi
done

skill_count=$(printf '%s\n' "${selected_skills}" | grep -c '.' || true)
tier_count=$(printf '%s\n' "${selected_tiers}" | grep -c '.' || true)
tier_summary=$(printf '%s\n' "${selected_tiers}" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')

printf 'Installed %s local skills across %s tiers: %s.\n' "${skill_count}" "${tier_count}" "${tier_summary}"
if [ "${external_status}" != "none" ]; then
  printf 'External skills: %s.\n' "${external_status}"
fi
link_summary=$(printf '%s' "${link_agents}" | sed 's/^ *//; s/ /, /g')
if [ -z "${link_summary}" ]; then
  printf 'Layout: .agents/skills/ (canonical); no per-agent symlinks.\n'
else
  printf 'Layout: .agents/skills/ (canonical); per-agent symlinks: %s.\n' "${link_summary}"
fi

if [ -z "${mode}" ]; then
  cat <<'EOF'
Tip: opt into more skills with `yarn install-skills --with automation` or `--all`.
     See `yarn install-skills --list` for the full catalog.
EOF
fi
