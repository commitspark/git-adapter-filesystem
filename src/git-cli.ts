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
    throw toGitAdapterError(args, cwd, error)
  }
}

function toGitAdapterError(
  args: string[],
  cwd: string,
  error: unknown,
): GitAdapterError {
  if (isGitBinaryMissing(error)) {
    return createGitBinaryMissingError(cwd)
  }
  const stderr =
    error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr: unknown }).stderr).trim()
      : undefined
  return new GitAdapterError(
    ErrorCode.INTERNAL_ERROR,
    `"git ${args.join(' ')}" failed${stderr ? `: ${stderr}` : ` (${(error as Error).message})`}`,
  )
}

/**
 * Runs git and returns its trimmed standard output, or `undefined` if git exits with code 1, which commands run with
 * `--quiet` use to report that a ref or commit does not exist. Any other failure is thrown as with `runGit()`.
 */
async function tryGit(
  args: string[],
  cwd: string,
): Promise<string | undefined> {
  try {
    return await execGit(args, cwd)
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) {
      return undefined
    }
    throw toGitAdapterError(args, cwd, error)
  }
}

/**
 * Resolves the given revision to a commit hash, or returns `undefined` if it does not resolve to a commit.
 */
export async function resolveCommit(
  cwd: string,
  revision: string,
): Promise<string | undefined> {
  return tryGit(
    ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`],
    cwd,
  )
}

/**
 * Throws if the working directory is not the top-level folder of a repository, as paths of this adapter are relative
 * to the working directory for file system access but relative to the top-level folder in Git trees.
 */
export async function assertTopLevelWorkingDirectory(
  cwd: string,
): Promise<void> {
  const prefix = await runGit(['rev-parse', '--show-prefix'], cwd)
  if (prefix !== '') {
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      `Working directory "${cwd}" must be the top-level folder of its Git repository, not subfolder "${prefix}"`,
    )
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const branch = await tryGit(
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd,
  )
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
  return resolveCommit(cwd, 'HEAD')
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
