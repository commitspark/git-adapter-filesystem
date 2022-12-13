import { GitAdapter, GitRepositoryOptions } from '@contentlab/git-adapter'
import { app } from './container'

export { GitLabAdapterService } from './git-lab-adapter.service'

export interface FilesystemRepositoryOptions extends GitRepositoryOptions {
  checkedOutCommitHash: string
  pathSchemaFile?: string
  pathEntryFolder?: string
}

export function createAdapter(): GitAdapter {
  return app.adapter
}
