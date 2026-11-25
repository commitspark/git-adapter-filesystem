import { ErrorCode, GitAdapterError } from '@commitspark/git-adapter'
import * as path from 'path'
import { FilesystemRepositoryOptions } from './index.ts'
import { PATH_ENTRY_FOLDER, PATH_SCHEMA_FILE } from './types.ts'

export const getPathSchema = (
  gitRepositoryOptions: FilesystemRepositoryOptions,
): string =>
  normalizeRepositoryPath(
    gitRepositoryOptions.pathSchemaFile ?? PATH_SCHEMA_FILE,
    'pathSchemaFile',
  )

export const getPathEntryFolder = (
  gitRepositoryOptions: FilesystemRepositoryOptions,
): string =>
  normalizeRepositoryPath(
    gitRepositoryOptions.pathEntryFolder ?? PATH_ENTRY_FOLDER,
    'pathEntryFolder',
  )

/**
 * Returns the given path relative to the top-level folder of the repository in the form Git uses for paths in trees,
 * e.g. without `./` or trailing `/`. Paths that cannot be found in Git trees are rejected, so that a misconfigured path
 * fails instead of silently matching no files.
 */
const normalizeRepositoryPath = (value: string, optionName: string): string => {
  const normalizedPath = path.posix.normalize(value).replace(/\/+$/, '')
  if (
    value.includes('\\') ||
    path.posix.isAbsolute(normalizedPath) ||
    normalizedPath === '' ||
    normalizedPath === '.' ||
    normalizedPath === '..' ||
    normalizedPath.startsWith('../')
  ) {
    throw new GitAdapterError(
      ErrorCode.INTERNAL_ERROR,
      `Option "${optionName}" must be a path below the top-level folder of the repository with "/" as separator, ` +
        `but is "${value}"`,
    )
  }
  return normalizedPath
}
