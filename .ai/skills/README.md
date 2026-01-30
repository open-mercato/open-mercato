# Agent Skills

Skills extend AI agents with task-specific capabilities. This guide covers both **Claude Code** and **Codex** - note that they use different skill formats and locations.

This repository contains example skills for both tools in a unified structure.

---

## Repository Structure

```
.ai/skills/
├── README.md                           # This documentation
├── claude/                             # Claude Code skills (flat .md files)
│   └── backend-ui-design.md
└── codex/                              # Codex skills (folder-based)
    ├── references/                     # Shared references across skills
    └── backend-ui-design/
        ├── SKILL.md                    # Main skill file
        └── references/
            └── ui-components.md        # Skill-specific references
```

---

## Quick Comparison

| Aspect | Claude Code | Codex |
|--------|-------------|-------|
| **Skill location** | `.claude/skills/` | `.codex/skills/` |
| **Skill format** | `skill-name.md` | `skill-name/SKILL.md` |
| **Invoke syntax** | `/skill-name` | `$skill-name` |
| **List skills** | `/skills` | `/skills` |
| **Specification** | Claude-specific | [Agent Skills Standard](https://github.com/openai/agent-skills) |

---

## Installation

### For Claude Code

Option 1: Symlink the claude skills folder:

```bash
mkdir -p .claude
ln -s ../.ai/skills/claude .claude/skills
```

Option 2: Configure custom directory in `.claude/settings.json`:

```json
{
  "skills": {
    "directory": ".ai/skills/claude"
  }
}
```

### For Codex

Symlink the codex skills folder:

```bash
ln -s .ai/skills/codex .codex/skills
```

Or copy individual skills to your `.codex/skills/` directory.

### Verify Installation

**Claude Code:**
```bash
claude
> /skills
# Should list backend-ui-design
```

**Codex:**
```bash
codex
> /skills
# Should list backend-ui-design
```

---

## Claude Code Skills

### Directory Structure

Skills are single markdown files with YAML frontmatter:

```
.ai/skills/claude/              # or .claude/skills/
├── backend-ui-design.md
├── api-design.md
└── [skill-name].md
```

### Skill File Format

```markdown
---
name: skill-name
description: When to use this skill. Helps Claude select it automatically.
---

Instructions for Claude to follow when this skill is active.

## Section 1
...
```

### Using Skills in Claude Code

| Action | Command |
|--------|---------|
| Invoke skill | `/skill-name` |
| List skills | `/skills` |
| Get help | `/help skills` |

**Example:**
```bash
claude
> /backend-ui-design
> Create a customer list page with filtering
```

---

## Codex Skills

Codex uses the [Agent Skills Standard](https://github.com/openai/agent-skills). Skills are folders containing a `SKILL.md` file plus optional scripts and resources.

### Skill Structure

```
.ai/skills/codex/               # or .codex/skills/
└── my-skill/
    ├── SKILL.md                # Required: instructions + metadata
    ├── scripts/                # Optional: executable code
    ├── references/             # Optional: documentation
    └── assets/                 # Optional: templates, resources
```

### SKILL.md Format

```markdown
---
name: skill-name
description: Description that helps Codex select the skill
metadata:
  short-description: Optional user-facing description
---

Skill instructions for the Codex agent to follow when using this skill.

## Section 1
...
```

### Skill Locations (Precedence Order)

Codex loads skills from multiple locations. Higher precedence overrides lower when names collide:

| Precedence | Scope | Location | Use Case |
|------------|-------|----------|----------|
| 1 (highest) | REPO | `$CWD/.codex/skills` | Skills for current working directory |
| 2 | REPO | `$CWD/../.codex/skills` | Parent folder skills (monorepo modules) |
| 3 | REPO | `$REPO_ROOT/.codex/skills` | Repository-wide skills |
| 4 | USER | `~/.codex/skills` | Personal skills across all repos |
| 5 | ADMIN | `/etc/codex/skills` | System-wide admin skills |
| 6 (lowest) | SYSTEM | Bundled with Codex | Built-in skills (`$skill-creator`, etc.) |

**Example for monorepo:**
```
my-monorepo/
├── .codex/skills/              # Repo-wide skills (precedence 3)
│   └── repo-conventions/
│       └── SKILL.md
├── apps/
│   └── backend/
│       └── .codex/skills/      # Module-specific skills (precedence 1)
│           └── backend-api/
│               └── SKILL.md
└── packages/
```

### Progressive Disclosure

Codex uses **progressive disclosure** to manage context efficiently:

1. At startup, Codex loads only the `name` and `description` of each skill
2. Full instructions are loaded only when a skill is invoked
3. This keeps context small until capabilities are needed

### Invoking Skills in Codex

#### Explicit Invocation

You directly request a skill:

```
# Using slash command
/skills
→ Select from list

# Mentioning a skill with $
$backend-ui-design create a customer list page

# Or describe which skill to use
Please use the backend-ui-design skill to create a customer list page
```

**Note:** Codex web and iOS don't support explicit invocation yet, but can use skills checked into repos.

#### Implicit Invocation

Codex automatically selects skills when your task matches a skill's description:

```
# If backend-ui-design skill has description mentioning "admin pages", "CRUD", etc.
Create an admin page for managing products
→ Codex may automatically invoke backend-ui-design
```

### Installing Community Skills

Use the built-in `$skill-installer` to download skills:

```bash
# Install from curated skills
$skill-installer install the linear skill from the .experimental folder

# Install planning skill
$skill-installer install the create-plan skill from the .experimental folder

# Install from other repositories
$skill-installer install skill-name from github.com/user/repo
```

After installing, restart Codex to pick up new skills.

### Built-in Skills

| Skill | Description |
|-------|-------------|
| `$skill-creator` | Create new skills interactively |
| `$skill-installer` | Install community skills |
| `$create-plan` | Research and plan features (experimental, install first) |

### Creating Skills in Codex

**Option 1: Use skill-creator**
```
$skill-creator

I want to create a skill for designing backend admin pages...
```

**Option 2: Manual creation**
```bash
mkdir -p .ai/skills/codex/my-skill/references
touch .ai/skills/codex/my-skill/SKILL.md
```

### Disabling Skills

In `~/.codex/config.toml` (experimental):

```toml
[[skills.config]]
path = "/path/to/skill"
enabled = false
```

Restart Codex after changes.

---

## Converting Between Formats

### Claude Code → Codex

Convert a Claude Code skill to Codex format:

**Before (Claude Code):** `.ai/skills/claude/backend-ui-design.md`
```markdown
---
name: backend-ui-design
description: Design backend interfaces...
---

Instructions...
```

**After (Codex):** `.ai/skills/codex/backend-ui-design/SKILL.md`
```markdown
---
name: backend-ui-design
description: Design backend interfaces...
metadata:
  short-description: Backend UI design skill
---

Instructions...
```

### Codex → Claude Code

Convert a Codex skill to Claude Code format:

1. Copy `SKILL.md` content to `.ai/skills/claude/skill-name.md`
2. Remove `metadata` section from frontmatter (optional in Claude Code)
3. Inline any referenced files from `references/` folder

---

## Project Setup for Both Tools

This repository uses a unified structure in `.ai/skills/` with symlinks to tool-specific locations:

```
your-repo/
├── .ai/
│   └── skills/                      # Unified skill repository
│       ├── README.md
│       ├── claude/                  # Claude Code format skills
│       │   └── backend-ui-design.md
│       └── codex/                   # Codex format skills
│           └── backend-ui-design/
│               ├── SKILL.md
│               └── references/
│                   └── ui-components.md
├── .claude/
│   └── skills -> ../.ai/skills/claude    # Symlink for Claude Code
└── .codex/
    └── skills -> ../.ai/skills/codex     # Symlink for Codex
```

**Setup commands:**
```bash
# Create symlinks for both tools
mkdir -p .claude .codex
ln -s ../.ai/skills/claude .claude/skills
ln -s ../.ai/skills/codex .codex/skills
```

This approach:
- Keeps all skills in one location (`.ai/skills/`)
- Maintains tool-specific formats in subdirectories
- Uses symlinks so each tool finds skills in its expected location
- Makes it easy to version control and share skills

---

## Best Practices

### Writing Effective Descriptions

The `description` field drives automatic skill selection. Include:

- **Trigger words**: "when building", "when creating", "when designing"
- **Domain terms**: "admin pages", "API endpoints", "CRUD interfaces"
- **Outcomes**: "ensures consistency", "follows conventions"

**Good:**
```yaml
description: Design and implement backend/backoffice interfaces using @open-mercato/ui. Use when building admin pages, CRUD interfaces, data tables, forms, or detail pages.
```

**Weak:**
```yaml
description: Helps with UI stuff.
```

### Structuring Instructions

```markdown
## Principles
High-level guidelines and philosophy

## Components / Patterns
Specific implementations and code examples

## Checklist
Verification steps before completing work

## Anti-Patterns
What to explicitly avoid
```

### Skill Size Guidelines

| Size | Lines | Use Case |
|------|-------|----------|
| Small | < 100 | Simple conventions |
| Medium | 100-300 | Component libraries, API patterns |
| Large | 300-500 | Complex workflows |

If exceeding 500 lines, consider splitting into multiple skills or using `references/` folder (Codex).

---

## Skills vs Global Instructions

| File | Purpose | Scope | When Active |
|------|---------|-------|-------------|
| `CLAUDE.md` | Project instructions | Global | Always (Claude Code) |
| `AGENTS.md` | Agent conventions | Global | Always |
| `codex.md` | Project instructions | Global | Always (Codex) |
| Skills | Task-specific guidance | Per-task | On demand |

**Use skills when:**
- Instructions are task-specific
- You want explicit invocation control
- Guidance is substantial (>50 lines)

---

## Available Skills

| Skill | Description | Claude Code | Codex |
|-------|-------------|-------------|-------|
| `backend-ui-design` | Backend/admin UI using @open-mercato/ui | `/backend-ui-design` | `$backend-ui-design` |

---

## Troubleshooting

### Skill Not Found

| Tool | Solution |
|------|----------|
| **Claude Code** | Check symlink exists: `ls -la .claude/skills` |
| **Codex** | Check symlink exists: `ls -la .codex/skills` |
| **Both** | Verify skill file has valid YAML frontmatter |

### Symlink Issues

```bash
# Verify symlinks are correct
ls -la .claude/skills
ls -la .codex/skills

# Recreate if broken
rm .claude/skills .codex/skills
ln -s ../.ai/skills/claude .claude/skills
ln -s ../.ai/skills/codex .codex/skills
```

### Skill Not Auto-Selected

- Improve `description` with more specific trigger words
- Add domain-specific terminology
- Ensure description matches common task phrasings

### Codex Not Loading Updated Skill

- Restart Codex after adding/modifying skills
- Check `SKILL.md` has valid YAML frontmatter
- Verify folder is in a valid skill location

---

## References

### Claude Code
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [Extend Claude Code With Skills](https://code.claude.com/docs/en/skills)

### Codex
- [Codex Skills Documentation](https://openai.com/codex/skills)
- [Agent Skills Specification](https://github.com/openai/agent-skills)
- [Create Custom Skills Guide](https://openai.com/codex/skills/create)
