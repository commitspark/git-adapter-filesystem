import {
  Commit,
  Entry,
  ErrorCode,
  GitAdapterError,
} from '@commitspark/git-adapter'
import { FilesystemRepositoryOptions } from './index.ts'
import * as fs from 'fs/promises'
import { parse } from 'yaml'
import { getPathEntryFolder, getPathSchema } from './path-factory.ts'
import { ENTRY_EXTENSION } from './types.ts'

export const getEntries = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  commitHash: string,
): Promise<Entry[]> => {
  if (gitRepositoryOptions === undefined) {
    throw new Error('Repository options must be set before reading')
  }
  if (commitHash !== gitRepositoryOptions.checkedOutCommitHash) {
    throw new Error(
      `This adapter does not support navigating the git history; current commit hash is ` +
        `"${gitRepositoryOptions.checkedOutCommitHash}" but "${commitHash}" was requested`,
    )
  }

  const pathEntryFolder = getPathEntryFolder(gitRepositoryOptions)

  const readPromises = []
  const entries: Entry[] = []
  const fileNames = await fs.readdir(pathEntryFolder)
  for (const fileName of fileNames) {
    const filePath = `${pathEntryFolder}/${fileName}`
    const id = fileName.substring(0, fileName.length - ENTRY_EXTENSION.length)
    readPromises.push(
      fs
        .readFile(filePath, {
          encoding: 'utf8',
        })
        .then((fileContent) => {
          const content = parse(fileContent)
          entries.push({
            id: id,
            metadata: content.metadata,
            data: content.data,
          })
        }),
    )
  }
  await Promise.all(readPromises)
  return entries
}

export const getSchema = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
): Promise<string> => {
  const schemaFilePath = getPathSchema(gitRepositoryOptions)

  return fs.readFile(schemaFilePath, {
    encoding: 'utf-8',
  })
}

export const getLatestCommitHash = async (
  gitRepositoryOptions: FilesystemRepositoryOptions,
  ref: string,
): Promise<string> => {
  if (ref !== gitRepositoryOptions.checkedOutCommitHash) {
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      'This adapter does not support navigating the git history; the adapter was created with commit hash ' +
        `"${gitRepositoryOptions.checkedOutCommitHash}" but "${ref}" was requested`,
    )
  }

  return gitRepositoryOptions.checkedOutCommitHash
}

export const createCommit = async (): Promise<Commit> => {
  throw new GitAdapterError(
    ErrorCode.INTERNAL_ERROR,
    'This adapter does not support creating commits',
  )
}
