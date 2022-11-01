import { GitAdapter, GitRepositoryOptions } from '@contentlab/git-adapter'
import { app } from './container'

export { GitLabAdapterService } from './git-lab-adapter.service'

export interface FilesystemRepositoryOptions extends GitRepositoryOptions {
  schemaPath: string
  entriesPath: string
  checkedOutCommitHash: string
}

export function createAdapter(): GitAdapter {
  return app.adapter
}
