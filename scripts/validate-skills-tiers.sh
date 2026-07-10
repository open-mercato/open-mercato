#!/bin/sh
set -eu

# Validate .ai/skills/tiers.json against on-disk skill folders.
#
# Checks:
#   1. tiers.json is valid JSON.
#   2. `default` is non-empty and every entry names a defined tier.
#   3. Every folder under .ai/skills/ that contains a SKILL.md file is
#      assigned to exactly one tier — unless its name is listed in
#      `external.skills`, in which case it is a repo-local override of an
#      externally installed skill and must NOT be tiered.
#   4. No skill is assigned to more than one tier.
#   5. No name appears both in a tier and in `external.skills`.

if ! command -v jq >/dev/null 2>&1; then
  echo "validate-skills-tiers: jq is required but not installed." >&2
  echo "Install jq (e.g. 'sudo apt-get install jq' or 'brew install jq') and re-run." >&2
  exit 1
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "${repo_root}" ]; then
  echo "validate-skills-tiers: must be run from inside the open-mercato git checkout." >&2
  exit 1
fi

manifest="${repo_root}/.ai/skills/tiers.json"
skills_dir="${repo_root}/.ai/skills"

if [ ! -f "${manifest}" ]; then
  echo "validate-skills-tiers: missing manifest ${manifest}" >&2
  exit 1
fi

if [ ! -d "${skills_dir}" ]; then
  echo "validate-skills-tiers: missing skills directory ${skills_dir}" >&2
  exit 1
fi

if ! jq -e . "${manifest}" >/dev/null 2>&1; then
  echo "validate-skills-tiers: ${manifest} is not valid JSON." >&2
  exit 1
fi

tier_names=$(jq -r '.tiers | keys[]' "${manifest}")
default_tiers=$(jq -r '.default[]?' "${manifest}")

if [ -z "${default_tiers}" ]; then
  echo "validate-skills-tiers: 'default' must contain at least one tier name." >&2
  exit 1
fi

missing_default=""
for name in ${default_tiers}; do
  found=0
  for tier in ${tier_names}; do
    if [ "${tier}" = "${name}" ]; then
      found=1
      break
    fi
  done
  if [ "${found}" -eq 0 ]; then
    missing_default="${missing_default} ${name}"
  fi
done
if [ -n "${missing_default}" ]; then
  echo "validate-skills-tiers: 'default' references undefined tier(s):${missing_default}" >&2
  exit 1
fi

assigned_list=$(jq -r '[.tiers[].skills[]] | .[]' "${manifest}" | sort)
unique_assigned=$(printf '%s\n' "${assigned_list}" | sort -u)
multi_assigned=$(printf '%s\n' "${assigned_list}" | sort | uniq -d)

external_skills=$(jq -r '.external.skills[]?' "${manifest}" | sort -u)

is_external() {
  needle="$1"
  for candidate in ${external_skills}; do
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

# A skill name must not be both tier-assigned and owned by the external
# collection: the external copy is installed via `npx skills add` and a
# same-named folder under .ai/skills/ is only a repo-local override.
external_and_tiered=""
for assigned in ${unique_assigned}; do
  if is_external "${assigned}"; then
    external_and_tiered="${external_and_tiered} ${assigned}"
  fi
done

on_disk=$(find "${skills_dir}" -mindepth 2 -maxdepth 2 -type f -name SKILL.md \
  -exec dirname {} \; | xargs -n1 basename | sort -u)

unassigned=""
for skill in ${on_disk}; do
  if is_external "${skill}"; then
    # Repo-local override for an external skill; read in place, never symlinked.
    continue
  fi
  match=0
  for assigned in ${unique_assigned}; do
    if [ "${skill}" = "${assigned}" ]; then
      match=1
      break
    fi
  done
  if [ "${match}" -eq 0 ]; then
    unassigned="${unassigned} ${skill}"
  fi
done

stale=""
for assigned in ${unique_assigned}; do
  match=0
  for skill in ${on_disk}; do
    if [ "${assigned}" = "${skill}" ]; then
      match=1
      break
    fi
  done
  if [ "${match}" -eq 0 ]; then
    stale="${stale} ${assigned}"
  fi
done

problems=0
if [ -n "${external_and_tiered}" ]; then
  echo "validate-skills-tiers: skill(s) listed both in a tier and in 'external.skills':${external_and_tiered}" >&2
  echo "  External skills are installed via npx; remove them from the tier or from external.skills." >&2
  problems=1
fi
if [ -n "${unassigned}" ]; then
  echo "validate-skills-tiers: skill folder(s) on disk but not assigned to any tier:${unassigned}" >&2
  echo "  Add them to a tier in .ai/skills/tiers.json, or to external.skills if the folder is a repo-local override of an external skill." >&2
  problems=1
fi
if [ -n "${multi_assigned}" ]; then
  echo "validate-skills-tiers: skill(s) assigned to more than one tier:" >&2
  printf '  %s\n' ${multi_assigned} >&2
  problems=1
fi
if [ -n "${stale}" ]; then
  echo "validate-skills-tiers: tier(s) reference skill folder(s) that do not exist on disk:${stale}" >&2
  problems=1
fi

if [ "${problems}" -ne 0 ]; then
  exit 1
fi

skill_count=$(printf '%s\n' "${unique_assigned}" | grep -c '.' || true)
tier_count=$(printf '%s\n' "${tier_names}" | grep -c '.' || true)
echo "Validated ${skill_count} skills across ${tier_count} tiers."
