import { execFile } from 'child_process'
import { promisify } from 'util'
import { ErrorCode, GitAdapterError } from '@commitspark/git-adapter'

const execFileAsync = promisify(execFile)

/**
 * Runs git and returns its trimmed standard output. Any failure is thrown as `GitAdapterError` with code
 * `INTERNAL_ERROR`.
 */
export async function runGit(
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    return await execGit(args, cwd, env)
  } catch (error) {
    if (isGitBinaryMissing(error)) {
      throw createGitBinaryMissingError(cwd)
    }
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : undefined
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      `"git ${args.join(' ')}" failed${stderr ? `: ${stderr}` : ` (${(error as Error).message})`}`,
    )
  }
}

/**
 * Runs git and returns its trimmed standard output, or `undefined` if git exits with an error, e.g. because a ref
 * does not exist.
 */
export async function tryGit(
  args: string[],
  cwd: string,
): Promise<string | undefined> {
  try {
    return await execGit(args, cwd)
  } catch (error) {
    if (isGitBinaryMissing(error)) {
      throw createGitBinaryMissingError(cwd)
    }
    return undefined
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const branch = await tryGit(['symbolic-ref', '--short', 'HEAD'], cwd)
  if (branch === undefined) {
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      'Failed to determine current branch; the repository must be on a branch, not in a detached HEAD state',
    )
  }
  return branch
}

// returns undefined if the branch has no commits yet
export async function getCurrentCommitHash(
  cwd: string,
): Promise<string | undefined> {
  return tryGit(['rev-parse', 'HEAD'], cwd)
}

// Node.js reports a missing working directory with the same error code as a missing binary
export function isGitBinaryMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

export function createGitBinaryMissingError(cwd: string): GitAdapterError {
  return new GitAdapterError(
    ErrorCode.INTERNAL_ERROR,
    `Failed to run git in "${cwd}"; this adapter requires the git binary on PATH and an existing working directory`,
  )
}

async function execGit(
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    args,
    env ? { cwd, env: { ...process.env, ...env } } : { cwd },
  )
  return stdout.trim()
}
