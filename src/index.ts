import { Entry, GitAdapter } from '@commitspark/git-adapter'
import {
  createCommit,
  getEntries,
  getLatestCommitHash,
  getSchema,
} from './filesystem-adapter'

export interface FilesystemRepositoryOptions {
  checkedOutCommitHash: string
  pathSchemaFile?: string
  pathEntryFolder?: string
}

export function createAdapter(
  gitRepositoryOptions: FilesystemRepositoryOptions,
): GitAdapter {
  return {
    getEntries: (...args): Promise<Entry[]> =>
      getEntries(gitRepositoryOptions, ...args),
    getSchema: (): Promise<string> => getSchema(gitRepositoryOptions),
    getLatestCommitHash: (ref: string) =>
      getLatestCommitHash(gitRepositoryOptions, ref),
    createCommit: () => createCommit(),
  }
}
