import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
const markerRe = /^<<<<<<< .*\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> .*\r?\n/m;

function keyOf(line) {
  const match = line.match(/^\s*"([^"]+)"\s*:/);
  return match ? match[1] : null;
}

for (const path of files) {
  const text = readFileSync(path, 'utf8');
  let out = '';
  let rest = text;
  let conflictCount = 0;
  while (true) {
    const m = rest.match(markerRe);
    if (!m) { out += rest; break; }
    out += rest.slice(0, m.index);
    const oursLines = m[1].split('\n').filter((l) => l.length > 0);
    const theirsLines = m[2].split('\n').filter((l) => l.length > 0);
    const byKey = new Map();
    for (const l of oursLines) { const k = keyOf(l); if (k) byKey.set(k, l); }
    for (const l of theirsLines) { const k = keyOf(l); if (k) byKey.set(k, l); }
    const mergedLines = [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, l]) => l.replace(/,\s*$/, '') + ',');
    out += mergedLines.join('\n') + '\n';
    rest = rest.slice(m.index + m[0].length);
    conflictCount += 1;
  }
  writeFileSync(path, out);
  console.log(path, 'resolved', conflictCount, 'region(s)');
}
