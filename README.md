# Introduction

[Commitspark](https://commitspark.com) is a set of tools to manage structured data with Git through a GraphQL API.

This repository holds code for a [Commitspark Git adapter](https://github.com/commitspark/git-adapter) that provides
access to Git repositories checked out in the local filesystem.

This adapter is meant to be used in CI/CD pipelines where a single Git revision of content checked out in the filesystem
needs to be read.

# Usage

Instantiate the adapter with `createAdapter()` and then set adapter options `FilesystemRepositoryOptions` on the
instance.

| Option name            | Required | Default value                       | Description                                                 |
|------------------------|----------|-------------------------------------|-------------------------------------------------------------|
| `checkedOutCommitHash` | True     |                                     | Git hash / revision currently checked out in the filesystem |
| `pathSchemaFile`       | False    | `commitspark/schema/schema.graphql` | Path to schema file in repository                           |
| `pathEntryFolder`      | False    | `commitspark/entries/`              | Path to folder for content entries                          |

# License

The code in this repository is licensed under the permissive ISC license (see [LICENSE](LICENSE)).
