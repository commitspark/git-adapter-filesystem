import { ErrorCode } from '@commitspark/git-adapter'
import { execFile } from 'child_process'
import { createAdapter } from '../../src'
import {
  createGitFailedError,
  getGitCalls,
  mockGit,
  mockMissingGit,
  restoreEnvironment,
  setUpEnvironment,
} from './system-mock'

jest.mock('child_process', () => ({ execFile: jest.fn() }))
jest.mock('fs/promises')

describe('Checkout state', () => {
  const commitHash = 'abc123'

  beforeEach(() => {
    jest.resetAllMocks()
    setUpEnvironment()
  })

  afterEach(() => {
    restoreEnvironment()
  })

  describe('getLatestCommitHash', () => {
    it('should resolve the ref with git rev-parse', async () => {
      mockGit({
        'rev-parse --show-prefix': '',
        'rev-parse --verify --quiet main^{commit}': commitHash,
      })

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).resolves.toEqual(commitHash)
      expect(getGitCalls()).toEqual([
        ['rev-parse', '--show-prefix'],
        ['rev-parse', '--verify', '--quiet', 'main^{commit}'],
      ])
    })

    it('should run git in the CI working directory', async () => {
      delete process.env.GITHUB_WORKSPACE
      process.env.CI_PROJECT_DIR = '/gitlab/project'
      mockGit({
        'rev-parse --show-prefix': '',
        'rev-parse --verify --quiet main^{commit}': commitHash,
      })

      await createAdapter({}).getLatestCommitHash('main')

      expect(jest.mocked(execFile).mock.calls[0][2]).toEqual({
        cwd: '/gitlab/project',
      })
    })

    it('should throw GitAdapterError with NOT_FOUND when the ref does not resolve to a commit', async () => {
      mockGit({
        'rev-parse --show-prefix': '',
        'rev-parse --verify --quiet other^{commit}': Object.assign(
          new Error('Command failed'),
          { code: 1, stderr: '' },
        ),
      })

      await expect(
        createAdapter({}).getLatestCommitHash('other'),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR including the message of git for a fatal git error', async () => {
      mockGit({
        'rev-parse --show-prefix': '',
        'rev-parse --verify --quiet main^{commit}': createGitFailedError(
          'fatal: detected dubious ownership in repository',
        ),
      })

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
        message: expect.stringContaining('dubious ownership'),
      })
      // the failed command is not run again to build the error
      expect(getGitCalls()).toHaveLength(2)
    })

    it('should throw GitAdapterError with BAD_REQUEST for a ref that would be an option', async () => {
      mockGit({})

      await expect(
        createAdapter({}).getLatestCommitHash('--all'),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      expect(getGitCalls()).toEqual([])
    })
  })

  describe('without git binary', () => {
    beforeEach(() => {
      mockMissingGit()
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when resolving a ref', async () => {
      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
        message: expect.stringContaining('requires the git binary'),
      })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when reading', async () => {
      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
        message: expect.stringContaining('requires the git binary'),
      })
    })
  })
})
