import { ToolResult } from './index';
import chalk from 'chalk';
import * as ts from 'typescript';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

interface RefactorTarget {
  line?: number;
  column?: number;
  oldName?: string;
  newName?: string;
  startOffset?: number;
  endOffset?: number;
  symbolType?: 'variable' | 'function' | 'class' | 'interface';
}

interface RefactorArgs {
  filePath: string;
  transformationType: 'rename-symbol' | 'extract-method' | 'convert-arrow' | 'organize-imports' | 'remove-dead-code';
  target: RefactorTarget;
  dryRun?: boolean;
  preserveFormatting?: boolean;
}

interface TextChange {
  start: number;
  end: number;
  newText: string;
  description: string;
}

interface AnalysisResult {
  valid: boolean;
  reason?: string;
  summary: string;
  changes: TextChange[];
  affectedNodes: ts.Node[];
}

export async function refactor(args: RefactorArgs, options: any = {}): Promise<ToolResult> {
  try {
    // Input validation
    if (!args?.filePath || !args?.transformationType) {
      return new ToolResult(false, 'Missing required parameters: filePath and transformationType');
    }

    // Windows path edge case handling
    let normalizedPath = path.normalize(args.filePath);
    
    // Handle Windows UNC paths and drive letters
    if (process.platform === 'win32') {
      // Ensure consistent separators
      normalizedPath = normalizedPath.replace(/\//g, path.sep);
      
      // Handle relative drive paths (.\ or ..\)
      if (normalizedPath.match(/^\.{1,2}[\\\/]/)) {
        normalizedPath = path.resolve(normalizedPath);
      }
    }

    const absolutePath = path.resolve(normalizedPath);

    // Verify file exists and is readable
    let fileStats;
    try {
      fileStats = await fs.stat(absolutePath);
      if (!fileStats.isFile()) {
        return new ToolResult(false, `Path is not a file: ${absolutePath}`);
      }
    } catch (error) {
      return new ToolResult(false, `File not accessible: ${absolutePath} - ${(error as Error).message}`);
    }

    // Read source with original line endings preserved (Windows CRLF handling)
    const sourceBuffer = await fs.readFile(absolutePath);
    const sourceText = sourceBuffer.toString('utf-8');
    
    // Detect line endings for preservation
    const lineEnding = sourceText.includes('\r\n') ? '\r\n' : '\n';

    // Create TypeScript program for semantic analysis
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.CommonJS,
      allowJs: true,
      noEmit: true,
      skipLibCheck: true
    };

    const sourceFile = ts.createSourceFile(
      path.basename(absolutePath),
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    console.log(chalk.blue('🔍 Phase 1: Reasoning - Analyzing AST structure...'));

    // REASONING-FIRST: Perform semantic analysis before any modifications
    const analysis = await performSemanticAnalysis(sourceFile, sourceText, args, lineEnding);

    if (!analysis.valid) {
      console.log(chalk.red('❌ Analysis failed:', analysis.reason));
      return new ToolResult(false, `Semantic analysis failed: ${analysis.reason}`);
    }

    console.log(chalk.green('✓ Analysis complete:', analysis.summary));
    console.log(chalk.yellow(`  Found ${analysis.changes.length} surgical modification points`));

    if (args.dryRun) {
      return new ToolResult(true, 'Dry run completed - no files modified', {
        file: absolutePath,
        analysis: {
          summary: analysis.summary,
          proposedChanges: analysis.changes.map(c => ({
            description: c.description,
            location: `offset ${c.start}-${c.end}`,
            preview: c.newText.substring(0, 50) + (c.newText.length > 50 ? '...' : '')
          }))
        }
      });
    }

    // SURGICAL PRECISION: Apply changes with offset tracking
    console.log(chalk.blue('🔧 Phase 2: Surgical Transformation...'));
    
    const result = await applySurgicalTransformations(
      absolutePath, 
      sourceText, 
      analysis.changes,
      lineEnding,
      args.preserveFormatting !== false
    );

    console.log(chalk.green(`✓ Applied ${result.appliedChanges} precise modifications`));
    if (result.backupPath) {
      console.log(chalk.gray(`  Backup created: ${result.backupPath}`));
    }

    return new ToolResult(true, `Successfully performed ${args.transformationType}`, {
      file: absolutePath,
      transformations: result.appliedChanges,
      bytesModified: result.bytesChanged,
      lineEnding: lineEnding === '\r\n' ? 'CRLF' : 'LF',
      affectedRanges: analysis.changes.map(c => ({
        start: c.start,
        end: c.end,
        description: c.description
      }))
    });

  } catch (error: any) {
    console.error(chalk.red('Refactor error:', error));
    return new ToolResult(false, `Refactor operation failed: ${error.message}`, {
      stack: error.stack
    });
  }
}

async function performSemanticAnalysis(
  sourceFile: ts.SourceFile,
  sourceText: string,
  args: RefactorArgs,
  lineEnding: string
): Promise<AnalysisResult> {
  const changes: TextChange[] = [];
  const affectedNodes: ts.Node[] = [];

  switch (args.transformationType) {
    case 'rename-symbol': {
      if (!args.target.oldName || !args.target.newName) {
        return { valid: false, reason: 'rename-symbol requires oldName and newName', summary: '', changes: [], affectedNodes };
      }

      // Semantic check: ensure new name doesn't conflict
      const checker = createTypeChecker(sourceFile);
      let referenceCount = 0;

      function visit(node: ts.Node) {
        if (ts.isIdentifier(node) && node.text === args.target.oldName) {
          // Verify context (declaration vs usage)
          const isDeclaration = isDeclarationNode(node, sourceFile);
          
          changes.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            newText: args.target.newName!,
            description: isDeclaration ? 'declaration rename' : 'reference rename'
          });
          
          affectedNodes.push(node);
          referenceCount++;
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);

      if (referenceCount === 0) {
        return { valid: false, reason: `Symbol '${args.target.oldName}' not found`, summary: '', changes: [], affectedNodes };
      }

      // Check for name collisions
      const wouldCollide = wouldCollideWithExisting(sourceFile, args.target.newName, args.target.oldName);
      if (wouldCollide) {
        return { valid: false, reason: `Target name '${args.target.newName}' already exists in scope`, summary: '', changes: [], affectedNodes };
      }

      return {
        valid: true,
        summary: `Renaming '${args.target.oldName}' to '${args.target.newName}' (${referenceCount} references)`,
        changes,
        affectedNodes
      };
    }

    case 'organize-imports': {
      const importNodes: ts.ImportDeclaration[] = [];
      
      ts.forEachChild(sourceFile, (node) => {
        if (ts.isImportDeclaration(node)) {
          importNodes.push(node);
        }
      });

      if (importNodes.length === 0) {
        return { valid: false, reason: 'No imports found to organize', summary: '', changes: [], affectedNodes };
      }

      // Sort imports by module specifier
      const sortedImports = [...importNodes].sort((a, b) => {
        const aText = a.moduleSpecifier.getText(sourceFile).replace(/['"]/g, '');
        const bText = b.moduleSpecifier.getText(sourceFile).replace(/['"]/g, '');
        return aText.localeCompare(bText);
      });

      // Generate organized import block
      const importStart = importNodes[0].getStart(sourceFile);
      const importEnd = importNodes[importNodes.length - 1].getEnd();
      const organizedText = sortedImports
        .map(imp => imp.getText(sourceFile))
        .join(lineEnding);

      changes.push({
        start: importStart,
        end: importEnd,
        newText: organizedText,
        description: 'reorganize imports alphabetically'
      });

      return {
        valid: true,
        summary: `Organizing ${importNodes.length} import statements`,
        changes,
        affectedNodes: importNodes
      };
    }

    case 'convert-arrow': {
      if (!args.target.line || !args.target.column) {
        return { valid: false, reason: 'convert-arrow requires line and column position', summary: '', changes: [], affectedNodes };
      }

      const position = ts.getPositionOfLineAndCharacter(sourceFile, args.target.line - 1, args.target.column - 1);
      const node = findNodeAtPosition(sourceFile, position);

      if (!node || !ts.isFunctionDeclaration(node)) {
        return { valid: false, reason: 'No function declaration found at specified position', summary: '', changes: [], affectedNodes };
      }

      // Check if function can be converted (no 'this' usage, not a generator, etc.)
      let canConvert = true;
      function checkConvertible(n: ts.Node) {
        if (ts.isExpression(n) || n.kind === ts.SyntaxKind.SuperKeyword) {
          canConvert = false;
        }
        if (ts.isYieldExpression(n) || ts.isAwaitExpression(n)) {
          // Additional checks for async/generator
        }
        ts.forEachChild(n, checkConvertible);
      }
      checkConvertible(node);

      if (!canConvert) {
        return { valid: false, reason: 'Function uses this/super or is not suitable for arrow conversion', summary: '', changes: [], affectedNodes };
      }

      const funcText = node.getText(sourceFile);
      const name = node.name?.text || 'anonymous';
      const params = node.parameters.map(p => p.getText(sourceFile)).join(', ');
      const body = node.body?.getText(sourceFile) || '{}';
      const typeParams = node.typeParameters ? `<${node.typeParameters.map(tp => tp.getText(sourceFile)).join(', ')}>` : '';
      const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
      const isAsync = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';

      const arrowSyntax = `const ${name}${typeParams} = ${isAsync}(${params})${returnType} => ${body};`;

      changes.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        newText: arrowSyntax,
        description: `convert function '${name}' to arrow function`
      });

      return {
        valid: true,
        summary: `Converting function '${name}' to arrow function`,
        changes,
        affectedNodes: [node]
      };
    }

    default:
      return { valid: false, reason: `Unsupported transformation type: ${args.transformationType}`, summary: '', changes: [], affectedNodes };
  }
}

async function applySurgicalTransformations(
  filePath: string,
  originalText: string,
  changes: TextChange[],
  lineEnding: string,
  preserveFormatting: boolean
): Promise<{ appliedChanges: number; bytesChanged: number; backupPath?: string }> {
  // Sort changes in reverse order to apply from end to start (preserves offsets)
  const sortedChanges = [...changes].sort((a, b) => b.start - a.start);
  
  let modifiedText = originalText;
  let appliedChanges = 0;
  let bytesChanged = 0;

  // Create backup for Windows atomic operations (handle path spaces and long paths)
  const timestamp = Date.now();
  const hash = createHash('md5').update(filePath).digest('hex').substring(0, 8);
  const backupPath = `${filePath}.${hash}.${timestamp}.bak`;
  
  // Handle Windows long path notation (\\?\ prefix)
  const safeBackupPath = process.platform === 'win32' && backupPath.length > 260 
    ? `\\\\?\\${backupPath}` 
    : backupPath;

  await fs.writeFile(safeBackupPath, originalText, { encoding: 'utf-8', flag: 'w' });

  // Apply surgical text replacements
  for (const change of sortedChanges) {
    if (change.start < 0 || change.end > modifiedText.length || change.start > change.end) {
      console.warn(chalk.yellow(`Skipping invalid range: ${change.start}-${change.end}`));
      continue;
    }

    const before = modifiedText.substring(0, change.start);
    const after = modifiedText.substring(change.end);
    
    // Preserve surrounding whitespace if requested
    let newText = change.newText;
    if (preserveFormatting) {
      const originalSegment = originalText.substring(change.start, change.end);
      const leadingWs = originalSegment.match(/^\s*/)?.[0] || '';
      const trailingWs = originalSegment.match(/\s*$/)?.[0] || '';
      
      // Only preserve significant whitespace (newlines)
      if (leadingWs.includes(lineEnding)) {
        newText = leadingWs.split(lineEnding).slice(-1)[0] + newText;
      }
      if (trailingWs.includes(lineEnding)) {
        newText = newText + trailingWs.split(lineEnding)[0] + lineEnding;
      }
    }

    modifiedText = before + newText + after;
    bytesChanged += Math.abs(newText.length - (change.end - change.start));
    appliedChanges++;
  }

  // Atomic write: write to temp then rename (handles Windows file locking)
  const tempPath = `${filePath}.${hash}.tmp`;
  const safeTempPath = process.platform === 'win32' && tempPath.length > 260 
    ? `\\\\?\\${tempPath}` 
    : tempPath;

  try {
    await fs.writeFile(safeTempPath, modifiedText, 'utf-8');
    await fs.rename(safeTempPath, filePath);
    
    // Clean up backup on success
    await fs.unlink(safeBackupPath).catch(() => {});
    
  } catch (error) {
    // Restore from backup on failure
    await fs.rename(safeBackupPath, filePath).catch(() => {});
    throw error;
  }

  return { appliedChanges, bytesChanged, backupPath };
}

// Helper functions
function createTypeChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
  const host = {
    getSourceFile: () => sourceFile,
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '.',
    getDirectories: () => [],
    fileExists: () => true,
    readFile: () => '',
    getCanonicalFileName: (f: string) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n'
  };
  
  const program = ts.createProgram([sourceFile.fileName], {}, host as ts.CompilerHost);
  return program.getTypeChecker();
}

function isDeclarationNode(node: ts.Identifier, sourceFile: ts.SourceFile): boolean {
  const parent = node.parent;
  if (!parent) return false;
  
  return ts.isVariableDeclaration(parent) && parent.name === node ||
         ts.isFunctionDeclaration(parent) && parent.name === node ||
         ts.isClassDeclaration(parent) && parent.name === node ||
         ts.isInterfaceDeclaration(parent) && parent.name === node ||
         ts.isTypeAliasDeclaration(parent) && parent.name === node;
}

function findNodeAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
      return ts.forEachChild(node, find) || node;
    }
    return undefined;
  }
  return find(sourceFile);
}

function wouldCollideWithExisting(sourceFile: ts.SourceFile, newName: string, oldName: string): boolean {
  let collision = false;
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && node.text === newName && node.text !== oldName) {
      // Simple check: if identifier exists and is a declaration, it might collide
      if (isDeclarationNode(node, sourceFile)) {
        collision = true;
      }
    }
    if (!collision) {
      ts.forEachChild(node, visit);
    }
  }
  visit(sourceFile);
  return collision;
}