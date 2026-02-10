#!/usr/bin/env python3
import sys
import re
from pathlib import Path

def validate_naming(file_path):
    """
    Scan a SPEC file for Command/Event IDs and verify singular naming.
    Pattern: module.entity.action
    """
    path = Path(file_path)
    if not path.is_absolute():
        # If relative, check relative to CWD or resolve
        path = path.resolve()
        
    if not path.exists():
        print(f"Error: File not found at {path}")
        return False
        
    content = path.read_text()
    
    # Simple regex to find patterns like module.entity.action or module.entity.verb
    # Matches strings that look like IDs
    id_pattern = re.compile(r'\b([a-z0-9-]+)\.([a-z0-9-]+)\.([a-z0-9-]+)\b')
    
    matches = id_pattern.findall(content)
    violations = []
    
    # Common plural suffixes to check for
    # This is a heuristic: checking if the middle part (entity) ends with 's' 
    # but isn't something like 'status' or 'address'
    common_singular_s = ['status', 'address', 'access', 'process', 'business', 'analysis', 'class', 'mass', 'pass']
    
    for module, entity, action in matches:
        if entity.endswith('s') and entity not in common_singular_s:
            violations.append(f"{module}.{entity}.{action}")
            
    if violations:
        print("❌ Naming violations found (plural entities in IDs):")
        for v in violations:
            print(f"  - {v}")
        return False
    else:
        print("✅ No plural entity naming violations found.")
        return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: validate_naming.py <spec_file_path>")
        sys.exit(1)
        
    if validate_naming(sys.argv[1]):
        sys.exit(0)
    else:
        sys.exit(1)
