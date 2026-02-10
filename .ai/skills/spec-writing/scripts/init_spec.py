#!/usr/bin/env python3
import sys
import os
import datetime
from pathlib import Path

def init_spec(spec_number, title):
    """
    Initialize a new SPEC from the template.
    """
    # Find repo root relative to this script: .ai/skills/spec-writing/scripts/init_spec.py
    script_path = Path(__file__).resolve()
    repo_root = script_path.parents[4]
    
    spec_dir = repo_root / ".ai/specs"
    template_path = repo_root / ".ai/skills/spec-writing/references/spec-template.md"
    
    if not template_path.exists():
        print(f"Error: Template not found at {template_path}")
        return False
        
    date_str = datetime.date.today().strftime("%Y-%m-%d")
    # Clean title for filename: replace spaces with hyphens, lowercase
    clean_title = title.lower().replace(" ", "-")
    # Format number as three digits
    spec_num_str = f"{int(spec_number):03d}"
    
    filename = f"SPEC-{spec_num_str}-{date_str}-{clean_title}.md"
    target_path = spec_dir / filename
    
    if target_path.exists():
        print(f"Error: SPEC file already exists at {target_path}")
        return False
        
    content = template_path.read_text()
    # Replace placeholder title in content
    content = content.replace("# SPEC-XXX: [Title]", f"# SPEC-{spec_num_str}: {title}")
    
    target_path.write_text(content)
    print(f"✅ Created new SPEC: {target_path}")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: init_spec.py <number> <title>")
        sys.exit(1)
        
    number = sys.argv[1]
    title = " ".join(sys.argv[2:])
    if init_spec(number, title):
        sys.exit(0)
    else:
        sys.exit(1)
