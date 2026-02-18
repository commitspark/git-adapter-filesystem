import { FilesystemRepositoryOptions } from './index.ts'
import { PATH_ENTRY_FOLDER, PATH_SCHEMA_FILE } from './types.ts'

export const getPathSchema = (
  gitRepositoryOptions: FilesystemRepositoryOptions,
) => {
  return gitRepositoryOptions.pathSchemaFile ?? PATH_SCHEMA_FILE
}

export const getPathEntryFolder = (
  gitRepositoryOptions: FilesystemRepositoryOptions,
): string => {
  const pathEntryFolder =
    gitRepositoryOptions.pathEntryFolder ?? PATH_ENTRY_FOLDER

  if (pathEntryFolder.endsWith('/')) {
    return pathEntryFolder.substring(0, pathEntryFolder.length - 1)
  }

  return pathEntryFolder
}
