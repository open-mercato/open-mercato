import { existsSync, readFileSync } from 'node:fs';

export const partnerRegistryPath = '.github/certified-partners.yml';

export const parsePartnerLogins = (registryText: string): Set<string> => {
  const logins = new Set<string>();
  const addLogin = (rawLogin: string) => {
    const login = rawLogin.trim().replace(/^['"]|['"]$/g, '').trim();
    if (/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(login)) logins.add(login.toLowerCase());
  };

  let insideContributorsBlock = false;
  let contributorsIndent = 0;

  for (const rawLine of registryText.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    const flowList = trimmed.match(/^(?:-\s+)?contributors:\s*\[(.*)\]$/);
    if (flowList) {
      insideContributorsBlock = false;
      flowList[1].split(',').forEach(addLogin);
      continue;
    }

    if (/^(?:-\s+)?contributors:\s*$/.test(trimmed)) {
      insideContributorsBlock = true;
      contributorsIndent = indent;
      continue;
    }

    if (insideContributorsBlock && trimmed.startsWith('- ') && indent > contributorsIndent) {
      addLogin(trimmed.slice(2));
      continue;
    }

    insideContributorsBlock = false;
  }

  return logins;
};

export const readPartnerLogins = (): Set<string> => {
  if (!existsSync(partnerRegistryPath)) {
    throw new Error(`${partnerRegistryPath} is missing from the default branch.`);
  }
  const logins = parsePartnerLogins(readFileSync(partnerRegistryPath, 'utf8'));
  if (logins.size === 0) {
    throw new Error(`No contributors could be parsed from ${partnerRegistryPath}.`);
  }
  return logins;
};
