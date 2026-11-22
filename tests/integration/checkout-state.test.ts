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
      mockGit({ 'rev-parse --verify --quiet main^{commit}': commitHash })

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).resolves.toEqual(commitHash)
      expect(getGitCalls()).toEqual([
        ['rev-parse', '--verify', '--quiet', 'main^{commit}'],
      ])
    })

    it('should run git in the CI working directory', async () => {
      delete process.env.GITHUB_WORKSPACE
      process.env.CI_PROJECT_DIR = '/gitlab/project'
      mockGit({ 'rev-parse --verify --quiet main^{commit}': commitHash })

      await createAdapter({}).getLatestCommitHash('main')

      expect(jest.mocked(execFile).mock.calls[0][2]).toEqual({
        cwd: '/gitlab/project',
      })
    })

    it('should throw GitAdapterError with NOT_FOUND when the ref does not resolve to a commit', async () => {
      mockGit({
        'rev-parse --verify --quiet other^{commit}': createGitFailedError(''),
      })

      await expect(
        createAdapter({}).getLatestCommitHash('other'),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
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

    it('should determine branch and commit from GitHub Actions environment variables', async () => {
      process.env.GITHUB_REF_NAME = 'main'
      process.env.GITHUB_SHA = commitHash

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).resolves.toEqual(commitHash)
    })

    it('should determine branch and commit from GitLab CI/CD environment variables', async () => {
      process.env.CI_COMMIT_REF_NAME = 'main'
      process.env.CI_COMMIT_SHA = commitHash

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).resolves.toEqual(commitHash)
    })

    it('should resolve the checked out commit hash to itself', async () => {
      process.env.GITHUB_SHA = commitHash

      await expect(
        createAdapter({}).getLatestCommitHash(commitHash),
      ).resolves.toEqual(commitHash)
    })

    it('should throw GitAdapterError with BAD_REQUEST for a ref that is not checked out', async () => {
      process.env.GITHUB_REF_NAME = 'main'
      process.env.GITHUB_SHA = commitHash

      await expect(
        createAdapter({}).getLatestCommitHash('other'),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when branch cannot be determined', async () => {
      process.env.GITHUB_SHA = commitHash

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when commit cannot be determined', async () => {
      process.env.GITHUB_REF_NAME = 'main'

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })
  })
})
