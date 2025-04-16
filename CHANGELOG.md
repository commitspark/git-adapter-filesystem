# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Fix incorrect types export

## [0.7.0] - 2025-04-13

### Changed

- Refactor library packaging to support ESM and CJS
- Clean up dependencies and relax version constraints

## [0.6.0] - 2024-08-30

### Changed

- Upgrade to `@commitspark/git-adapter` 0.13.0
- Update dependencies

## [0.5.0] - 2023-12-12

### Changed

- Add eslint
- Upgrade to `@commitspark/git-adapter` 0.10.0 with new default directories
- Reduce number of files included in NPM package

### Fixed

- Fix build process to include only relevant files

## [0.4.0] - 2023-05-13

### Changed

- Rename organization
- Update `yaml` library to address [security advisory](https://github.com/advisories/GHSA-f9xv-q969-pqx4)

## [0.3.0] - 2023-04-28

### Changed

- Replace constructor use with object literals to prevent polluting DTOs with prototype function
- Update to Git Adapter interface 0.7.0
- Remove dependency injection package to support bundling with webpack & co.

## [0.2.0] - 2022-12-13

### Changed

- Update schema file path and entries folder path repository options to align with other adapters

## [0.1.0] - 2022-11-01

### Added

- Initial release
