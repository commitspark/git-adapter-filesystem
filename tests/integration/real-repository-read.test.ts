import { ErrorCode } from '@commitspark/git-adapter'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createAdapter } from '../../src'
import { readBlobs } from '../../src/git-objects'

// runs against a real Git repository in a temporary folder to verify that reads return the state of the given commit
describe('Reading from a real repository', () => {
  let repositoryPath: string
  let originalWorkspace: string | undefined

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repositoryPath, encoding: 'utf8' }).trim()

  const writeFile = (relativePath: string, content: string): void => {
    const absolutePath = path.join(repositoryPath, relativePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, content)
  }

  const commitAll = (message: string): string => {
    git('add', '--all')
    git('commit', '--quiet', `--message=${message}`)
    return git('rev-parse', 'HEAD')
  }

  const entry = (type: string, field: string): string =>
    `metadata:\n  type: ${type}\ndata:\n  field: ${field}\n`

  beforeEach(() => {
    repositoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'commitspark-test-repository-'),
    )
    git('init', '--quiet', '--initial-branch=main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')

    originalWorkspace = process.env.GITHUB_WORKSPACE
    process.env.GITHUB_WORKSPACE = repositoryPath
  })

  afterEach(() => {
    if (originalWorkspace === undefined) {
      delete process.env.GITHUB_WORKSPACE
    } else {
      process.env.GITHUB_WORKSPACE = originalWorkspace
    }
    fs.rmSync(repositoryPath, { recursive: true, force: true })
  })

  describe('getLatestCommitHash', () => {
    it('should resolve branch names, tag names and commit hashes', async () => {
      writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
      const firstCommit = commitAll('First')
      git('tag', 'lightweight')
      git('tag', '--annotate', '--message=Annotated', 'annotated')
      writeFile('commitspark/entries/a.yaml', entry('A', 'two'))
      const secondCommit = commitAll('Second')
      const adapter = createAdapter({})

      await expect(adapter.getLatestCommitHash('main')).resolves.toEqual(
        secondCommit,
      )
      await expect(adapter.getLatestCommitHash('lightweight')).resolves.toEqual(
        firstCommit,
      )
      // an annotated tag is resolved to the commit it points to, not to the tag object
      await expect(adapter.getLatestCommitHash('annotated')).resolves.toEqual(
        firstCommit,
      )
      await expect(adapter.getLatestCommitHash(firstCommit)).resolves.toEqual(
        firstCommit,
      )
    })

    it('should resolve refs with a detached HEAD, as in pull request checkouts of CI/CD pipelines', async () => {
      writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
      const commit = commitAll('First')
      git('checkout', '--quiet', '--detach', commit)

      await expect(
        createAdapter({}).getLatestCommitHash(commit),
      ).resolves.toEqual(commit)
      await expect(
        createAdapter({}).getLatestCommitHash('HEAD'),
      ).resolves.toEqual(commit)
    })

    it('should throw GitAdapterError with NOT_FOUND for an unknown ref', async () => {
      writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
      commitAll('First')

      await expect(
        createAdapter({}).getLatestCommitHash('unknown'),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('reads', () => {
    it('should return entries and schema of the given commit, not of later commits or the working tree', async () => {
      writeFile('commitspark/schema/schema.graphql', 'type A { field: String }')
      writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
      const firstCommit = commitAll('First')
      writeFile('commitspark/schema/schema.graphql', 'type B { field: String }')
      writeFile('commitspark/entries/a.yaml', entry('A', 'two'))
      writeFile('commitspark/entries/b.yaml', entry('A', 'new'))
      commitAll('Second')
      // uncommitted changes are not part of any commit
      writeFile('commitspark/entries/a.yaml', entry('A', 'uncommitted'))
      fs.rmSync(path.join(repositoryPath, 'commitspark/schema/schema.graphql'))
      const adapter = createAdapter({})

      await expect(adapter.getEntryHashes(firstCommit)).resolves.toEqual([
        {
          id: 'a',
          hash: git('rev-parse', `${firstCommit}:commitspark/entries/a.yaml`),
        },
      ])
      await expect(
        adapter.getEntriesByIds(firstCommit, ['a', 'b']),
      ).resolves.toEqual([
        { id: 'a', metadata: { type: 'A' }, data: { field: 'one' } },
      ])
      await expect(adapter.getSchema(firstCommit)).resolves.toEqual(
        'type A { field: String }',
      )
    })

    it('should list entry files in subfolders and skip hidden files and folders, other files and symbolic links', async () => {
      writeFile('commitspark/entries/a.yaml', entry('A', 'a'))
      writeFile('commitspark/entries/blog/2024/post.yaml', entry('A', 'post'))
      writeFile('commitspark/entries/.hidden.yaml', entry('A', 'hidden'))
      writeFile('commitspark/entries/.drafts/draft.yaml', entry('A', 'draft'))
      writeFile('commitspark/entries/notes.md', 'notes')
      writeFile('commitspark/entries-old/old.yaml', entry('A', 'old'))
      fs.symlinkSync(
        'a.yaml',
        path.join(repositoryPath, 'commitspark/entries/link.yaml'),
      )
      fs.symlinkSync(
        'blog',
        path.join(repositoryPath, 'commitspark/entries/linked-folder'),
      )
      const commit = commitAll('Entries')
      const adapter = createAdapter({})

      const hashes = await adapter.getEntryHashes(commit)

      expect(hashes.map((entryHash) => entryHash.id).sort()).toEqual([
        'a',
        'blog/2024/post',
      ])
      await expect(
        adapter.getEntriesByIds(commit, [
          'blog/2024/post',
          'link',
          'linked-folder/2024/post',
        ]),
      ).resolves.toEqual([
        {
          id: 'blog/2024/post',
          metadata: { type: 'A' },
          data: { field: 'post' },
        },
      ])
    })

    it.each([['../escaped'], ['nested/../../escaped'], ['.hidden']])(
      'should throw GitAdapterError with BAD_REQUEST for entry ID "%s"',
      async (id) => {
        writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
        const commit = commitAll('First')

        await expect(
          createAdapter({}).getEntriesByIds(commit, [id]),
        ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
      },
    )

    it('should read from a custom entry folder and schema path', async () => {
      writeFile('content/schema.graphql', 'type A { field: String }')
      writeFile('content/entries/a.yaml', entry('A', 'one'))
      const commit = commitAll('Custom paths')
      const adapter = createAdapter({
        pathEntryFolder: 'content/entries/',
        pathSchemaFile: 'content/schema.graphql',
      })

      await expect(adapter.getEntriesByIds(commit, ['a'])).resolves.toEqual([
        { id: 'a', metadata: { type: 'A' }, data: { field: 'one' } },
      ])
      await expect(adapter.getSchema(commit)).resolves.toEqual(
        'type A { field: String }',
      )
    })

    it('should return no entries for a commit without entry folder', async () => {
      writeFile('README.md', 'readme')
      const commit = commitAll('No entries')

      await expect(createAdapter({}).getEntryHashes(commit)).resolves.toEqual(
        [],
      )
    })

    it('should throw GitAdapterError with NOT_FOUND for an unknown commit', async () => {
      writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
      commitAll('First')

      await expect(
        createAdapter({}).getEntryHashes(
          '0123456789abcdef0123456789abcdef01234567',
        ),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('should throw GitAdapterError with BAD_REQUEST for a commit hash that would be an option', async () => {
      await expect(
        createAdapter({}).getEntryHashes('--all'),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST })
    })

    it('should throw GitAdapterError with NOT_FOUND when the commit has no schema file', async () => {
      writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
      const commit = commitAll('First')

      await expect(createAdapter({}).getSchema(commit)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      })
    })
  })

  describe('file contents and names', () => {
    it('should read several entries with multibyte content and special file names in one call', async () => {
      const ids = ['with space', 'ümlaut/ä', 'emoji 😀', 'plain']
      ids.forEach((id, index) =>
        writeFile(
          `commitspark/entries/${id}.yaml`,
          entry('A', `"äöü 😀 ${index}"`),
        ),
      )
      const commit = commitAll('Special names')

      const entries = await createAdapter({}).getEntriesByIds(commit, ids)

      expect(entries).toEqual(
        ids.map((id, index) => ({
          id: id,
          metadata: { type: 'A' },
          data: { field: `äöü 😀 ${index}` },
        })),
      )
    })

    it('should list an entry file whose name is no valid entry ID, so that callers can report it', async () => {
      writeFile('commitspark/entries/new\nline.yaml', entry('A', 'one'))
      const commit = commitAll('Invalid name')

      const hashes = await createAdapter({}).getEntryHashes(commit)

      expect(hashes.map((entryHash) => entryHash.id)).toEqual(['new\nline'])
    })

    it.each([
      ['an empty file', '', 'does not contain a YAML mapping'],
      ['a list', '- a\n- b\n', 'does not contain a YAML mapping'],
      ['invalid YAML', 'metadata: [unclosed\n', 'is no valid YAML'],
    ])(
      'should throw GitAdapterError with INTERNAL_ERROR for an entry file with %s',
      async (_description, content, message) => {
        writeFile('commitspark/entries/a.yaml', content)
        const commit = commitAll('Broken entry')

        await expect(
          createAdapter({}).getEntriesByIds(commit, ['a']),
        ).rejects.toMatchObject({
          code: ErrorCode.INTERNAL_ERROR,
          message: expect.stringContaining(message),
        })
      },
    )

    it('should throw GitAdapterError with INTERNAL_ERROR for a missing blob', async () => {
      writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
      commitAll('First')

      await expect(
        readBlobs(repositoryPath, ['0123456789abcdef0123456789abcdef01234567']),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })
  })

  describe('setup', () => {
    it('should throw GitAdapterError with INTERNAL_ERROR when the working directory is a subfolder of the repository', async () => {
      writeFile('pkg/commitspark/entries/a.yaml', entry('A', 'one'))
      const commit = commitAll('Monorepo')
      process.env.GITHUB_WORKSPACE = path.join(repositoryPath, 'pkg')

      await expect(
        createAdapter({}).getLatestCommitHash('main'),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
        message: expect.stringContaining('must be the top-level folder'),
      })
      await expect(
        createAdapter({}).getEntryHashes(commit),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
    })

    it('should throw GitAdapterError with INTERNAL_ERROR including the message of git when the working directory is no repository', async () => {
      const folder = fs.mkdtempSync(
        path.join(os.tmpdir(), 'commitspark-test-folder-'),
      )
      process.env.GITHUB_WORKSPACE = folder
      try {
        await expect(
          createAdapter({}).getLatestCommitHash('main'),
        ).rejects.toMatchObject({
          code: ErrorCode.INTERNAL_ERROR,
          message: expect.stringContaining('not a git repository'),
        })
      } finally {
        fs.rmSync(folder, { recursive: true, force: true })
      }
    })

    it.each([
      ['an absolute path', '/commitspark/entries'],
      ['the top-level folder', '.'],
      ['an empty path', ''],
      ['a path outside the repository', '../entries'],
      ['backslashes', 'commitspark\\entries'],
    ])(
      'should throw GitAdapterError with INTERNAL_ERROR when creating the adapter with %s as entry folder',
      (_description, pathEntryFolder) => {
        expect(() => createAdapter({ pathEntryFolder })).toThrow(
          expect.objectContaining({ code: ErrorCode.INTERNAL_ERROR }),
        )
      },
    )

    it('should throw GitAdapterError with INTERNAL_ERROR when creating the adapter with an invalid schema path', () => {
      expect(() =>
        createAdapter({ pathSchemaFile: '/schema.graphql' }),
      ).toThrow(expect.objectContaining({ code: ErrorCode.INTERNAL_ERROR }))
    })

    it('should normalize a leading "./" and trailing slashes of path options', async () => {
      writeFile('content/entries/a.yaml', entry('A', 'one'))
      const commit = commitAll('Custom folder')

      await expect(
        createAdapter({
          pathEntryFolder: './content/entries//',
        }).getEntryHashes(commit),
      ).resolves.toEqual([
        { id: 'a', hash: git('rev-parse', `${commit}:content/entries/a.yaml`) },
      ])
    })

    it('should resolve revision expressions as refs', async () => {
      writeFile('commitspark/entries/a.yaml', entry('A', 'one'))
      const firstCommit = commitAll('First')
      writeFile('commitspark/entries/a.yaml', entry('A', 'two'))
      commitAll('Second')

      await expect(
        createAdapter({}).getLatestCommitHash('HEAD~1'),
      ).resolves.toEqual(firstCommit)
    })
  })
})
