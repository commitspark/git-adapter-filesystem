import { CommitDraft, ErrorCode } from '@commitspark/git-adapter'
import * as fs from 'fs/promises'
import { createAdapter } from '../../src'
import {
  createGitFailedError,
  getGitCallEnvironmentValues,
  getGitCalls,
  mockGit,
  mockSymbolicLinks,
  restoreEnvironment,
  setUpEnvironment,
} from './system-mock'

jest.mock('child_process', () => ({ execFile: jest.fn() }))
jest.mock('fs/promises')

describe('Writing', () => {
  const parentCommitHash = 'abc123'
  const newCommitHash = 'def456'
  const parentTreeHash = 'tree-parent'
  const newTreeHash = 'tree-new'
  const entryFolder = '/repository/commitspark/entries'
  const temporaryFolder = '/tmp/commitspark-test'
  const temporaryIndex = `${temporaryFolder}/index`

  const mockedFs = jest.mocked(fs)

  interface CommitMock {
    writtenPaths?: string[]
    deletedPaths?: string[]
    message?: string
    treeHash?: string
    headAfterCheck?: string
    updateRefResponse?: string | Error
    commitTreeResponse?: string | Error
  }

  const getBlobFilePaths = (writtenPaths: string[]): string[] =>
    writtenPaths.map((_, index) => `${temporaryFolder}/blob-${index}`)

  const getCacheInfoArguments = (writtenPaths: string[]): string[] =>
    writtenPaths.flatMap((writtenPath, index) => [
      '--cacheinfo',
      `100644,blob-hash-${index},${writtenPath}`,
    ])

  // mocks the git invocations of committing the given changes on branch "main" with parent `parentCommitHash`
  const mockCommittingGit = ({
    writtenPaths = [],
    deletedPaths = [],
    message = 'Test commit',
    treeHash = newTreeHash,
    headAfterCheck = parentCommitHash,
    updateRefResponse = '',
    commitTreeResponse = newCommitHash,
  }: CommitMock = {}) => {
    mockGit({
      'symbolic-ref --short HEAD': 'main',
      'rev-parse HEAD': [parentCommitHash, headAfterCheck],
      [`read-tree ${parentCommitHash}`]: '',
      [[
        'hash-object',
        '-w',
        '--no-filters',
        '--',
        ...getBlobFilePaths(writtenPaths),
      ].join(' ')]: writtenPaths
        .map((_, index) => `blob-hash-${index}`)
        .join('\n'),
      [['update-index', '--add', ...getCacheInfoArguments(writtenPaths)].join(
        ' ',
      )]: '',
      [['update-index', '--force-remove', '--', ...deletedPaths].join(' ')]: '',
      'write-tree': treeHash,
      [`rev-parse ${parentCommitHash}^{tree}`]: parentTreeHash,
      [['commit-tree', treeHash, '-p', parentCommitHash, '-m', message].join(
        ' ',
      )]: commitTreeResponse,
      [[
        'update-ref',
        '-m',
        `commit: ${message.split('\n')[0]}`,
        'refs/heads/main',
        newCommitHash,
        parentCommitHash,
      ].join(' ')]: updateRefResponse,
      [['reset', '--quiet', '--', ...writtenPaths, ...deletedPaths].join(' ')]:
        '',
    })
  }

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
    mockedFs.mkdtemp.mockResolvedValue(temporaryFolder)
  })

  afterEach(() => {
    restoreEnvironment()
  })

  describe('createCommit', () => {
    it('should commit the changed entry files on top of the parent commit and move the branch only if unchanged', async () => {
      mockCommittingGit({
        writtenPaths: ['commitspark/entries/a.yaml'],
        deletedPaths: ['commitspark/entries/b.yaml'],
        message: 'Change entries',
      })

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

      expect(getGitCalls()).toEqual([
        ['symbolic-ref', '--short', 'HEAD'],
        ['rev-parse', 'HEAD'],
        ['read-tree', parentCommitHash],
        [
          'hash-object',
          '-w',
          '--no-filters',
          '--',
          `${temporaryFolder}/blob-0`,
        ],
        [
          'update-index',
          '--add',
          '--cacheinfo',
          '100644,blob-hash-0,commitspark/entries/a.yaml',
        ],
        ['update-index', '--force-remove', '--', 'commitspark/entries/b.yaml'],
        ['write-tree'],
        ['rev-parse', `${parentCommitHash}^{tree}`],
        [
          'commit-tree',
          newTreeHash,
          '-p',
          parentCommitHash,
          '-m',
          'Change entries',
        ],
        [
          'update-ref',
          '-m',
          'commit: Change entries',
          'refs/heads/main',
          newCommitHash,
          parentCommitHash,
        ],
        [
          'reset',
          '--quiet',
          '--',
          'commitspark/entries/a.yaml',
          'commitspark/entries/b.yaml',
        ],
      ])
      // only index operations use the temporary index
      expect(getGitCallEnvironmentValues('GIT_INDEX_FILE')).toEqual([
        undefined,
        undefined,
        temporaryIndex,
        undefined,
        temporaryIndex,
        temporaryIndex,
        temporaryIndex,
        undefined,
        undefined,
        undefined,
        undefined,
      ])

      const entryContent = 'metadata:\n  type: A\ndata:\n  field: value\n'
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        `${temporaryFolder}/blob-0`,
        entryContent,
        { encoding: 'utf8' },
      )
      expect(mockedFs.mkdir).toHaveBeenCalledWith(entryFolder, {
        recursive: true,
      })
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        `${entryFolder}/a.yaml`,
        entryContent,
        { encoding: 'utf8' },
      )
      expect(mockedFs.rm).toHaveBeenCalledWith(`${entryFolder}/b.yaml`, {
        force: true,
      })
      expect(mockedFs.rm).toHaveBeenCalledWith(temporaryFolder, {
        recursive: true,
        force: true,
      })
    })

    it('should pass the commit message as a single option argument', async () => {
      const message = '--amend: message: with "quotes" and $(subshell)'
      mockCommittingGit({
        writtenPaths: ['commitspark/entries/a.yaml'],
        message: message,
      })

      await createAdapter({}).createCommit(
        createDraft(
          [{ id: 'a', metadata: { type: 'A' }, data: {}, deletion: false }],
          message,
        ),
      )

      expect(getGitCalls()).toContainEqual([
        'commit-tree',
        newTreeHash,
        '-p',
        parentCommitHash,
        '-m',
        message,
      ])
    })

    it('should use only the first line of a multi-line commit message for the reflog', async () => {
      const message = 'Headline\n\nBody'
      mockCommittingGit({
        writtenPaths: ['commitspark/entries/a.yaml'],
        message: message,
      })

      await createAdapter({}).createCommit(
        createDraft(
          [{ id: 'a', metadata: { type: 'A' }, data: {}, deletion: false }],
          message,
        ),
      )

      expect(getGitCalls()).toContainEqual([
        'update-ref',
        '-m',
        'commit: Headline',
        'refs/heads/main',
        newCommitHash,
        parentCommitHash,
      ])
    })

    it('should write to a custom entry folder given with a trailing slash', async () => {
      mockCommittingGit({ writtenPaths: ['content/entries/a.yaml'] })

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

    it('should throw GitAdapterError with BAD_REQUEST without moving the branch when the draft changes nothing', async () => {
      mockCommittingGit({
        deletedPaths: ['commitspark/entries/missing.yaml'],
        treeHash: parentTreeHash,
      })

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
      expect(getGitCalls()).not.toContainEqual(
        expect.arrayContaining(['commit-tree']),
      )
      expect(getGitCalls()).not.toContainEqual(
        expect.arrayContaining(['update-ref']),
      )
      expect(mockedFs.rm).toHaveBeenCalledTimes(1)
      expect(mockedFs.rm).toHaveBeenCalledWith(temporaryFolder, {
        recursive: true,
        force: true,
      })
    })

    it('should throw GitAdapterError with BAD_REQUEST when ref is not checked out', async () => {
      mockCommittingGit()

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

    it('should throw GitAdapterError with CONFLICT before creating a commit when the branch has moved', async () => {
      mockCommittingGit()

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

    it('should throw GitAdapterError with CONFLICT without touching the working tree when the branch moves while committing', async () => {
      mockCommittingGit({
        writtenPaths: ['commitspark/entries/a.yaml'],
        headAfterCheck: 'concurrent',
        updateRefResponse: createGitFailedError(
          "cannot lock ref 'refs/heads/main': is at concurrent but expected abc123",
        ),
      })

      await expect(
        createAdapter({}).createCommit(
          createDraft([
            { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
          ]),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
      expect(mockedFs.writeFile).not.toHaveBeenCalledWith(
        `${entryFolder}/a.yaml`,
        expect.anything(),
        expect.anything(),
      )
      expect(getGitCalls()).not.toContainEqual(
        expect.arrayContaining(['reset']),
      )
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when moving the branch fails although it has not moved', async () => {
      mockCommittingGit({
        writtenPaths: ['commitspark/entries/a.yaml'],
        updateRefResponse: createGitFailedError('unable to write new ref'),
      })

      await expect(
        createAdapter({}).createCommit(
          createDraft([
            { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
          ]),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
        message: expect.stringContaining('unable to write new ref'),
      })
    })

    it('should write entries to subfolders', async () => {
      mockCommittingGit({
        writtenPaths: ['commitspark/entries/blog/2024/a.yaml'],
      })

      await createAdapter({}).createCommit(
        createDraft([
          {
            id: 'blog/2024/a',
            metadata: { type: 'A' },
            data: {},
            deletion: false,
          },
        ]),
      )

      expect(getGitCalls()).toContainEqual([
        'update-index',
        '--add',
        '--cacheinfo',
        '100644,blob-hash-0,commitspark/entries/blog/2024/a.yaml',
      ])
      expect(mockedFs.mkdir).toHaveBeenCalledWith(`${entryFolder}/blog/2024`, {
        recursive: true,
      })
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        `${entryFolder}/blog/2024/a.yaml`,
        'metadata:\n  type: A\ndata: {}\n',
        { encoding: 'utf8' },
      )
    })

    it.each([
      ['a folder', 'alias/a', `${entryFolder}/alias`, false],
      ['the entry file', 'a', `${entryFolder}/a.yaml`, false],
      ['the entry file to delete', 'a', `${entryFolder}/a.yaml`, true],
    ])(
      'should throw GitAdapterError with BAD_REQUEST when %s is a symbolic link',
      async (_, id, symbolicLinkPath, deletion) => {
        mockCommittingGit()
        mockSymbolicLinks([symbolicLinkPath])

        await expect(
          createAdapter({}).createCommit(
            createDraft([
              {
                id: id,
                metadata: { type: 'A' },
                data: {},
                deletion: deletion,
              },
            ]),
          ),
        ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
        expect(mockedFs.mkdir).not.toHaveBeenCalled()
        expect(mockedFs.writeFile).not.toHaveBeenCalled()
        expect(mockedFs.rm).not.toHaveBeenCalled()
      },
    )

    it('should not write any entry when a later entry leads through a symbolic link', async () => {
      mockCommittingGit()
      mockSymbolicLinks([`${entryFolder}/alias`])

      await expect(
        createAdapter({}).createCommit(
          createDraft([
            { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
            {
              id: 'alias/b',
              metadata: { type: 'A' },
              data: {},
              deletion: false,
            },
          ]),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      expect(mockedFs.writeFile).not.toHaveBeenCalled()
    })

    it('should not write any entry when a later entry ID is invalid', async () => {
      mockCommittingGit()

      await expect(
        createAdapter({}).createCommit(
          createDraft([
            { id: 'a', metadata: { type: 'A' }, data: {}, deletion: false },
            { id: '../b', metadata: { type: 'A' }, data: {}, deletion: false },
          ]),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      expect(mockedFs.writeFile).not.toHaveBeenCalled()
    })

    it.each([
      '../escaped',
      'nested/../../escaped',
      '..\\escaped',
      'a:b',
      '.hidden',
    ])(
      'should throw GitAdapterError with BAD_REQUEST for entry ID "%s"',
      async (id) => {
        mockCommittingGit()

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

    it('should throw GitAdapterError with INTERNAL_ERROR including stderr and remove the temporary folder when creating the commit fails', async () => {
      mockCommittingGit({
        writtenPaths: ['commitspark/entries/a.yaml'],
        commitTreeResponse: createGitFailedError('Author identity unknown'),
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
      expect(mockedFs.rm).toHaveBeenCalledWith(temporaryFolder, {
        recursive: true,
        force: true,
      })
      expect(getGitCalls()).not.toContainEqual(
        expect.arrayContaining(['update-ref']),
      )
    })
  })
})
