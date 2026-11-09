# Introduction

[Commitspark](https://commitspark.com) is a set of tools to manage structured data with Git through a GraphQL API.

This repository holds code for a [Commitspark Git adapter](https://github.com/commitspark/git-adapter) that provides
access to Git repositories checked out in the local filesystem.

This adapter is primarily meant to be used in read-only CI/CD pipeline scenarios where a single Git revision of entries
is already checked out in the filesystem.

Write support is present mostly for demonstration purposes and comes with several limitations.

# Working directory

The current working directory for file system access is determined by sequentially checking the following sources:

1. `GITHUB_WORKSPACE` GitHub Actions environment variable
2. `CI_PROJECT_DIR` GitLab CI/CD environment variable
3. `process.cwd()`

# Read support

The currently checked out branch and commit hash are determined in the following order:

1. Output of querying with the `git` binary, if present
2. GitHub `GITHUB_SHA` and `GITHUB_REF_NAME` environment variables
3. GitLab `CI_COMMIT_SHA` and `CI_COMMIT_REF_NAME` environment variables

If none of these lead to a result, an error is thrown.

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

## Prerequisites and limitations

- The `git` binary must be installed and included in `$PATH`
- When committing to a branch, the branch must already be checked out in the filesystem
- Since entries are read from the working tree, reads in other processes may briefly see the previous content of
  changed entry files after a commit, until the working tree has been updated
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

# License

The code in this repository is licensed under the permissive ISC license (see [LICENSE](LICENSE)).
