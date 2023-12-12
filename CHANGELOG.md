# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Changed
- Add eslint

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
