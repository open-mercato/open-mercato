import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);

function show(ref, path) {
  return execSync(`git show ${ref}:${JSON.stringify(path)}`, { maxBuffer: 1024 * 1024 * 64 }).toString('utf8');
}

for (const path of files) {
  const ours = JSON.parse(show(':2', path));
  const theirs = JSON.parse(show(':3', path));
  const merged = {};
  const conflicts = [];
  const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
  for (const key of keys) {
    const hasOurs = Object.prototype.hasOwnProperty.call(ours, key);
    const hasTheirs = Object.prototype.hasOwnProperty.call(theirs, key);
    if (hasOurs && hasTheirs && ours[key] !== theirs[key]) {
      conflicts.push(key);
      merged[key] = theirs[key];
    } else if (hasOurs) {
      merged[key] = ours[key];
    } else {
      merged[key] = theirs[key];
    }
  }
  const sortedKeys = Object.keys(merged).sort();
  const sorted = {};
  for (const k of sortedKeys) sorted[k] = merged[k];
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n');
  console.log(path, '-> merged', sortedKeys.length, 'keys', conflicts.length ? `CONFLICTS: ${conflicts.join(',')}` : '');
}
