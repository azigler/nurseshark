// Loads and validates `sources.yml`. The pipeline DOES NOT clone or update
// the VS14 repo — the operator is responsible for keeping that checkout fresh.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';

export interface SourcesConfig {
  readonly vs14Path: string;
  readonly commitSha: string | null;
}

interface SourcesFileShape {
  sources?: {
    vs14?: {
      path?: string;
      commit_context?: string;
    };
  };
}

export function loadSources(
  configPath: string,
  nursesharkRoot: string,
): SourcesConfig {
  if (!existsSync(configPath)) {
    const example = resolve(nursesharkRoot, 'sources.example.yml');
    throw new Error(
      `sources.yml not found at ${configPath}.\n` +
        `Copy ${example} to sources.yml and edit the path to point at your VS14 clone.`,
    );
  }

  const raw = readFileSync(configPath, 'utf8');
  const doc = parseYaml(raw) as SourcesFileShape | null;
  const vs14 = doc?.sources?.vs14;
  if (!vs14?.path) {
    throw new Error(`sources.yml: missing sources.vs14.path`);
  }

  const vs14Path = isAbsolute(vs14.path)
    ? vs14.path
    : resolve(nursesharkRoot, vs14.path);
  if (!existsSync(vs14Path) || !statSync(vs14Path).isDirectory()) {
    throw new Error(
      `sources.yml: VS14 path does not exist or is not a directory: ${vs14Path}`,
    );
  }

  let commitSha: string | null = null;
  const commitContext = vs14.commit_context ?? 'auto';
  if (commitContext === 'auto') {
    try {
      commitSha = execSync('git rev-parse HEAD', {
        cwd: vs14Path,
        encoding: 'utf8',
      }).trim();
    } catch {
      console.warn(
        `WARN: could not read git HEAD from ${vs14Path}; meta.json will have ss14CommitSha = null`,
      );
    }
  } else if (typeof commitContext === 'string' && commitContext.length > 0) {
    commitSha = commitContext;
  }

  return { vs14Path, commitSha };
}
