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

  const currentCommitHash = await getCurrentCommitHash(cwd)
  if (currentCommitHash !== commitDraft.parentSha) {
    throw new GitAdapterError(
      ErrorCode.CONFLICT,
      `Branch "${commitDraft.ref}" has moved: expected parent commit "${commitDraft.parentSha}" ` +
        `but current HEAD is "${currentCommitHash}"`,
    )
  }

  // validate all entries before writing any of them
  commitDraft.entries.forEach((entryDraft) => validateEntryId(entryDraft.id))
  const absolutePathEntryFolder = path.resolve(cwd, pathEntryFolder)
  for (const entryDraft of commitDraft.entries) {
    await assertPathHasNoSymbolicLinks(absolutePathEntryFolder, entryDraft.id)
  }

  const touchedPaths: string[] = []

  for (const entryDraft of commitDraft.entries) {
    const entryPath = getPathEntryFile(pathEntryFolder, entryDraft.id)
    const absolutePath = path.resolve(cwd, entryPath)

    if (entryDraft.deletion) {
      const existed = await fs
        .stat(absolutePath)
        .then(() => true)
        .catch(() => false)
      if (!existed) {
        continue
      }
      await fs.rm(absolutePath)
    } else {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true })
      await fs.writeFile(
        absolutePath,
        stringify({ metadata: entryDraft.metadata, data: entryDraft.data }),
        { encoding: 'utf8' },
      )
    }
    touchedPaths.push(entryPath)
  }

  if (touchedPaths.length === 0) {
    throw new GitAdapterError(
      ErrorCode.BAD_REQUEST,
      'Commit draft contains no effective entry changes',
    )
  }

  await runGit(['add', '--', ...touchedPaths], cwd)
  await runGit(
    ['commit', `--message=${commitDraft.message}`, '--', ...touchedPaths],
    cwd,
  )

  const newCommitHash = await runGit(['rev-parse', 'HEAD'], cwd)

  return { commitHash: newCommitHash }
}

function getWorkingDirectory(): string {
  return (
    process.env.GITHUB_WORKSPACE ?? process.env.CI_PROJECT_DIR ?? process.cwd()
  )
}
