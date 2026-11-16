import { describe, expect, it } from 'vitest';
import { diagnosticBuildEnabled } from '../diagnostic-build-gate';

const branch = 'staging/security-audit';

describe('temporary diagnostic build gate', () => {
  it.each([
    {
      command: 'build',
      mode: 'production',
      vercelEnvironment: undefined,
      branch: undefined,
      expected: false,
    },
    {
      command: 'build',
      mode: 'staging',
      vercelEnvironment: undefined,
      branch: undefined,
      expected: true,
    },
    {
      command: 'build',
      mode: 'production',
      vercelEnvironment: 'production',
      branch,
      expected: false,
    },
    { command: 'build', mode: 'test', vercelEnvironment: 'production', branch, expected: false },
    { command: 'build', mode: 'production', vercelEnvironment: 'preview', branch, expected: true },
    {
      command: 'build',
      mode: 'production',
      vercelEnvironment: 'preview',
      branch: 'dfstock',
      expected: false,
    },
    {
      command: 'build',
      mode: 'production',
      vercelEnvironment: 'preview',
      branch: 'refs/heads/staging/security-audit',
      expected: false,
    },
    { command: 'build', mode: 'production', vercelEnvironment: 'Preview', branch, expected: false },
    { command: 'build', mode: 'production', vercelEnvironment: undefined, branch, expected: false },
    {
      command: 'serve',
      mode: 'test',
      vercelEnvironment: undefined,
      branch: undefined,
      expected: true,
    },
  ] as const)(
    'resolves $mode in $vercelEnvironment for $branch to $expected',
    ({ expected, ...options }) => {
      expect(diagnosticBuildEnabled(options)).toBe(expected);
    },
  );

  it.each([
    { vercelEnvironment: 'production', branch },
    { vercelEnvironment: 'preview', branch: 'dfstock' },
    { vercelEnvironment: 'Preview', branch },
  ])('rejects an explicit staging build in a conflicting deployment context', (deployment) => {
    expect(() =>
      diagnosticBuildEnabled({ command: 'build', mode: 'staging', ...deployment }),
    ).toThrow();
  });
});
