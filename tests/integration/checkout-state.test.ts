import { ErrorCode } from '@commitspark/git-adapter'
import { execFile } from 'child_process'
import { createAdapter } from '../../src'
import {
  createGitFailedError,
  createGitNotFoundError,
  getGitCalls,
  mockGit,
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
    it('should return the checked out commit hash for the checked out branch', async () => {
      mockGit({
        'symbolic-ref --short HEAD': 'main',
        'rev-parse HEAD': commitHash,
      })

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).resolves.toEqual(commitHash)
      expect(getGitCalls()).toEqual([
        ['symbolic-ref', '--short', 'HEAD'],
        ['rev-parse', 'HEAD'],
      ])
    })

    it('should run git in the CI working directory', async () => {
      delete process.env.GITHUB_WORKSPACE
      process.env.CI_PROJECT_DIR = '/gitlab/project'
      mockGit({
        'symbolic-ref --short HEAD': 'main',
        'rev-parse HEAD': commitHash,
      })

      await createAdapter({}).getLatestCommitHash('main')

      expect(jest.mocked(execFile).mock.calls[0][2]).toEqual({
        cwd: '/gitlab/project',
      })
    })

    it('should throw GitAdapterError with BAD_REQUEST when ref is not checked out', async () => {
      mockGit({
        'symbolic-ref --short HEAD': 'main',
        'rev-parse HEAD': commitHash,
      })

      await expect(
        createAdapter({}).getLatestCommitHash('other'),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
    })

    it('should throw GitAdapterError with BAD_REQUEST when branch has no commits', async () => {
      mockGit({
        'symbolic-ref --short HEAD': 'main',
        'rev-parse HEAD': createGitFailedError(
          "fatal: ambiguous argument 'HEAD'",
        ),
      })

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when HEAD is detached', async () => {
      mockGit({
        'symbolic-ref --short HEAD': createGitFailedError(
          'fatal: ref HEAD is not a symbolic ref',
        ),
        'rev-parse HEAD': commitHash,
      })

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })
  })

  describe('without git binary', () => {
    beforeEach(() => {
      mockGit({
        'symbolic-ref --short HEAD': createGitNotFoundError(),
        'rev-parse HEAD': createGitNotFoundError(),
      })
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
