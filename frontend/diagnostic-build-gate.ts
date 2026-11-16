const STAGING_BRANCH = 'staging/security-audit';

/** Select the temporary diagnostic only for an explicit local build or its staging Preview. */
export function diagnosticBuildEnabled(options: {
  command: 'build' | 'serve';
  mode: string;
  vercelEnvironment: string | undefined;
  branch: string | undefined;
}): boolean {
  const { command, mode, vercelEnvironment, branch } = options;
  const explicitStagingBuild = command === 'build' && mode === 'staging';

  if (vercelEnvironment === 'production') {
    if (explicitStagingBuild) throw new Error('Staging diagnostic build forbidden in production');
    return false;
  }

  if (vercelEnvironment === 'preview') {
    if (branch !== STAGING_BRANCH) {
      if (explicitStagingBuild)
        throw new Error('Staging diagnostic build requires the staging branch');
      return false;
    }
    return (
      mode === 'production' || explicitStagingBuild || (command === 'serve' && mode === 'test')
    );
  }

  if (vercelEnvironment !== undefined) {
    if (explicitStagingBuild)
      throw new Error('Staging diagnostic build requires a valid deployment context');
    return false;
  }

  return explicitStagingBuild || (command === 'serve' && mode === 'test');
}
