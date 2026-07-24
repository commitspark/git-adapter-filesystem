import { execFile } from 'child_process'
import { promisify } from 'util'
import { ErrorCode, GitAdapterError } from '@commitspark/git-adapter'

const execFileAsync = promisify(execFile)

export async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    return await execGit(args, cwd)
  } catch (error) {
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

export async function getCurrentBranch(cwd: string): Promise<string> {
  try {
    return await execGit(['symbolic-ref', '--short', 'HEAD'], cwd)
  } catch (error) {
    if (isGitBinaryMissing(error)) {
      const branch =
        process.env.GITHUB_REF_NAME ?? process.env.CI_COMMIT_REF_NAME
      if (branch) {
        return branch
      }
      throw new GitAdapterError(
        ErrorCode.INTERNAL_ERROR,
        'git binary not found on PATH, and no supported CI/CD environment variable ' +
          '(GITHUB_REF_NAME, CI_COMMIT_REF_NAME) present to determine the current branch',
      )
    }
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      'Failed to determine current branch; the repository must be on a branch, not in a detached HEAD state',
    )
  }
}

export async function getCurrentCommitHash(
  cwd: string,
): Promise<string | undefined> {
  try {
    return await execGit(['rev-parse', 'HEAD'], cwd)
  } catch (error) {
    if (isGitBinaryMissing(error)) {
      const commitHash = process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA
      if (commitHash) {
        return commitHash
      }
      throw new GitAdapterError(
        ErrorCode.INTERNAL_ERROR,
        'git binary not found on PATH, and no supported CI/CD environment variable ' +
          '(GITHUB_SHA, CI_COMMIT_SHA) present to determine the current commit hash',
      )
    }
    return undefined // e.g. unborn branch, no commits yet
  }
}

function isGitBinaryMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}
