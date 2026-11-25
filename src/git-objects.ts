import { spawn } from 'child_process'
import { ErrorCode, GitAdapterError } from '@commitspark/git-adapter'
import { createGitBinaryMissingError, isGitBinaryMissing } from './git-cli.ts'

/**
 * Regular file in the tree of a commit, with its path relative to the working directory.
 */
interface CommitFile {
  path: string
  blobHash: string
}

// file modes of regular files in Git trees; symbolic links (120000) and submodules (160000) are no files
const REGULAR_FILE_MODES = ['100644', '100755']

/**
 * Lists the regular files of a commit below the given path, which is relative to the working directory.
 */
export async function listCommitFiles(
  cwd: string,
  commitHash: string,
  treePath: string,
): Promise<CommitFile[]> {
  // `-z` prints paths unquoted and terminated by NUL, so that any file name can be parsed
  const output = await runGitBinary(
    ['ls-tree', '-r', '-z', commitHash, '--', treePath],
    cwd,
  )
  const files: CommitFile[] = []
  for (const line of output.toString('utf8').split('\0')) {
    if (line === '') {
      continue
    }
    // format: <mode> SP <type> SP <object> TAB <path>
    const tabIndex = line.indexOf('\t')
    const [mode, type, blobHash] = line.substring(0, tabIndex).split(' ')
    if (type === 'blob' && REGULAR_FILE_MODES.includes(mode)) {
      files.push({ path: line.substring(tabIndex + 1), blobHash: blobHash })
    }
  }
  return files
}

/**
 * Reads the content of the given blobs in a single Git process, in the order of the given hashes.
 */
export async function readBlobs(
  cwd: string,
  blobHashes: string[],
): Promise<Buffer[]> {
  if (blobHashes.length === 0) {
    return []
  }
  const output = await runGitBinary(
    ['cat-file', '--batch'],
    cwd,
    blobHashes.map((hash) => `${hash}\n`).join(''),
  )
  // format per object: <object> SP <type> SP <size> LF <content> LF
  const contents: Buffer[] = []
  let offset = 0
  for (const blobHash of blobHashes) {
    const headerEnd = output.indexOf(0x0a, offset)
    const header = output.toString('utf8', offset, headerEnd).split(' ')
    if (header[1] !== 'blob') {
      throw new GitAdapterError(
        ErrorCode.INTERNAL_ERROR,
        `Failed to read blob "${blobHash}": ${header.slice(1).join(' ')}`,
      )
    }
    const size = Number(header[2])
    contents.push(output.subarray(headerEnd + 1, headerEnd + 1 + size))
    offset = headerEnd + 1 + size + 1
  }
  return contents
}

// runs git with optional standard input and returns its unmodified standard output, which may exceed the output limit
// of `execFile()`
function runGitBinary(
  args: string[],
  cwd: string,
  input?: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error) =>
      reject(
        isGitBinaryMissing(error)
          ? createGitBinaryMissingError(cwd)
          : new GitAdapterError(
              ErrorCode.INTERNAL_ERROR,
              `"git ${args.join(' ')}" failed (${error.message})`,
            ),
      ),
    )
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve(Buffer.concat(stdout))
      } else {
        reject(
          new GitAdapterError(
            ErrorCode.INTERNAL_ERROR,
            `"git ${args.join(' ')}" failed: ${Buffer.concat(stderr).toString('utf8').trim()}`,
          ),
        )
      }
    })
    child.stdin.end(input ?? '')
  })
}
