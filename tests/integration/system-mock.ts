import { execFile } from 'child_process'
import * as fs from 'fs/promises'

const WORKING_DIRECTORY = '/repository'

// environment variables read by the adapter that must not leak in from the host (e.g. when running in CI)
const ADAPTER_ENV_VARS = ['GITHUB_WORKSPACE', 'CI_PROJECT_DIR']

let originalEnv: Record<string, string | undefined> = {}

export const setUpEnvironment = (): void => {
  originalEnv = Object.fromEntries(
    ADAPTER_ENV_VARS.map((name) => [name, process.env[name]]),
  )
  ADAPTER_ENV_VARS.forEach((name) => delete process.env[name])
  process.env.GITHUB_WORKSPACE = WORKING_DIRECTORY
  // paths contain no symbolic links unless a test mocks otherwise
  mockSymbolicLinks([])
}

export const restoreEnvironment = (): void => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
}

type GitResponse = string | Error

// git invocation outcome keyed by space-joined arguments; a string is returned as stdout, an error is thrown;
// an array provides outcomes for consecutive invocations
type GitResponses = Record<string, GitResponse | GitResponse[]>

export const mockGit = (responses: GitResponses): void => {
  const callCounts: Record<string, number> = {}
  jest.mocked(execFile).mockImplementation(((
    file: string,
    args: string[],
    options: unknown,
    callback: (error: Error | null, result?: object) => void,
  ) => {
    const key = args.join(' ')
    const callIndex = callCounts[key] ?? 0
    callCounts[key] = callIndex + 1
    const response = Array.isArray(responses[key])
      ? responses[key][callIndex]
      : responses[key]
    if (response === undefined) {
      callback(new Error(`Unexpected call "${file} ${args.join(' ')}"`))
    } else if (response instanceof Error) {
      callback(response)
    } else {
      callback(null, { stdout: `${response}\n`, stderr: '' })
    }
  }) as unknown as typeof execFile)
}

// arguments of all git invocations in call order
export const getGitCalls = (): string[][] =>
  jest.mocked(execFile).mock.calls.map((call) => {
    expect(call[0]).toEqual('git')
    expect(call[2]).toMatchObject({ cwd: WORKING_DIRECTORY })
    return call[1] as string[]
  })

// value of the given environment variable passed to each git invocation, in call order
export const getGitCallEnvironmentValues = (
  name: string,
): (string | undefined)[] =>
  jest
    .mocked(execFile)
    .mock.calls.map(
      (call) =>
        (call[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env?.[name],
    )

// every git invocation fails as if the git binary were not installed
export const mockMissingGit = (): void => {
  jest
    .mocked(execFile)
    .mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null) => void,
    ) => callback(createGitNotFoundError())) as unknown as typeof execFile)
}

export const createGitFailedError = (stderr: string): Error =>
  Object.assign(new Error('Command failed'), { code: 128, stderr: stderr })

const createGitNotFoundError = (): Error =>
  Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })

// the given absolute paths are symbolic links, all other paths exist and are no symbolic links
export const mockSymbolicLinks = (symbolicLinkPaths: string[]): void => {
  jest.mocked(fs.lstat).mockImplementation((async (filePath: string) => ({
    isSymbolicLink: () => symbolicLinkPaths.includes(filePath),
  })) as unknown as typeof fs.lstat)
}
