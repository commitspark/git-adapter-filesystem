# Introduction

[Commitspark](https://commitspark.com) is a set of tools to manage structured data with Git through a GraphQL API.

This repository holds code for a [Commitspark Git adapter](https://github.com/commitspark/git-adapter) that provides
access to Git repositories checked out in the local filesystem.

This adapter is primarily meant to be used in read-only CI/CD pipeline scenarios, e.g. to validate a repository.

Write support is present mostly for demonstration purposes and comes with several limitations.

# Prerequisites

- The `git` binary must be installed and included in `$PATH`, e.g. by using a CI/CD image that contains it.
- The working directory must be the top-level folder of the Git repository, and the repository must contain the
  commits to read. With shallow clones, only the fetched commits can be read.

Otherwise, calls fail with a `GitAdapterError` with code `INTERNAL_ERROR`.

# Working directory

The current working directory for file system access is determined by sequentially checking the following sources:

1. `GITHUB_WORKSPACE` GitHub Actions environment variable
2. `CI_PROJECT_DIR` GitLab CI/CD environment variable
3. `process.cwd()`

# Read support

Reads return the state of the given commit from the Git object database, and `ref` can be any branch name, tag name
or commit hash. Unlike with other adapters, other revision expressions such as `HEAD~1` resolve as well. Uncommitted
changes in the working tree are not read.

CI/CD pipelines usually check out a detached HEAD, without local branches. There, `ref` should be `HEAD` or the commit
hash of the pipeline, e.g. `CI_COMMIT_SHA` in GitLab or `GITHUB_SHA` in GitHub Actions.

# Write support

`createCommit()` commits entry changes using the `git` binary. It is intended for demonstration purposes, not
production use.

## Commit precondition

A commit is only added to the branch if the branch still points to `commitDraft.parentSha`; otherwise a
`GitAdapterError` with code `CONFLICT` is thrown. This lets callers such as the Commitspark GraphQL API detect that
another writer committed after they validated their change, and repeat the validation instead of overwriting changes
they have not seen.

To make this check atomic, the commit is assembled in a temporary index with Git plumbing commands
(`read-tree`, `hash-object`, `update-index`, `write-tree`, `commit-tree`) and the branch is moved with
`git update-ref <branch> <new> <parentSha>`, which only succeeds if the branch still points to `parentSha`. Only
afterwards are the changed entry files written to the working tree and the index.

## Limitations

- When committing to a branch, the branch must already be checked out in the filesystem
- If writing to the working tree fails after a commit, the working tree is left in an undefined state
- `git` must have a usable `user.name`/`user.email` configuration present

## Additional notes

- File modifications are constrained to those within `pathEntryFolder`
- Only the files corresponding to mutated entries are committed and updated in the working tree and index, unrelated
  changes in the filesystem and index are left untouched
- Commits are only created locally and not pushed to any remote

# Usage

Instantiate the adapter with `createAdapter()` and the following options:

| Option name            | Required | Default value                       | Description                        |
|------------------------|----------|-------------------------------------|------------------------------------|
| `checkedOutCommitHash` | False    | N/A                                 | Deprecated; has no effect          |
| `pathSchemaFile`       | False    | `commitspark/schema/schema.graphql` | Path to schema file in repository  |
| `pathEntryFolder`      | False    | `commitspark/entries/`              | Path to folder for content entries |

Paths are relative to the top-level folder of the repository and use `/` as separator. `createAdapter()` throws a
`GitAdapterError` with code `INTERNAL_ERROR` for paths outside the repository, such as absolute paths.

# License

The code in this repository is licensed under the permissive ISC license (see [LICENSE](LICENSE)).
