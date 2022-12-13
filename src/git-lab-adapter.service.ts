import {
  Commit,
  CommitDraft,
  ContentEntry,
  ENTRY_EXTENSION,
  PATH_SCHEMA_FILE,
  PATH_ENTRY_FOLDER,
  GitAdapter,
} from '@contentlab/git-adapter'
import { FilesystemRepositoryOptions } from './index'
import * as fs from 'fs/promises'
import { parse } from 'yaml'

export class GitLabAdapterService implements GitAdapter {
  private gitRepositoryOptions: FilesystemRepositoryOptions | undefined

  constructor() {}

  public async setRepositoryOptions(
    repositoryOptions: FilesystemRepositoryOptions,
  ): Promise<void> {
    this.gitRepositoryOptions = repositoryOptions
  }

  public async getContentEntries(commitHash: string): Promise<ContentEntry[]> {
    if (this.gitRepositoryOptions === undefined) {
      throw new Error('Repository options must be set before reading')
    }
    if (commitHash !== this.gitRepositoryOptions.checkedOutCommitHash) {
      throw new Error(
        `This adapter does not support navigating the git history; current commit hash is ` +
          `"${this.gitRepositoryOptions.checkedOutCommitHash}" but "${commitHash}" was requested`,
      )
    }

    const pathEntryFolder = this.getPathEntryFolder(this.gitRepositoryOptions)

    const readPromises = []
    const entries: ContentEntry[] = []
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
            entries.push(new ContentEntry(id, content.metadata, content.data))
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

    const schemaFilePath =
      this.gitRepositoryOptions.pathSchemaFile ?? PATH_SCHEMA_FILE

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

  private getPathEntryFolder(
    gitRepositoryOptions: FilesystemRepositoryOptions,
  ): string {
    const pathEntryFolder =
      gitRepositoryOptions.pathEntryFolder ?? PATH_ENTRY_FOLDER

    if (pathEntryFolder.endsWith('/')) {
      return pathEntryFolder.substring(0, pathEntryFolder.length - 1)
    }

    return pathEntryFolder
  }
}
