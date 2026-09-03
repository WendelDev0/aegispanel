const PUBLIC_BUILD_PREFIXES = [
  'VITE_',
  'NEXT_PUBLIC_',
  'NUXT_PUBLIC_',
  'GATSBY_',
  'REACT_APP_',
  'PUBLIC_',
];

const PUBLIC_BUILD_NAMES = new Set(['NODE_ENV', 'PORT']);
const DOCKER_ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Only variables that are intentionally public may cross the image build
 * boundary. Everything else belongs to the runtime container environment.
 */
export function isPublicBuildVariable(key: string): boolean {
  return (
    DOCKER_ARG_NAME.test(key) &&
    (PUBLIC_BUILD_NAMES.has(key) || PUBLIC_BUILD_PREFIXES.some((prefix) => key.startsWith(prefix)))
  );
}

export function publicBuildArgs(env: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (isPublicBuildVariable(key)) args.push('--build-arg', `${key}=${value}`);
  }
  return args;
}

/** dockerode `buildargs` map — same public-only filter as the CLI flags. */
export function publicBuildArgMap(env: Record<string, string>): Record<string, string> {
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isPublicBuildVariable(key)) args[key] = value;
  }
  return args;
}

/** Adds public ARG/ENV declarations to a generated Dockerfile builder stage. */
export function injectPublicBuildArgs(dockerfile: string, env: Record<string, string>): string {
  const keys = Object.keys(env).filter(isPublicBuildVariable);
  if (!keys.length) return dockerfile;

  const declarations = keys.map((key) => `ARG ${key}\nENV ${key}=$${key}`).join('\n');
  return dockerfile.replace(/^(FROM [^\r\n]+)$/m, `$1\n${declarations}`);
}
