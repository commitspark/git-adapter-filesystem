import { GitAdapter, GitRepositoryOptions } from '@commitspark/git-adapter'
import { filesystemAdapterService } from './container'

export { FilesystemAdapterService } from './filesystem-adapter.service'

export interface FilesystemRepositoryOptions extends GitRepositoryOptions {
  checkedOutCommitHash: string
  pathSchemaFile?: string
  pathEntryFolder?: string
}

export function createAdapter(): GitAdapter {
  return filesystemAdapterService
}
