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
import { getCurrentBranch, getCurrentCommitHash, runGit } from './git-cli.ts'

export const getEntryHashes = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  commitHash: string,
): Promise<EntryHash[]> => {
  const cwd = getWorkingDirectory()
  await assertCommitIsCheckedOut(cwd, commitHash)

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
  await assertCommitIsCheckedOut(cwd, commitHash)
  ids.forEach(validateEntryId)

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
      if (fileContent === undefined) {
        return undefined
      }
      const content = parse(fileContent.toString('utf8'))
      return {
        id: id,
        metadata: content.metadata,
        data: content.data,
      }
    }),
  )

  return entries.filter((entry) => entry !== undefined)
}

const assertCommitIsCheckedOut = async (
  cwd: string,
  commitHash: string,
): Promise<void> => {
  const currentCommitHash = await getCurrentCommitHash(cwd)
  if (commitHash !== currentCommitHash) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      `This adapter does not support navigating the git history; current commit hash is ` +
        `"${currentCommitHash}" but "${commitHash}" was requested`,
    )
  }
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
): Promise<string> => {
  const cwd = getWorkingDirectory()
  const schemaFilePath = path.resolve(cwd, getPathSchema(gitRepositoryOptions))

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

export const getLatestCommitHash = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  ref: string,
): Promise<string> => {
  const cwd = getWorkingDirectory()
  const currentBranch = await getCurrentBranch(cwd)

  if (ref !== currentBranch) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      `Requested commit ref "${ref}" does not match currently checked out branch ` +
        `"${currentBranch}"; this adapter requires the target branch to already be checked out`,
    )
  }

  const currentCommitHash = await getCurrentCommitHash(cwd)
  if (!currentCommitHash) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      `Requested commit ref "${ref}" does not have any existing commits`,
    )
  }

  return currentCommitHash
}

interface EntryFileChange {
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
 * changed entry files after the branch was moved.
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

  const changes: EntryFileChange[] = commitDraft.entries.map((entryDraft) => ({
    path: getPathEntryFile(pathEntryFolder, entryDraft.id),
    content: entryDraft.deletion
      ? undefined
      : stringify({ metadata: entryDraft.metadata, data: entryDraft.data }),
  }))

  const newCommitHash = await createCommitObject(
    cwd,
    commitDraft.parentSha,
    commitDraft.message,
    changes,
  )

  try {
    await runGit(
      [
        'update-ref',
        '-m',
        `commit: ${commitDraft.message.split('\n')[0]}`,
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
  changes: EntryFileChange[],
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
        'Commit draft contains no effective entry changes',
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

// brings working tree and index in line with the new branch head for the changed entry files, leaving all other
// files untouched
const updateWorkingTree = async (
  cwd: string,
  changes: EntryFileChange[],
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
