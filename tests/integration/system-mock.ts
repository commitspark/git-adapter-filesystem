import { execFile } from 'child_process'
import * as fs from 'fs/promises'

export const WORKING_DIRECTORY = '/repository'

// environment variables read by the adapter that must not leak in from the host (e.g. when running in CI)
const ADAPTER_ENV_VARS = [
  'GITHUB_WORKSPACE',
  'CI_PROJECT_DIR',
  'GITHUB_REF_NAME',
  'CI_COMMIT_REF_NAME',
  'GITHUB_SHA',
  'CI_COMMIT_SHA',
]

let originalEnv: Record<string, string | undefined> = {}

export const setUpEnvironment = (): void => {
  originalEnv = Object.fromEntries(
    ADAPTER_ENV_VARS.map((name) => [name, process.env[name]]),
  )
  ADAPTER_ENV_VARS.forEach((name) => delete process.env[name])
  process.env.GITHUB_WORKSPACE = WORKING_DIRECTORY
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
export type GitResponses = Record<string, GitResponse | GitResponse[]>

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
    expect(call[2]).toEqual({ cwd: WORKING_DIRECTORY })
    return call[1] as string[]
  })

export const createGitFailedError = (stderr: string): Error =>
  Object.assign(new Error('Command failed'), { code: 128, stderr: stderr })

export const createGitNotFoundError = (): Error =>
  Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })

export const createFsError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: mocked filesystem error`), { code: code })

// file contents keyed by absolute path; paths not listed fail with ENOENT
export const mockReadFile = (files: Record<string, string | Error>): void => {
  jest.mocked(fs.readFile).mockImplementation((async (
    filePath: string,
    options?: { encoding?: BufferEncoding },
  ) => {
    const content = files[filePath]
    if (content === undefined) {
      throw createFsError('ENOENT')
    }
    if (content instanceof Error) {
      throw content
    }
    return options?.encoding ? content : Buffer.from(content, 'utf8')
  }) as unknown as typeof fs.readFile)
}
