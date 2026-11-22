import {
  Commit,
  CommitDraft,
  Entry,
  EntryHash,
  ErrorCode,
  GitAdapterError,
  validateEntryId,
} from '@commitspark/git-adapter'
import { FilesystemRepositoryOptions } from './index.ts'
import { createHash } from 'crypto'
import { Dirent, Stats } from 'fs'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { parse, stringify } from 'yaml'
import { getPathEntryFolder, getPathSchema } from './path-factory.ts'
import { ENTRY_EXTENSION } from './types.ts'
import {
  execGit,
  getCurrentBranch,
  getCurrentCommitHash,
  isGitBinaryMissing,
  runGit,
} from './git-cli.ts'
import { listCommitFiles, readBlobs } from './git-objects.ts'

export const getEntryHashes = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  commitHash: string,
): Promise<EntryHash[]> => {
  const cwd = getWorkingDirectory()
  if ((await getReadSource(cwd, commitHash)) === 'commit') {
    const entryFiles = await listCommitEntryFiles(
      cwd,
      commitHash,
      gitRepositoryOptions,
    )
    return [...entryFiles].map(([id, blobHash]) => ({ id: id, hash: blobHash }))
  }

  const pathEntryFolder = path.resolve(
    cwd,
    getPathEntryFolder(gitRepositoryOptions),
  )

  const entryFilePaths = await listEntryFilePaths(pathEntryFolder, '')
  if (entryFilePaths === undefined) {
    // a repository without entries has no entry folder
    return []
  }

  const entryIds = entryFilePaths.map((filePath) =>
    filePath.substring(0, filePath.length - ENTRY_EXTENSION.length),
  )

  return Promise.all(
    entryIds.map(async (id) => {
      const fileContent = await readEntryFile(pathEntryFolder, id)
      if (fileContent === undefined) {
        throw new GitAdapterError(
          ErrorCode.INTERNAL_ERROR,
          `Entry file for "${id}" disappeared while reading entry folder "${pathEntryFolder}"`,
        )
      }
      return { id: id, hash: createGitBlobHash(fileContent) }
    }),
  )
}

export const getEntriesByIds = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  commitHash: string,
  ids: string[],
): Promise<Entry[]> => {
  const cwd = getWorkingDirectory()
  const readSource = await getReadSource(cwd, commitHash)
  ids.forEach(validateEntryId)

  if (readSource === 'commit') {
    const entryFiles = await listCommitEntryFiles(
      cwd,
      commitHash,
      gitRepositoryOptions,
    )
    const existingIds = ids.filter((id) => entryFiles.has(id))
    const contents = await readBlobs(
      cwd,
      existingIds.map((id) => entryFiles.get(id) as string),
    )
    return existingIds.map((id, index) => parseEntry(id, contents[index]))
  }

  const pathEntryFolder = path.resolve(
    cwd,
    getPathEntryFolder(gitRepositoryOptions),
  )
  await Promise.all(
    ids.map((id) => assertPathHasNoSymbolicLinks(pathEntryFolder, id)),
  )

  const entries = await Promise.all(
    ids.map(async (id): Promise<Entry | undefined> => {
      const fileContent = await readEntryFile(pathEntryFolder, id)
      return fileContent === undefined ? undefined : parseEntry(id, fileContent)
    }),
  )

  return entries.filter((entry) => entry !== undefined)
}

const parseEntry = (id: string, fileContent: Buffer): Entry => {
  const content = parse(fileContent.toString('utf8'))
  return {
    id: id,
    metadata: content.metadata,
    data: content.data,
  }
}

/**
 * Where reads come from: the given commit in the Git object database, or the working tree if the git binary is
 * missing. The working tree is only read if it holds the given commit according to the environment of the CI/CD
 * pipeline, as reads must return the state of exactly the given commit.
 */
type ReadSource = 'commit' | 'working tree'

const getReadSource = async (
  cwd: string,
  commitHash: string,
): Promise<ReadSource> => {
  // hashes are passed to git as arguments, so that anything else, e.g. an option, is rejected
  if (!/^[0-9a-f]+$/i.test(commitHash)) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      `"${commitHash}" is not a commit hash`,
    )
  }
  try {
    await execGit(['cat-file', '-e', `${commitHash}^{commit}`], cwd)
    return 'commit'
  } catch (error) {
    if (!isGitBinaryMissing(error)) {
      throw new GitAdapterError(
        ErrorCode.NOT_FOUND,
        `No commit "${commitHash}" found`,
      )
    }
  }
  await assertCommitIsCheckedOut(cwd, commitHash)
  return 'working tree'
}

const assertCommitIsCheckedOut = async (
  cwd: string,
  commitHash: string,
): Promise<void> => {
  const currentCommitHash = await getCurrentCommitHash(cwd)
  if (commitHash !== currentCommitHash) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      `Without git binary, only the checked out commit "${currentCommitHash}" can be read, but ` +
        `"${commitHash}" was requested`,
    )
  }
}

// returns the blob hash of each entry file of a commit by entry ID, following the same rules as the working tree
// listing: hidden files and folders are skipped and symbolic links are no entries
const listCommitEntryFiles = async (
  cwd: string,
  commitHash: string,
  gitRepositoryOptions: FilesystemRepositoryOptions,
): Promise<Map<string, string>> => {
  const pathEntryFolder = path.posix.normalize(
    getPathEntryFolder(gitRepositoryOptions),
  )
  const files = await listCommitFiles(cwd, commitHash, pathEntryFolder)
  const entryFiles = new Map<string, string>()
  for (const file of files) {
    if (!file.path.startsWith(`${pathEntryFolder}/`)) {
      continue
    }
    const relativePath = file.path.substring(pathEntryFolder.length + 1)
    if (
      relativePath.endsWith(ENTRY_EXTENSION) &&
      !relativePath.split('/').some((segment) => segment.startsWith('.'))
    ) {
      entryFiles.set(
        relativePath.substring(0, relativePath.length - ENTRY_EXTENSION.length),
        file.blobHash,
      )
    }
  }
  return entryFiles
}

// returns the paths of all entry files below the given folder relative to the entry folder, using "/" as separator;
// hidden files and folders are skipped and symbolic links are not followed; returns undefined if the folder does not
// exist
const listEntryFilePaths = async (
  pathEntryFolder: string,
  relativeFolderPath: string,
): Promise<string[] | undefined> => {
  const folderPath =
    relativeFolderPath === ''
      ? pathEntryFolder
      : `${pathEntryFolder}/${relativeFolderPath}`

  let directoryEntries: Dirent[]
  try {
    directoryEntries = await fs.readdir(folderPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to read entry folder "${folderPath}": ${(error as Error).message}`,
    )
  }

  const filePaths: string[] = []
  for (const directoryEntry of directoryEntries) {
    if (directoryEntry.name.startsWith('.')) {
      continue
    }
    const relativePath =
      relativeFolderPath === ''
        ? directoryEntry.name
        : `${relativeFolderPath}/${directoryEntry.name}`
    if (directoryEntry.isDirectory()) {
      const nestedFilePaths = await listEntryFilePaths(
        pathEntryFolder,
        relativePath,
      )
      if (nestedFilePaths === undefined) {
        throw new GitAdapterError(
          ErrorCode.INTERNAL_ERROR,
          `Entry folder "${pathEntryFolder}/${relativePath}" disappeared while reading entry folder "${pathEntryFolder}"`,
        )
      }
      filePaths.push(...nestedFilePaths)
    } else if (
      directoryEntry.isFile() &&
      directoryEntry.name.endsWith(ENTRY_EXTENSION)
    ) {
      filePaths.push(relativePath)
    }
  }
  return filePaths
}

const getPathEntryFile = (pathEntryFolder: string, id: string): string =>
  `${pathEntryFolder}/${id}${ENTRY_EXTENSION}`

// the file system follows symbolic links in any segment of a path, so that a symbolic link below the entry folder
// could lead to files outside of it; consistent with the entry listing, which does not follow symbolic links, paths
// through symbolic links are rejected
const assertPathHasNoSymbolicLinks = async (
  pathEntryFolder: string,
  id: string,
): Promise<void> => {
  let currentPath = pathEntryFolder
  for (const segment of `${id}${ENTRY_EXTENSION}`.split('/')) {
    currentPath = `${currentPath}/${segment}`
    let stats: Stats
    try {
      stats = await fs.lstat(currentPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // nothing exists below a missing path segment
        return
      }
      throw new GitAdapterError(
        ErrorCode.INTERNAL_ERROR,
        `Failed to inspect path "${currentPath}": ${(error as Error).message}`,
      )
    }
    if (stats.isSymbolicLink()) {
      throw new GitAdapterError(
        ErrorCode.BAD_REQUEST,
        `Entry ID "${id}" leads through symbolic link "${currentPath}", which is not permitted`,
      )
    }
  }
}

// returns undefined if the entry file does not exist
const readEntryFile = async (
  pathEntryFolder: string,
  id: string,
): Promise<Buffer | undefined> => {
  const filePath = getPathEntryFile(pathEntryFolder, id)
  try {
    return await fs.readFile(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to read entry file "${filePath}": ${(error as Error).message}`,
    )
  }
}

// same hash as Git computes for a blob, so that hashes match those of other adapters for unmodified files
const createGitBlobHash = (fileContent: Buffer): string =>
  createHash('sha1')
    .update(`blob ${fileContent.length}\0`)
    .update(fileContent)
    .digest('hex')

export const getSchema = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  commitHash: string,
): Promise<string> => {
  const cwd = getWorkingDirectory()
  const pathSchema = path.posix.normalize(getPathSchema(gitRepositoryOptions))

  if ((await getReadSource(cwd, commitHash)) === 'commit') {
    const schemaFile = (
      await listCommitFiles(cwd, commitHash, pathSchema)
    ).find((file) => file.path === pathSchema)
    if (schemaFile === undefined) {
      throw new GitAdapterError(
        ErrorCode.INTERNAL_ERROR,
        `Schema file "${pathSchema}" does not exist in commit "${commitHash}"`,
      )
    }
    const [content] = await readBlobs(cwd, [schemaFile.blobHash])
    return content.toString('utf8')
  }

  const schemaFilePath = path.resolve(cwd, pathSchema)
  try {
    return await fs.readFile(schemaFilePath, {
      encoding: 'utf-8',
    })
  } catch (error) {
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to read schema file "${schemaFilePath}": ${(error as Error).message}`,
    )
  }
}

/**
 * Resolves a branch name, tag name or commit hash with `git rev-parse`. Without git binary, only the checked out branch
 * and commit can be resolved, using the environment of the CI/CD pipeline.
 */
export const getLatestCommitHash = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  ref: string,
): Promise<string> => {
  const cwd = getWorkingDirectory()
  // refs are passed to git as arguments, so that an option is rejected
  if (ref.startsWith('-')) {
    throw new GitAdapterError(ErrorCode.BAD_REQUEST, `Invalid ref "${ref}"`)
  }

  try {
    return await execGit(
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      cwd,
    )
  } catch (error) {
    if (!isGitBinaryMissing(error)) {
      throw new GitAdapterError(
        ErrorCode.NOT_FOUND,
        `No commit found for ref "${ref}"`,
      )
    }
  }

  const currentCommitHash = await getCurrentCommitHash(cwd)
  if (ref !== currentCommitHash && ref !== (await getCurrentBranch(cwd))) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      `Without git binary, only the checked out branch or commit can be read, but "${ref}" was requested`,
    )
  }
  if (!currentCommitHash) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      `Requested commit ref "${ref}" does not have any existing commits`,
    )
  }
  return currentCommitHash
}

// change of an entry file or of the schema file
interface FileChange {
  path: string
  // undefined for deletions
  content: string | undefined
}

/**
 * Commits the entry drafts on top of `parentSha` and moves the checked out branch to the new commit only if it still
 * points to `parentSha`, as required by the commit precondition of the adapter interface. The commit is assembled
 * in a temporary index with Git plumbing commands and the branch is moved with `git update-ref`, which compares the
 * expected old value atomically, so that a commit by another process in the meantime leads to `CONFLICT` instead of
 * a commit on top of a state the caller did not validate. The working tree and index are only updated for the
 * changed files after the branch was moved.
 */
export const createCommit = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  commitDraft: CommitDraft,
): Promise<Commit> => {
  const cwd = getWorkingDirectory()
  const pathEntryFolder = getPathEntryFolder(gitRepositoryOptions)

  const currentBranch = await getCurrentBranch(cwd)
  if (currentBranch !== commitDraft.ref) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      `Requested commit ref "${commitDraft.ref}" does not match currently checked out branch ` +
        `"${currentBranch}"; this adapter requires the target branch to already be checked out`,
    )
  }

  // fail early without creating any objects; the atomic check happens when moving the branch
  await assertBranchHasNotMoved(cwd, commitDraft)

  // validate all entries before writing any of them
  commitDraft.entries.forEach((entryDraft) => validateEntryId(entryDraft.id))
  const absolutePathEntryFolder = path.resolve(cwd, pathEntryFolder)
  for (const entryDraft of commitDraft.entries) {
    await assertPathHasNoSymbolicLinks(absolutePathEntryFolder, entryDraft.id)
  }

  const changes: FileChange[] = commitDraft.entries.map((entryDraft) => ({
    path: getPathEntryFile(pathEntryFolder, entryDraft.id),
    content: entryDraft.deletion
      ? undefined
      : stringify({ metadata: entryDraft.metadata, data: entryDraft.data }),
  }))
  if (commitDraft.schema !== undefined) {
    changes.push({
      path: getPathSchema(gitRepositoryOptions),
      content: commitDraft.schema,
    })
  }

  // in Git commit messages, a blank line separates the body
  const message =
    commitDraft.body === undefined
      ? commitDraft.message
      : `${commitDraft.message}\n\n${commitDraft.body}`
  const newCommitHash = await createCommitObject(
    cwd,
    commitDraft.parentSha,
    message,
    changes,
  )

  try {
    await runGit(
      [
        'update-ref',
        '-m',
        `commit: ${commitDraft.message}`,
        `refs/heads/${commitDraft.ref}`,
        newCommitHash,
        commitDraft.parentSha,
      ],
      cwd,
    )
  } catch (error) {
    await assertBranchHasNotMoved(cwd, commitDraft)
    throw error
  }

  await updateWorkingTree(cwd, changes)

  return { commitHash: newCommitHash }
}

const assertBranchHasNotMoved = async (
  cwd: string,
  commitDraft: CommitDraft,
): Promise<void> => {
  const currentCommitHash = await getCurrentCommitHash(cwd)
  if (currentCommitHash !== commitDraft.parentSha) {
    throw new GitAdapterError(
      ErrorCode.CONFLICT,
      `Branch "${commitDraft.ref}" has moved: expected parent commit "${commitDraft.parentSha}" ` +
        `but current HEAD is "${currentCommitHash}"`,
    )
  }
}

// creates a commit with the given changes on top of the parent commit without touching the working tree, the index
// or any branch
const createCommitObject = async (
  cwd: string,
  parentSha: string,
  message: string,
  changes: FileChange[],
): Promise<string> => {
  const temporaryFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commitspark-'),
  )
  try {
    const indexEnv = { GIT_INDEX_FILE: path.join(temporaryFolder, 'index') }
    await runGit(['read-tree', parentSha], cwd, indexEnv)

    const writes = changes.filter((change) => change.content !== undefined)
    if (writes.length > 0) {
      const blobFilePaths = await Promise.all(
        writes.map(async (change, index) => {
          const blobFilePath = path.join(temporaryFolder, `blob-${index}`)
          await fs.writeFile(blobFilePath, change.content as string, {
            encoding: 'utf8',
          })
          return blobFilePath
        }),
      )
      const blobHashes = (
        await runGit(
          ['hash-object', '-w', '--no-filters', '--', ...blobFilePaths],
          cwd,
        )
      ).split('\n')
      await runGit(
        [
          'update-index',
          '--add',
          ...writes.flatMap((change, index) => [
            '--cacheinfo',
            `100644,${blobHashes[index]},${change.path}`,
          ]),
        ],
        cwd,
        indexEnv,
      )
    }

    const deletions = changes.filter((change) => change.content === undefined)
    if (deletions.length > 0) {
      // removing a path that does not exist has no effect
      await runGit(
        [
          'update-index',
          '--force-remove',
          '--',
          ...deletions.map((change) => change.path),
        ],
        cwd,
        indexEnv,
      )
    }

    const treeHash = await runGit(['write-tree'], cwd, indexEnv)
    const parentTreeHash = await runGit(
      ['rev-parse', `${parentSha}^{tree}`],
      cwd,
    )
    if (treeHash === parentTreeHash) {
      throw new GitAdapterError(
        ErrorCode.BAD_REQUEST,
        'Commit draft contains no effective changes',
      )
    }

    return await runGit(
      // a message passed as separate value of `-m` is never interpreted as an option
      ['commit-tree', treeHash, '-p', parentSha, '-m', message],
      cwd,
    )
  } finally {
    await fs.rm(temporaryFolder, { recursive: true, force: true })
  }
}

// brings working tree and index in line with the new branch head for the changed files, leaving all other
// files untouched
const updateWorkingTree = async (
  cwd: string,
  changes: FileChange[],
): Promise<void> => {
  for (const change of changes) {
    const absolutePath = path.resolve(cwd, change.path)
    if (change.content === undefined) {
      await fs.rm(absolutePath, { force: true })
    } else {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true })
      await fs.writeFile(absolutePath, change.content, { encoding: 'utf8' })
    }
  }
  await runGit(
    ['reset', '--quiet', '--', ...changes.map((change) => change.path)],
    cwd,
  )
}

function getWorkingDirectory(): string {
  return (
    process.env.GITHUB_WORKSPACE ?? process.env.CI_PROJECT_DIR ?? process.cwd()
  )
}
