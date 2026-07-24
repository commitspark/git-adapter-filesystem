import { CommitDraft, Entry, GitAdapter } from '@commitspark/git-adapter'
import {
  createCommit,
  getEntries,
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
    getEntries: (...args): Promise<Entry[]> =>
      getEntries(gitRepositoryOptions, ...args),
    getSchema: (): Promise<string> => getSchema(gitRepositoryOptions),
    getLatestCommitHash: (ref: string) =>
      getLatestCommitHash(gitRepositoryOptions, ref),
    createCommit: (commitDraft: CommitDraft) =>
      createCommit(gitRepositoryOptions, commitDraft),
  }
}
