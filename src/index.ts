import {
  CommitDraft,
  Entry,
  EntryHash,
  GitAdapter,
} from '@commitspark/git-adapter'
import {
  createCommit,
  getEntriesByIds,
  getEntryHashes,
  getLatestCommitHash,
  getSchema,
} from './filesystem-adapter.ts'

export interface FilesystemRepositoryOptions {
  /**
   * @deprecated Has no effect; the currently checked out commit is now determined automatically.
   */
  checkedOutCommitHash?: string
  pathSchemaFile?: string
  pathEntryFolder?: string
}

export function createAdapter(
  gitRepositoryOptions: FilesystemRepositoryOptions,
): GitAdapter {
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
