import { ErrorCode } from '@commitspark/git-adapter'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createAdapter } from '../../src'

// runs against a real Git repository in a temporary folder to verify the Git plumbing used for committing
describe('Writing to a real repository', () => {
  let repositoryPath: string
  let originalWorkspace: string | undefined

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repositoryPath, encoding: 'utf8' }).trim()

  const writeFile = (relativePath: string, content: string): void => {
    const absolutePath = path.join(repositoryPath, relativePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, content)
  }

  beforeEach(() => {
    repositoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'commitspark-test-repository-'),
    )
    git('init', '--quiet', '--initial-branch=main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    writeFile('commitspark/entries/a.yaml', 'metadata:\n  type: A\ndata: {}\n')
    writeFile('commitspark/entries/b.yaml', 'metadata:\n  type: A\ndata: {}\n')
    git('add', '.')
    git('commit', '--quiet', '--message=Initial commit')

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

  it('should commit entry changes on top of the parent commit and leave unrelated changes untouched', async () => {
    const parentSha = git('rev-parse', 'HEAD')
    writeFile('unrelated.txt', 'staged\n')
    git('add', 'unrelated.txt')
    writeFile('untracked.txt', 'untracked\n')

    const { commitHash } = await createAdapter({}).createCommit({
      ref: 'main',
      parentSha: parentSha,
      message: 'Change entries',
      entries: [
        {
          id: 'a',
          metadata: { type: 'A' },
          data: { field: 'value' },
          deletion: false,
        },
        { id: 'b', metadata: { type: 'A' }, data: {}, deletion: true },
        {
          id: 'blog/c',
          metadata: { type: 'A' },
          data: {},
          deletion: false,
        },
      ],
    })

    expect(git('rev-parse', 'HEAD')).toEqual(commitHash)
    expect(git('rev-parse', 'HEAD^')).toEqual(parentSha)
    expect(git('log', '-1', '--format=%B')).toEqual('Change entries')
    expect(
      git('diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD'),
    ).toEqual(
      [
        'M\tcommitspark/entries/a.yaml',
        'D\tcommitspark/entries/b.yaml',
        'A\tcommitspark/entries/blog/c.yaml',
      ].join('\n'),
    )
    expect(git('show', 'HEAD:commitspark/entries/a.yaml')).toEqual(
      'metadata:\n  type: A\ndata:\n  field: value',
    )
    // working tree and index match the new commit for entry files, other changes are kept
    expect(git('status', '--porcelain')).toEqual(
      ['A  unrelated.txt', '?? untracked.txt'].join('\n'),
    )
  })

  it('should throw GitAdapterError with CONFLICT and leave the branch unchanged when the parent is outdated', async () => {
    const parentSha = git('rev-parse', 'HEAD')
    writeFile('commitspark/entries/b.yaml', 'metadata:\n  type: B\ndata: {}\n')
    git('commit', '--quiet', '--all', '--message=Concurrent commit')
    const concurrentSha = git('rev-parse', 'HEAD')

    await expect(
      createAdapter({}).createCommit({
        ref: 'main',
        parentSha: parentSha,
        message: 'Change entry',
        entries: [
          { id: 'a', metadata: { type: 'A' }, data: {}, deletion: true },
        ],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

    expect(git('rev-parse', 'HEAD')).toEqual(concurrentSha)
    expect(git('status', '--porcelain')).toEqual('')
  })
})
