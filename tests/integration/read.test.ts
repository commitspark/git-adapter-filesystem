import { ErrorCode, GitAdapterError } from '@commitspark/git-adapter'
import * as fs from 'fs/promises'
import { createAdapter } from '../../src'
import {
  createFsError,
  getGitCalls,
  mockGit,
  mockReadFile,
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
      mockedFs.readdir.mockResolvedValue([
        'a.yaml',
        'b.yaml',
        'README.md',
        'c.yaml.bak',
      ] as never)
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
      expect(mockedFs.readdir).toHaveBeenCalledWith(entryFolder)
      expect(mockedFs.readFile.mock.calls.map((call) => call[0])).toEqual([
        `${entryFolder}/a.yaml`,
        `${entryFolder}/b.yaml`,
      ])
    })

    it('should read from a custom entry folder given with a trailing slash', async () => {
      mockedFs.readdir.mockResolvedValue(['a.yaml'] as never)
      mockReadFile({ '/repository/content/entries/a.yaml': contentA })

      await expect(
        createAdapter({ pathEntryFolder: 'content/entries/' }).getEntryHashes(
          commitHash,
        ),
      ).resolves.toEqual([{ id: 'a', hash: hashA }])
      expect(mockedFs.readdir).toHaveBeenCalledWith(
        '/repository/content/entries',
      )
    })

    it('should throw GitAdapterError with BAD_REQUEST when commit is not checked out', async () => {
      await expect(
        createAdapter({}).getEntryHashes('def456'),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      expect(getGitCalls()).toEqual([['rev-parse', 'HEAD']])
      expect(mockedFs.readdir).not.toHaveBeenCalled()
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when entry folder cannot be read', async () => {
      mockedFs.readdir.mockRejectedValue(createFsError('EACCES'))

      await expect(
        createAdapter({}).getEntryHashes(commitHash),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR when entry file disappears while reading', async () => {
      mockedFs.readdir.mockResolvedValue(['a.yaml'] as never)
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
