import { ToolResult } from './index';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ChunkArgs {
  filePath: string;
  offset?: number;
  length?: number;
  encoding?: BufferEncoding;
  lineBased?: boolean;
  maxChunkSize?: number;
}

interface ChunkMetadata {
  content: string;
  bytesRead: number;
  startOffset: number;
  endOffset: number;
  hasMore: boolean;
  fileSize: number;
  encoding: BufferEncoding;
  lineAligned: boolean;
  isPartialLine?: boolean;
}

/**
 * Reads a specific byte segment (chunk) from a file with surgical precision.
 * Designed to handle large files without memory overflow by streaming exact byte ranges.
 * Supports both raw byte chunks and line-aligned reading modes.
 * 
 * @param args - Configuration object containing file path and read parameters
 * @param args.filePath - Absolute or relative path to the target file (handles Windows/Unix paths)
 * @param args.offset - Byte position to start reading (default: 0)
 * @param args.length - Number of bytes to read (default: 8192, max: 10MB)
 * @param args.encoding - Character encoding for buffer conversion (default: 'utf8')
 * @param args.lineBased - If true, expands chunk to align with line boundaries (default: false)
 * @param args.maxChunkSize - Safety limit to prevent memory overflow (default: 10485760 = 10MB)
 * @param options - Additional execution context (unused but reserved for AgentForge)
 * @returns ToolResult containing chunk content and metadata, or error details
 */
export async function chunk(args: ChunkArgs, options: any = {}): Promise<ToolResult> {
  const MAX_DEFAULT_CHUNK = 10 * 1024 * 1024; // 10MB safety limit
  
  try {
    // --- Reasoning Phase: Input Validation & Sanitization ---
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments: expected object with filePath');
    }

    const { 
      filePath, 
      offset = 0, 
      length = 8192, 
      encoding = 'utf8',
      lineBased = false,
      maxChunkSize = MAX_DEFAULT_CHUNK
    } = args;

    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required and must be a string');
    }

    // Normalize path for Windows edge cases: UNC paths, drive letters, backslashes, trailing slashes
    const normalizedPath = path.normalize(filePath);
    const absolutePath = path.resolve(normalizedPath);

    // Validate numeric parameters with strict bounds checking
    const startOffset = Math.max(0, Math.floor(Number(offset)));
    if (!Number.isFinite(startOffset)) {
      throw new Error('offset must be a finite number');
    }

    let chunkLength = Math.floor(Number(length));
    if (!Number.isFinite(chunkLength) || chunkLength <= 0) {
      throw new Error('length must be a positive finite number');
    }

    // Apply surgical memory constraints
    const safeMaxChunk = Math.min(Math.floor(Number(maxChunkSize)) || MAX_DEFAULT_CHUNK, MAX_DEFAULT_CHUNK);
    chunkLength = Math.min(chunkLength, safeMaxChunk);

    // --- Surgical Precision Phase: File Analysis ---
    let fileHandle: fs.FileHandle | null = null;
    
    try {
      // Open file with minimal read-only permissions
      fileHandle = await fs.open(absolutePath, 'r');
      
      // Get precise file statistics without loading content
      const stats = await fileHandle.stat();
      
      if (!stats.isFile()) {
        throw new Error(`Path is not a regular file: ${filePath}`);
      }

      const fileSize = stats.size;
      
      // Calculate exact byte boundaries to prevent over-reading
      const actualStart = Math.min(startOffset, fileSize);
      const remainingBytes = fileSize - actualStart;
      const actualLength = Math.min(chunkLength, remainingBytes);
      
      if (actualLength <= 0) {
        return new ToolResult(true, `Reached end of file (size: ${fileSize} bytes)`, {
          content: '',
          bytesRead: 0,
          startOffset: actualStart,
          endOffset: actualStart,
          hasMore: false,
          fileSize,
          encoding,
          lineAligned: false
        });
      }

      // --- Execution Phase: Precise Byte Reading ---
      const buffer = Buffer.alloc(actualLength);
      const readResult = await fileHandle.read(buffer, 0, actualLength, actualStart);
      const bytesRead = readResult.bytesRead;

      if (bytesRead === 0) {
        return new ToolResult(true, 'No data read from file', {
          content: '',
          bytesRead: 0,
          startOffset: actualStart,
          endOffset: actualStart,
          hasMore: actualStart < fileSize,
          fileSize,
          encoding,
          lineAligned: false
        });
      }

      let content = buffer.toString(encoding, 0, bytesRead);
      let finalStart = actualStart;
      let finalEnd = actualStart + bytesRead;
      let lineAligned = false;
      let isPartialLine = false;

      // --- Line-Based Surgical Adjustment ---
      if (lineBased && content.length > 0) {
        // If not at file start, skip partial first line
        if (finalStart > 0) {
          const firstNewline = content.indexOf('\n');
          if (firstNewline !== -1) {
            const charsToSkip = firstNewline + 1;
            finalStart += Buffer.byteLength(content.slice(0, charsToSkip), encoding);
            content = content.slice(charsToSkip);
          } else {
            // Entire chunk is a partial line - mark as incomplete
            isPartialLine = true;
            content = '';
          }
        }

        // If not at EOF, extend to line boundary
        if (finalEnd < fileSize && content.length > 0 && !content.endsWith('\n')) {
          const searchBufferSize = Math.min(4096, fileSize - finalEnd);
          const searchBuffer = Buffer.alloc(searchBufferSize);
          const searchResult = await fileHandle.read(searchBuffer, 0, searchBufferSize, finalEnd);
          
          const searchStr = searchBuffer.toString(encoding, 0, searchResult.bytesRead);
          const nextNewline = searchStr.indexOf('\n');
          
          if (nextNewline !== -1) {
            const additionalContent = searchStr.slice(0, nextNewline + 1);
            finalEnd += Buffer.byteLength(additionalContent, encoding);
            content += additionalContent;
          } else {
            // No newline found before EOF, extend to end
            finalEnd = fileSize;
          }
        }
        
        lineAligned = !isPartialLine;
      }

      const hasMore = finalEnd < fileSize;

      const metadata: ChunkMetadata = {
        content,
        bytesRead: Buffer.byteLength(content, encoding),
        startOffset: finalStart,
        endOffset: finalEnd,
        hasMore,
        fileSize,
        encoding,
        lineAligned,
        isPartialLine
      };

      const summary = `Read ${metadata.bytesRead} bytes (${finalStart}-${finalEnd}/${fileSize}) from ${path.basename(absolutePath)}${hasMore ? ' [more]' : ' [end]'}`;

      return new ToolResult(true, summary, metadata);

    } finally {
      // Guarantee resource liberation regardless of outcome
      if (fileHandle) {
        await fileHandle.close().catch(err => {
          console.error(chalk.red(`Failed to close file handle: ${err.message}`));
        });
      }
    }

  } catch (error: any) {
    let errorMessage = error.message;
    
    // Handle Windows-specific and cross-platform error codes
    if (error.code === 'ENOENT') {
      errorMessage = `File not found: ${args?.filePath || 'undefined'}`;
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
      errorMessage = `Permission denied accessing: ${args?.filePath || 'undefined'}`;
    } else if (error.code === 'EISDIR') {
      errorMessage = `Path is a directory, not a file: ${args?.filePath || 'undefined'}`;
    } else if (error.code === 'EINVAL') {
      errorMessage = `Invalid argument or file descriptor`;
    }

    return new ToolResult(false, `Chunk operation failed: ${errorMessage}`, {
      error: errorMessage,
      code: error.code,
      path: args?.filePath
    });
  }
}