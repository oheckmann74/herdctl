/**
 * herdctl agent commands
 *
 * Commands for managing installed agents:
 * - herdctl agent add <source>  Install an agent from GitHub or local path
 *
 * The add command orchestrates the full agent installation flow:
 * 1. Parse source specifier (github:user/repo[@ref] or ./local/path)
 * 2. Fetch repository to temp directory
 * 3. Validate agent repository structure
 * 4. Install files to ./agents/<name>/
 * 5. Update herdctl.yaml with agent reference
 * 6. Scan and display required environment variables
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AGENT_ALREADY_EXISTS,
  AgentInstallError,
  // Fleet config update
  addAgentToFleetConfig,
  type EnvScanResult,
  type FetchSource,
  FleetConfigError,
  // Repository fetching
  fetchRepository,
  GitHubCloneAuthError,
  GitHubRepoNotFoundError,
  type InstallationSource,
  // File installation
  installAgentFiles,
  isGitHubSource,
  isLocalSource,
  isRegistrySource,
  LocalPathError,
  NetworkError,
  // Source parsing
  parseSourceSpecifier,
  RegistryNotImplementedError,
  RepositoryFetchError,
  SourceParseError,
  type SourceSpecifier,
  // Environment variable scanning
  scanEnvVariables,
  stringifySourceSpecifier,
  type ValidationResult,
  // Repository validation
  validateRepository,
} from "@herdctl/core";

// =============================================================================
// Types
// =============================================================================

export interface AgentAddOptions {
  /** Override the target installation directory */
  path?: string;
  /** Show what would happen without making changes */
  dryRun?: boolean;
  /** Overwrite existing agent directory */
  force?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a parsed SourceSpecifier to a FetchSource for the repository fetcher
 */
function toFetchSource(specifier: SourceSpecifier): FetchSource {
  if (isGitHubSource(specifier)) {
    return {
      type: "github",
      owner: specifier.owner,
      repo: specifier.repo,
      ref: specifier.ref,
    };
  }

  if (isLocalSource(specifier)) {
    return {
      type: "local",
      path: specifier.path,
    };
  }

  if (isRegistrySource(specifier)) {
    return {
      type: "registry",
      name: specifier.name,
    };
  }

  // TypeScript exhaustiveness check
  const _exhaustive: never = specifier;
  throw new Error(`Unknown source type: ${(_exhaustive as SourceSpecifier).type}`);
}

/**
 * Convert a parsed SourceSpecifier to an InstallationSource for metadata tracking
 */
function toInstallationSource(specifier: SourceSpecifier): InstallationSource {
  if (isGitHubSource(specifier)) {
    return {
      type: "github",
      url: `https://github.com/${specifier.owner}/${specifier.repo}`,
      ref: specifier.ref,
    };
  }

  if (isLocalSource(specifier)) {
    return {
      type: "local",
      url: specifier.path,
    };
  }

  if (isRegistrySource(specifier)) {
    return {
      type: "registry",
      url: specifier.name,
    };
  }

  // TypeScript exhaustiveness check
  const _exhaustive: never = specifier;
  throw new Error(`Unknown source type: ${(_exhaustive as SourceSpecifier).type}`);
}

/**
 * Print validation errors in a user-friendly format
 */
function printValidationErrors(result: ValidationResult): void {
  if (result.errors.length > 0) {
    console.log("");
    console.log("Validation errors:");
    for (const error of result.errors) {
      const pathInfo = error.path ? ` (${error.path})` : "";
      console.log(`  - ${error.message}${pathInfo}`);
    }
  }
}

/**
 * Print validation warnings in a user-friendly format
 */
function printValidationWarnings(result: ValidationResult): void {
  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of result.warnings) {
      const pathInfo = warning.path ? ` (${warning.path})` : "";
      console.log(`  - ${warning.message}${pathInfo}`);
    }
  }
}

/**
 * Print environment variables summary
 */
function printEnvVariables(envResult: EnvScanResult): void {
  if (envResult.variables.length === 0) {
    return;
  }

  console.log("");
  console.log("Environment variables to configure:");

  if (envResult.required.length > 0) {
    console.log("  Required (no defaults):");
    for (const variable of envResult.required) {
      console.log(`    ${variable.name}`);
    }
  }

  if (envResult.optional.length > 0) {
    console.log("");
    console.log("  Optional (have defaults):");
    for (const variable of envResult.optional) {
      console.log(`    ${variable.name} (default: ${variable.defaultValue})`);
    }
  }

  console.log("");
  console.log("Add these to your .env file, then run: herdctl start");
}

/**
 * Handle known error types and print user-friendly messages
 * Returns true if the error was handled, false otherwise
 */
function handleKnownError(error: unknown): boolean {
  if (error instanceof SourceParseError) {
    console.error(`Invalid source: ${error.message}`);
    return true;
  }

  if (error instanceof GitHubCloneAuthError) {
    console.error(`Authentication failed: ${error.message}`);
    return true;
  }

  if (error instanceof GitHubRepoNotFoundError) {
    console.error(`Repository not found: ${error.message}`);
    return true;
  }

  if (error instanceof NetworkError) {
    console.error(`Network error: ${error.message}`);
    return true;
  }

  if (error instanceof LocalPathError) {
    console.error(`Local path error: ${error.message}`);
    return true;
  }

  if (error instanceof RegistryNotImplementedError) {
    console.error(`Registry not available: ${error.message}`);
    return true;
  }

  if (error instanceof RepositoryFetchError) {
    console.error(`Failed to fetch: ${error.message}`);
    return true;
  }

  if (error instanceof AgentInstallError) {
    if (error.code === AGENT_ALREADY_EXISTS) {
      console.error(`Installation failed: ${error.message}`);
      console.error("Use --force to overwrite the existing agent.");
    } else {
      console.error(`Installation failed: ${error.message}`);
    }
    return true;
  }

  if (error instanceof FleetConfigError) {
    console.error(`Config update failed: ${error.message}`);
    return true;
  }

  return false;
}

// =============================================================================
// Main Command
// =============================================================================

/**
 * Install an agent from a source specifier
 *
 * Orchestrates the full installation flow:
 * 1. Parse source specifier
 * 2. Fetch repository
 * 3. Validate repository
 * 4. Install files (unless dry-run)
 * 5. Update fleet config (unless dry-run)
 * 6. Scan and display env variables
 * 7. Cleanup temp directory
 *
 * @param source - Source specifier (e.g., "github:user/repo", "./local/path")
 * @param options - Command options
 */
export async function agentAddCommand(source: string, options: AgentAddOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "herdctl.yaml");
  const { dryRun, force, path: customPath } = options;

  // Determine target base directory
  const targetBaseDir = customPath ? path.dirname(path.resolve(customPath)) : cwd;
  const targetPath = customPath ? path.resolve(customPath) : undefined;

  // ==========================================================================
  // Step 1: Parse source specifier
  // ==========================================================================
  let specifier: SourceSpecifier;
  try {
    specifier = parseSourceSpecifier(source);
  } catch (error) {
    handleKnownError(error);
    process.exit(1);
  }

  const sourceStr = stringifySourceSpecifier(specifier);
  console.log(`Fetching ${sourceStr}...`);

  // ==========================================================================
  // Step 2: Fetch repository
  // ==========================================================================
  let fetchResult: Awaited<ReturnType<typeof fetchRepository>> | undefined;

  try {
    const fetchSource = toFetchSource(specifier);
    fetchResult = await fetchRepository(fetchSource);
  } catch (error) {
    handleKnownError(error);
    process.exit(1);
  }

  // Ensure cleanup happens even on errors
  try {
    // ==========================================================================
    // Step 3: Validate repository
    // ==========================================================================
    console.log("Validating agent repository...");

    const validationResult = await validateRepository(fetchResult.path);

    // Print warnings regardless of validation result
    printValidationWarnings(validationResult);

    // If there are errors, print them and exit
    if (!validationResult.valid) {
      printValidationErrors(validationResult);
      console.log("");
      console.error("Validation failed. Cannot install agent.");
      process.exit(1);
    }

    const agentName = validationResult.agentName!;

    // ==========================================================================
    // Step 4: Install files (or describe what would happen)
    // ==========================================================================
    const installSource = toInstallationSource(specifier);
    const effectiveTargetPath = targetPath ?? path.join(cwd, "agents", agentName);
    const relativeInstallPath = path.relative(cwd, effectiveTargetPath);

    if (dryRun) {
      console.log("");
      console.log("Dry run mode - no changes will be made.");
      console.log("");
      console.log(`Would install agent '${agentName}' to ${relativeInstallPath}/`);
      console.log("");
      console.log("Files that would be installed:");

      // List files that would be copied
      const filesToCopy = await listFilesRecursive(fetchResult.path);
      for (const file of filesToCopy) {
        console.log(`  ${relativeInstallPath}/${file}`);
      }
      console.log(`  ${relativeInstallPath}/workspace/ (created)`);

      console.log("");
      console.log("Config changes:");
      console.log(`  herdctl.yaml (would add agent reference)`);
    } else {
      console.log(`Installing agent '${agentName}' to ${relativeInstallPath}/...`);

      const installResult = await installAgentFiles({
        sourceDir: fetchResult.path,
        targetBaseDir,
        source: installSource,
        targetPath,
        force,
      });

      // ==========================================================================
      // Step 5: Update fleet config
      // ==========================================================================
      console.log("Updating herdctl.yaml...");

      // Determine the relative path to the agent.yaml for the fleet config
      const agentYamlPath = `./${path.relative(cwd, path.join(installResult.installPath, "agent.yaml"))}`;

      await addAgentToFleetConfig({
        configPath,
        agentPath: agentYamlPath,
      });

      // ==========================================================================
      // Step 6: Scan environment variables
      // ==========================================================================
      const agentYamlFullPath = path.join(installResult.installPath, "agent.yaml");
      const agentYamlContent = fs.readFileSync(agentYamlFullPath, "utf-8");
      const envResult = scanEnvVariables(agentYamlContent);

      // ==========================================================================
      // Print success summary
      // ==========================================================================
      console.log("");
      console.log(`Agent '${agentName}' installed successfully!`);
      console.log("");
      console.log("Files installed:");
      for (const file of installResult.copiedFiles) {
        console.log(`  ${relativeInstallPath}/${file}`);
      }
      console.log(`  ${relativeInstallPath}/workspace/ (created)`);

      console.log("");
      console.log("Config updated:");
      console.log("  herdctl.yaml (added agent reference)");

      printEnvVariables(envResult);
    }
  } catch (error) {
    // Handle known errors from validation, installation, or config update
    if (handleKnownError(error)) {
      process.exit(1);
    }
    // Re-throw unknown errors
    throw error;
  } finally {
    // ==========================================================================
    // Step 7: Cleanup temp directory
    // ==========================================================================
    if (fetchResult) {
      await fetchResult.cleanup();
    }
  }
}

/**
 * Recursively list files in a directory (excluding .git and node_modules)
 */
async function listFilesRecursive(dir: string, relativePath: string = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const excludedDirs = new Set([".git", "node_modules"]);

  for (const entry of entries) {
    const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (!excludedDirs.has(entry.name)) {
        const subFiles = await listFilesRecursive(path.join(dir, entry.name), entryPath);
        files.push(...subFiles);
      }
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}
