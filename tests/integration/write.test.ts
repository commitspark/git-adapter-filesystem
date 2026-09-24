import { CommitDraft, ErrorCode } from '@commitspark/git-adapter'
import * as fs from 'fs/promises'
import { createAdapter } from '../../src'
import {
  createFsError,
  createGitFailedError,
  getGitCalls,
  mockGit,
  restoreEnvironment,
  setUpEnvironment,
} from './system-mock'

jest.mock('child_process', () => ({ execFile: jest.fn() }))
jest.mock('fs/promises')

describe('Writing', () => {
  const parentCommitHash = 'abc123'
  const newCommitHash = 'def456'
  const entryFolder = '/repository/commitspark/entries'

  const mockedFs = jest.mocked(fs)

  // HEAD is checked before and after committing the given paths on branch "main"
  const mockCommittingGit = (committedPaths: string[], message: string) =>
    mockGit({
      'symbolic-ref --short HEAD': 'main',
      'rev-parse HEAD': [parentCommitHash, newCommitHash],
      [['add', '--', ...committedPaths].join(' ')]: '',
      [['commit', `--message=${message}`, '--', ...committedPaths].join(' ')]:
        '',
    })

  const createDraft = (
    entries: CommitDraft['entries'],
    message: string = 'Test commit',
  ): CommitDraft => ({
    ref: 'main',
    parentSha: parentCommitHash,
    message: message,
    entries: entries,
  })

  beforeEach(() => {
    jest.resetAllMocks()
    setUpEnvironment()
  })

  afterEach(() => {
    restoreEnvironment()
  })

  describe('createCommit', () => {
    it('should write, stage and commit only the changed entry files', async () => {
      mockedFs.stat.mockResolvedValue({} as never)
      mockCommittingGit(
        ['commitspark/entries/a.yaml', 'commitspark/entries/b.yaml'],
        'Change entries',
      )

      await expect(
        createAdapter({}).createCommit(
          createDraft(
            [
              {
                id: 'a',
                metadata: { type: 'A' },
                data: { field: 'value' },
                deletion: false,
              },
              { id: 'b', metadata: { type: 'A' }, data: {}, deletion: true },
            ],
            'Change entries',
          ),
        ),
      ).resolves.toEqual({ commitHash: newCommitHash })

      expect(mockedFs.mkdir).toHaveBeenCalledWith(entryFolder, {
        recursive: true,
      })
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(1)
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        `${entryFolder}/a.yaml`,
        'metadata:\n  type: A\ndata:\n  field: value\n',
        { encoding: 'utf8' },
      )
      expect(mockedFs.stat).toHaveBeenCalledWith(`${entryFolder}/b.yaml`)
      expect(mockedFs.rm).toHaveBeenCalledTimes(1)
      expect(mockedFs.rm).toHaveBeenCalledWith(`${entryFolder}/b.yaml`)
      expect(getGitCalls()).toEqual([
        ['symbolic-ref', '--short', 'HEAD'],
        ['rev-parse', 'HEAD'],
        [
          'add',
          '--',
          'commitspark/entries/a.yaml',
          'commitspark/entries/b.yaml',
        ],
        [
          'commit',
          '--message=Change entries',
          '--',
          'commitspark/entries/a.yaml',
          'commitspark/entries/b.yaml',
        ],
        ['rev-parse', 'HEAD'],
      ])
    })

    it('should pass the commit message as a single option argument', async () => {
      const message = '--amend: message: with "quotes" and $(subshell)'
      mockCommittingGit(['commitspark/entries/a.yaml'], message)

      await createAdapter({}).createCommit(
        createDraft(
          [{ id: 'a', metadata: { type: 'A' }, data: {}, deletion: false }],
          message,
        ),
      )

      expect(getGitCalls()).toContainEqual([
        'commit',
        `--message=${message}`,
        '--',
        'commitspark/entries/a.yaml',
      ])
    })

    it('should write to a custom entry folder given with a trailing slash', async () => {
      mockCommittingGit(['content/entries/a.yaml'], 'Test commit')

      await createAdapter({ pathEntryFolder: 'content/entries/' }).createCommit(
        createDraft([
          { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
        ]),
      )

      expect(mockedFs.mkdir).toHaveBeenCalledWith(
        '/repository/content/entries',
        { recursive: true },
      )
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        '/repository/content/entries/a.yaml',
        expect.any(String),
        { encoding: 'utf8' },
      )
    })

    it('should skip deletions of entries that do not exist', async () => {
      mockedFs.stat.mockRejectedValue(createFsError('ENOENT'))
      mockCommittingGit(['commitspark/entries/a.yaml'], 'Test commit')

      await createAdapter({}).createCommit(
        createDraft([
          { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
          { id: 'missing', metadata: { type: 'A' }, data: {}, deletion: true },
        ]),
      )

      expect(mockedFs.rm).not.toHaveBeenCalled()
      expect(getGitCalls()).toContainEqual([
        'add',
        '--',
        'commitspark/entries/a.yaml',
      ])
    })

    it('should throw GitAdapterError with BAD_REQUEST when only non-existent entries are deleted', async () => {
      mockedFs.stat.mockRejectedValue(createFsError('ENOENT'))
      mockCommittingGit([], 'Test commit')

      await expect(
        createAdapter({}).createCommit(
          createDraft([
            {
              id: 'missing',
              metadata: { type: 'A' },
              data: {},
              deletion: true,
            },
          ]),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      expect(getGitCalls()).toEqual([
        ['symbolic-ref', '--short', 'HEAD'],
        ['rev-parse', 'HEAD'],
      ])
    })

    it('should throw GitAdapterError with BAD_REQUEST when ref is not checked out', async () => {
      mockCommittingGit([], 'Test commit')

      await expect(
        createAdapter({}).createCommit({
          ...createDraft([
            { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
          ]),
          ref: 'other',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      expect(mockedFs.writeFile).not.toHaveBeenCalled()
    })

    it('should throw GitAdapterError with CONFLICT when parent commit is outdated', async () => {
      mockCommittingGit([], 'Test commit')

      await expect(
        createAdapter({}).createCommit({
          ...createDraft([
            { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
          ]),
          parentSha: 'outdated',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
      expect(mockedFs.writeFile).not.toHaveBeenCalled()
      expect(getGitCalls()).toHaveLength(2)
    })

    it.each(['../escaped', 'nested/entry', '..\\escaped', 'a:b'])(
      'should throw GitAdapterError with BAD_REQUEST for entry ID "%s"',
      async (id) => {
        mockCommittingGit([], 'Test commit')

        await expect(
          createAdapter({}).createCommit(
            createDraft([
              { id: id, metadata: { type: 'A' }, data: {}, deletion: false },
            ]),
          ),
        ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
        expect(mockedFs.writeFile).not.toHaveBeenCalled()
        expect(mockedFs.rm).not.toHaveBeenCalled()
      },
    )

    it('should throw GitAdapterError with INTERNAL_ERROR including stderr when git commit fails', async () => {
      mockGit({
        'symbolic-ref --short HEAD': 'main',
        'rev-parse HEAD': parentCommitHash,
        'add -- commitspark/entries/a.yaml': '',
        'commit --message=Test commit -- commitspark/entries/a.yaml':
          createGitFailedError('Author identity unknown'),
      })

      await expect(
        createAdapter({}).createCommit(
          createDraft([
            { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
          ]),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
        message: expect.stringContaining('Author identity unknown'),
      })
    })
  })
})
