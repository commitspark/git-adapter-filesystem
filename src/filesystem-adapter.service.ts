import {
  Commit,
  CommitDraft,
  Entry,
  ENTRY_EXTENSION,
  GitAdapter,
} from '@commitspark/git-adapter'
import { FilesystemRepositoryOptions } from './index'
import * as fs from 'fs/promises'
import { parse } from 'yaml'
import { PathFactoryService } from './path-factory.service'

export class FilesystemAdapterService implements GitAdapter {
  private gitRepositoryOptions: FilesystemRepositoryOptions | undefined

  constructor(private pathFactory: PathFactoryService) {}

  public async setRepositoryOptions(
    repositoryOptions: FilesystemRepositoryOptions,
  ): Promise<void> {
    this.gitRepositoryOptions = repositoryOptions
  }

  public async getEntries(commitHash: string): Promise<Entry[]> {
    if (this.gitRepositoryOptions === undefined) {
      throw new Error('Repository options must be set before reading')
    }
    if (commitHash !== this.gitRepositoryOptions.checkedOutCommitHash) {
      throw new Error(
        `This adapter does not support navigating the git history; current commit hash is ` +
          `"${this.gitRepositoryOptions.checkedOutCommitHash}" but "${commitHash}" was requested`,
      )
    }

    const pathEntryFolder = this.pathFactory.getPathEntryFolder(
      this.gitRepositoryOptions,
    )

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

  public async getSchema(commitHash: string): Promise<string> {
    if (this.gitRepositoryOptions === undefined) {
      throw new Error('Repository options must be set before reading')
    }

    const schemaFilePath = this.pathFactory.getPathSchema(
      this.gitRepositoryOptions,
    )

    return fs.readFile(schemaFilePath, {
      encoding: 'utf-8',
    })
  }

  public async getLatestCommitHash(ref: string): Promise<string> {
    if (this.gitRepositoryOptions === undefined) {
      throw new Error('Repository options must be set before reading')
    }
    if (ref !== this.gitRepositoryOptions.checkedOutCommitHash) {
      throw new Error(
        `This adapter does not support navigating the git history; current commit hash is ` +
          `"${this.gitRepositoryOptions.checkedOutCommitHash}" but "${ref}" was requested`,
      )
    }

    return this.gitRepositoryOptions.checkedOutCommitHash
  }

  public async createCommit(commitDraft: CommitDraft): Promise<Commit> {
    throw new Error('This adapter does not support creating commits')
  }
}
