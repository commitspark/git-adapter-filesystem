import { ErrorCode, GitAdapterError } from '@commitspark/git-adapter'
import * as fs from 'fs/promises'
import { createAdapter } from '../../src'
import {
  createFsError,
  getGitCalls,
  mockGit,
  mockReaddir,
  mockReadFile,
  mockSymbolicLinks,
  restoreEnvironment,
  setUpEnvironment,
} from './system-mock'

jest.mock('child_process', () => ({ execFile: jest.fn() }))
jest.mock('fs/promises')

describe('Reading', () => {
  const commitHash = 'abc123'
  const entryFolder = '/repository/commitspark/entries'
  const contentA = 'metadata:\n  type: A\ndata:\n  field: value\n'
  // hash as computed by "git hash-object"
  const hashA = '85403357e7935ff7ae799685aab8259920fb4ede'
  const contentB = 'metadata:\n  type: B\ndata:\n  field: Ünïcödé\n'
  const hashB = '99cdf990182fa9db3b12fea271afcb1057270cb9'

  const mockedFs = jest.mocked(fs)

  beforeEach(() => {
    jest.resetAllMocks()
    setUpEnvironment()
    mockGit({ 'rev-parse HEAD': commitHash })
  })

  afterEach(() => {
    restoreEnvironment()
  })

  describe('getEntryHashes', () => {
    it('should return Git blob hashes of entry files only', async () => {
      mockReaddir({
        [entryFolder]: ['a.yaml', 'b.yaml', 'README.md', 'c.yaml.bak'],
      })
      mockReadFile({
        [`${entryFolder}/a.yaml`]: contentA,
        [`${entryFolder}/b.yaml`]: contentB,
      })

      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).resolves.toEqual([
        { id: 'a', hash: hashA },
        { id: 'b', hash: hashB },
      ])
      expect(mockedFs.readdir).toHaveBeenCalledWith(entryFolder, {
        withFileTypes: true,
      })
      expect(mockedFs.readFile.mock.calls.map((call) => call[0])).toEqual([
        `${entryFolder}/a.yaml`,
        `${entryFolder}/b.yaml`,
      ])
    })

    it('should read from a custom entry folder given with a trailing slash', async () => {
      mockReaddir({ '/repository/content/entries': ['a.yaml'] })
      mockReadFile({ '/repository/content/entries/a.yaml': contentA })

      await expect(
        createAdapter({ pathEntryFolder: 'content/entries/' }).getEntryHashes(
          commitHash,
        ),
      ).resolves.toEqual([{ id: 'a', hash: hashA }])
      expect(mockedFs.readdir).toHaveBeenCalledWith(
        '/repository/content/entries',
        { withFileTypes: true },
      )
    })

    it('should return entry files in subfolders with their path as ID', async () => {
      mockReaddir({
        [entryFolder]: ['a.yaml', 'blog/'],
        [`${entryFolder}/blog`]: ['b.yaml', '2024/'],
        [`${entryFolder}/blog/2024`]: ['c.yaml'],
      })
      mockReadFile({
        [`${entryFolder}/a.yaml`]: contentA,
        [`${entryFolder}/blog/b.yaml`]: contentB,
        [`${entryFolder}/blog/2024/c.yaml`]: contentA,
      })

      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).resolves.toEqual([
        { id: 'a', hash: hashA },
        { id: 'blog/b', hash: hashB },
        { id: 'blog/2024/c', hash: hashA },
      ])
    })

    it('should ignore hidden files and folders and symbolic links', async () => {
      mockReaddir({
        [entryFolder]: [
          '.a.yaml',
          '.yaml',
          '.hidden/',
          'link.yaml@',
          'linked-folder@',
          'folder/',
        ],
        [`${entryFolder}/folder`]: ['.hidden/', 'b.yaml'],
      })
      mockReadFile({ [`${entryFolder}/folder/b.yaml`]: contentB })

      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).resolves.toEqual([{ id: 'folder/b', hash: hashB }])
      expect(mockedFs.readdir.mock.calls.map((call) => call[0])).toEqual([
        entryFolder,
        `${entryFolder}/folder`,
      ])
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when a subfolder disappears while reading', async () => {
      mockReaddir({ [entryFolder]: ['folder/'] })

      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })

    it('should throw GitAdapterError with BAD_REQUEST when commit is not checked out', async () => {
      await expect(
        createAdapter({}).getEntryHashes('def456'),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      expect(getGitCalls()).toEqual([['rev-parse', 'HEAD']])
      expect(mockedFs.readdir).not.toHaveBeenCalled()
    })

    it('should return no hashes when entry folder does not exist', async () => {
      mockReaddir({})

      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).resolves.toEqual([])
      expect(mockedFs.readdir).toHaveBeenCalledWith(entryFolder, {
        withFileTypes: true,
      })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when entry folder cannot be read', async () => {
      mockReaddir({ [entryFolder]: createFsError('EACCES') })

      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when entry file disappears while reading', async () => {
      mockReaddir({ [entryFolder]: ['a.yaml'] })
      mockReadFile({})

      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })
  })

  describe('getEntriesByIds', () => {
    it('should return only requested entries that exist', async () => {
      mockReadFile({ [`${entryFolder}/a.yaml`]: contentA })

      await expect(
        createAdapter({}).getEntriesByIds(commitHash, ['a', 'missing']),
      ).resolves.toEqual([
        { id: 'a', metadata: { type: 'A' }, data: { field: 'value' } },
      ])
      expect(mockedFs.readFile.mock.calls.map((call) => call[0])).toEqual([
        `${entryFolder}/a.yaml`,
        `${entryFolder}/missing.yaml`,
      ])
    })

    it('should throw GitAdapterError with BAD_REQUEST when commit is not checked out', async () => {
      await expect(
        createAdapter({}).getEntriesByIds('def456', ['a']),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      expect(mockedFs.readFile).not.toHaveBeenCalled()
    })

    it('should return entries in subfolders', async () => {
      mockReadFile({ [`${entryFolder}/blog/a.yaml`]: contentA })

      await expect(
        createAdapter({}).getEntriesByIds(commitHash, ['blog/a']),
      ).resolves.toEqual([
        { id: 'blog/a', metadata: { type: 'A' }, data: { field: 'value' } },
      ])
    })

    it('should inspect every path segment below the entry folder for symbolic links', async () => {
      mockReadFile({ [`${entryFolder}/blog/2024/a.yaml`]: contentA })

      await createAdapter({}).getEntriesByIds(commitHash, ['blog/2024/a'])

      expect(mockedFs.lstat.mock.calls.map((call) => call[0])).toEqual([
        `${entryFolder}/blog`,
        `${entryFolder}/blog/2024`,
        `${entryFolder}/blog/2024/a.yaml`,
      ])
    })

    it.each([
      ['a folder', 'alias/a', `${entryFolder}/alias`],
      ['the entry file', 'a', `${entryFolder}/a.yaml`],
    ])(
      'should throw GitAdapterError with BAD_REQUEST when %s is a symbolic link',
      async (_, id, symbolicLinkPath) => {
        mockReadFile({})
        mockSymbolicLinks([symbolicLinkPath])

        await expect(
          createAdapter({}).getEntriesByIds(commitHash, [id]),
        ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
        expect(mockedFs.readFile).not.toHaveBeenCalled()
      },
    )

    it('should stop inspecting path segments below a missing folder', async () => {
      mockReadFile({})
      mockedFs.lstat.mockRejectedValue(createFsError('ENOENT'))

      await expect(
        createAdapter({}).getEntriesByIds(commitHash, ['missing/a']),
      ).resolves.toEqual([])
      expect(mockedFs.lstat.mock.calls.map((call) => call[0])).toEqual([
        `${entryFolder}/missing`,
      ])
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when a path segment cannot be inspected', async () => {
      mockReadFile({})
      mockedFs.lstat.mockRejectedValue(createFsError('EACCES'))

      await expect(
        createAdapter({}).getEntriesByIds(commitHash, ['a']),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
      expect(mockedFs.readFile).not.toHaveBeenCalled()
    })

    it.each(['../escaped', 'nested/../../escaped', '..\\escaped', '.hidden'])(
      'should throw GitAdapterError with BAD_REQUEST for entry ID "%s"',
      async (id) => {
        mockReadFile({})

        await expect(
          createAdapter({}).getEntriesByIds(commitHash, ['a', id]),
        ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
        expect(mockedFs.readFile).not.toHaveBeenCalled()
      },
    )

    it('should throw GitAdapterError with INTERNAL_ERROR when entry file cannot be read', async () => {
      mockReadFile({ [`${entryFolder}/a.yaml`]: createFsError('EACCES') })

      await expect(
        createAdapter({}).getEntriesByIds(commitHash, ['a']),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })
  })

  describe('getSchema', () => {
    it('should read the schema from a custom path', async () => {
      const schema = 'type A @Entry { id: ID! }\n'
      mockReadFile({ '/repository/custom/schema.graphql': schema })

      await expect(
        createAdapter({ pathSchemaFile: 'custom/schema.graphql' }).getSchema(
          commitHash,
        ),
      ).resolves.toEqual(schema)
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when schema file cannot be read', async () => {
      mockReadFile({})

      const promise = createAdapter({}).getSchema(commitHash)

      await expect(promise).rejects.toThrow(GitAdapterError)
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
      })
    })
  })
})
