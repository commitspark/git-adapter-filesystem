import {
  CommitDraft,
  Entry,
  EntryHash,
  GitAdapter,
} from '@commitspark/git-adapter'
import { getPathEntryFolder, getPathSchema } from './path-factory.ts'
import {
  createCommit,
  getEntriesByIds,
  getEntryHashes,
  getLatestCommitHash,
  getSchema,
} from './filesystem-adapter.ts'

export interface FilesystemRepositoryOptions {
  /**
   * @deprecated Has no effect.
   */
  checkedOutCommitHash?: string
  pathSchemaFile?: string
  pathEntryFolder?: string
}

export function createAdapter(
  gitRepositoryOptions: FilesystemRepositoryOptions,
): GitAdapter {
  // fail on invalid path options when creating the adapter instead of on first use
  getPathEntryFolder(gitRepositoryOptions)
  getPathSchema(gitRepositoryOptions)

  return {
    getEntryHashes: (...args): Promise<EntryHash[]> =>
      getEntryHashes(gitRepositoryOptions, ...args),
    getEntriesByIds: (...args): Promise<Entry[]> =>
      getEntriesByIds(gitRepositoryOptions, ...args),
    getSchema: (commitHash: string): Promise<string> =>
      getSchema(gitRepositoryOptions, commitHash),
    getLatestCommitHash: (ref: string) =>
      getLatestCommitHash(gitRepositoryOptions, ref),
    createCommit: (commitDraft: CommitDraft) =>
      createCommit(gitRepositoryOptions, commitDraft),
  }
}
