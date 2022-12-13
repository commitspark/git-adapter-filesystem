# Introduction

**[Contentlab](https://contentlab.sh) is a library that generates a GraphQL content management API on top of
a Git repository.**

This repository holds code that implements a Contentlab Git adapter for accessing content stored in a local filesystem.

This adapter is meant to be used in CI/CD pipelines where a single Git revision of content checked out in the filesystem
needs to be read.

# Usage

Instantiate the adapter with `createAdapter()` and then set adapter options `FilesystemRepositoryOptions` on the
instance.

| Option name            | Required | Default value           | Description                                                 |
|------------------------|----------|-------------------------|-------------------------------------------------------------|
| `checkedOutCommitHash` | True     |                         | Git hash / revision currently checked out in the filesystem |
| `pathSchemaFile`       | False    | `schema/schema.graphql` | Path to schema file in repository                           |
| `pathEntryFolder`      | False    | `entries/`              | Path to folder for content entries                          |

# License

The code in this repository is licensed under the permissive ISC license (see [LICENSE](LICENSE)).
