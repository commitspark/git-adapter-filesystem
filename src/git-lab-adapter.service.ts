import {
  Commit,
  CommitDraft,
  ContentEntry,
  ENTRY_EXTENSION,
  GitAdapter,
  SCHEMA_FILENAME,
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

    const entriesPath = this.gitRepositoryOptions.entriesPath

    const readPromises = []
    const entries: ContentEntry[] = []
    const fileNames = await fs.readdir(entriesPath)
    for (const fileName of fileNames) {
      const filePath = `${entriesPath}/${fileName}`
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

    return fs.readFile(
      `${this.gitRepositoryOptions.schemaPath}/${SCHEMA_FILENAME}`,
      {
        encoding: 'utf-8',
      },
    )
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
