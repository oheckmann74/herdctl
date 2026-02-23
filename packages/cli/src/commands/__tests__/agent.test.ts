import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @herdctl/core entirely
vi.mock("@herdctl/core", () => ({
  // Source parsing
  parseSourceSpecifier: vi.fn(),
  stringifySourceSpecifier: vi.fn(),
  SourceParseError: class SourceParseError extends Error {
    source: string;
    constructor(message: string, source: string) {
      super(message);
      this.name = "SourceParseError";
      this.source = source;
    }
  },
  isGitHubSource: vi.fn(),
  isLocalSource: vi.fn(),
  isRegistrySource: vi.fn(),

  // Repository fetching
  fetchRepository: vi.fn(),
  RepositoryFetchError: class RepositoryFetchError extends Error {
    source: unknown;
    cause?: Error;
    constructor(message: string, source: unknown, cause?: Error) {
      super(message);
      this.name = "RepositoryFetchError";
      this.source = source;
      this.cause = cause;
    }
  },
  GitHubCloneAuthError: class GitHubCloneAuthError extends Error {
    source: unknown;
    constructor(source: unknown, cause?: Error) {
      super("Auth failed");
      this.name = "GitHubCloneAuthError";
      this.source = source;
    }
  },
  GitHubRepoNotFoundError: class GitHubRepoNotFoundError extends Error {
    source: unknown;
    constructor(source: unknown, cause?: Error) {
      super("Repo not found");
      this.name = "GitHubRepoNotFoundError";
      this.source = source;
    }
  },
  NetworkError: class NetworkError extends Error {
    source: unknown;
    constructor(source: unknown, cause?: Error) {
      super("Network error");
      this.name = "NetworkError";
      this.source = source;
    }
  },
  LocalPathError: class LocalPathError extends Error {
    source: unknown;
    constructor(source: unknown, reason: string, cause?: Error) {
      super(reason);
      this.name = "LocalPathError";
      this.source = source;
    }
  },
  RegistryNotImplementedError: class RegistryNotImplementedError extends Error {
    source: unknown;
    constructor(source: unknown) {
      super("Registry not implemented");
      this.name = "RegistryNotImplementedError";
      this.source = source;
    }
  },

  // Repository validation
  validateRepository: vi.fn(),

  // File installation
  installAgentFiles: vi.fn(),
  AgentInstallError: class AgentInstallError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "AgentInstallError";
      this.code = code;
    }
  },
  AGENT_ALREADY_EXISTS: "AGENT_ALREADY_EXISTS",

  // Fleet config update
  addAgentToFleetConfig: vi.fn(),
  FleetConfigError: class FleetConfigError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "FleetConfigError";
      this.code = code;
    }
  },

  // Environment variable scanning
  scanEnvVariables: vi.fn(),
}));

import {
  AGENT_ALREADY_EXISTS,
  AgentInstallError,
  addAgentToFleetConfig,
  FleetConfigError,
  fetchRepository,
  GitHubCloneAuthError,
  GitHubRepoNotFoundError,
  installAgentFiles,
  isGitHubSource,
  isLocalSource,
  isRegistrySource,
  LocalPathError,
  NetworkError,
  parseSourceSpecifier,
  RegistryNotImplementedError,
  RepositoryFetchError,
  SourceParseError,
  scanEnvVariables,
  stringifySourceSpecifier,
  validateRepository,
} from "@herdctl/core";

import { agentAddCommand } from "../agent.js";

const mockedParseSourceSpecifier = vi.mocked(parseSourceSpecifier);
const mockedStringifySourceSpecifier = vi.mocked(stringifySourceSpecifier);
const mockedIsGitHubSource = vi.mocked(isGitHubSource);
const mockedIsLocalSource = vi.mocked(isLocalSource);
const mockedIsRegistrySource = vi.mocked(isRegistrySource);
const mockedFetchRepository = vi.mocked(fetchRepository);
const mockedValidateRepository = vi.mocked(validateRepository);
const mockedInstallAgentFiles = vi.mocked(installAgentFiles);
const mockedAddAgentToFleetConfig = vi.mocked(addAgentToFleetConfig);
const mockedScanEnvVariables = vi.mocked(scanEnvVariables);

function createTempDir(): string {
  const baseDir = path.join(
    tmpdir(),
    `herdctl-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.realpathSync(baseDir);
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Create a minimal agent repository structure in a temp directory */
function createMockAgentRepo(dir: string, agentName: string = "test-agent"): void {
  fs.writeFileSync(
    path.join(dir, "agent.yaml"),
    `name: ${agentName}
permission_mode: default
runtime: sdk
`,
    "utf-8",
  );
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Agent Instructions\n", "utf-8");
}

/** Create a minimal herdctl.yaml for tests */
function createFleetConfig(dir: string): void {
  fs.writeFileSync(
    path.join(dir, "herdctl.yaml"),
    `version: 1

fleet:
  name: test-fleet

agents: []
`,
    "utf-8",
  );
}

describe("agentAddCommand", () => {
  let tempDir: string;
  let fetchedRepoDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;
  let cleanupCalled: boolean;

  beforeEach(() => {
    tempDir = createTempDir();
    fetchedRepoDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);

    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    exitCode = undefined;
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    cleanupCalled = false;

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    cleanupTempDir(fetchedRepoDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  /** Set up default mocks for a successful GitHub installation */
  function setupSuccessfulGitHubMocks(agentName: string = "test-agent"): void {
    createFleetConfig(tempDir);
    createMockAgentRepo(fetchedRepoDir, agentName);

    mockedParseSourceSpecifier.mockReturnValue({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: "v1.0.0",
    });
    mockedStringifySourceSpecifier.mockReturnValue("github:user/repo@v1.0.0");
    mockedIsGitHubSource.mockReturnValue(true);
    mockedIsLocalSource.mockReturnValue(false);
    mockedIsRegistrySource.mockReturnValue(false);

    mockedFetchRepository.mockResolvedValue({
      path: fetchedRepoDir,
      cleanup: async () => {
        cleanupCalled = true;
      },
    });

    mockedValidateRepository.mockResolvedValue({
      valid: true,
      agentName,
      agentConfig: { name: agentName, permission_mode: "default", runtime: "sdk" },
      repoMetadata: null,
      errors: [],
      warnings: [],
    });

    const installPath = path.join(tempDir, "agents", agentName);
    mockedInstallAgentFiles.mockResolvedValue({
      agentName,
      installPath,
      copiedFiles: ["agent.yaml", "CLAUDE.md"],
    });

    // Create the installed files so scanEnvVariables can read them
    fs.mkdirSync(path.join(tempDir, "agents", agentName), { recursive: true });
    fs.copyFileSync(
      path.join(fetchedRepoDir, "agent.yaml"),
      path.join(tempDir, "agents", agentName, "agent.yaml"),
    );

    mockedAddAgentToFleetConfig.mockResolvedValue({
      modified: true,
      agentPath: `./agents/${agentName}/agent.yaml`,
      alreadyExists: false,
    });

    mockedScanEnvVariables.mockReturnValue({
      variables: [],
      required: [],
      optional: [],
    });
  }

  /** Set up default mocks for a successful local installation */
  function setupSuccessfulLocalMocks(agentName: string = "local-agent"): void {
    createFleetConfig(tempDir);
    createMockAgentRepo(fetchedRepoDir, agentName);

    mockedParseSourceSpecifier.mockReturnValue({
      type: "local",
      path: fetchedRepoDir,
    });
    mockedStringifySourceSpecifier.mockReturnValue(fetchedRepoDir);
    mockedIsGitHubSource.mockReturnValue(false);
    mockedIsLocalSource.mockReturnValue(true);
    mockedIsRegistrySource.mockReturnValue(false);

    mockedFetchRepository.mockResolvedValue({
      path: fetchedRepoDir,
      cleanup: async () => {
        cleanupCalled = true;
      },
    });

    mockedValidateRepository.mockResolvedValue({
      valid: true,
      agentName,
      agentConfig: { name: agentName, permission_mode: "default", runtime: "sdk" },
      repoMetadata: null,
      errors: [],
      warnings: [],
    });

    const installPath = path.join(tempDir, "agents", agentName);
    mockedInstallAgentFiles.mockResolvedValue({
      agentName,
      installPath,
      copiedFiles: ["agent.yaml", "CLAUDE.md"],
    });

    // Create the installed files so scanEnvVariables can read them
    fs.mkdirSync(path.join(tempDir, "agents", agentName), { recursive: true });
    fs.copyFileSync(
      path.join(fetchedRepoDir, "agent.yaml"),
      path.join(tempDir, "agents", agentName, "agent.yaml"),
    );

    mockedAddAgentToFleetConfig.mockResolvedValue({
      modified: true,
      agentPath: `./agents/${agentName}/agent.yaml`,
      alreadyExists: false,
    });

    mockedScanEnvVariables.mockReturnValue({
      variables: [],
      required: [],
      optional: [],
    });
  }

  describe("successful installation from GitHub", () => {
    it("installs an agent from GitHub source", async () => {
      setupSuccessfulGitHubMocks("my-agent");

      await agentAddCommand("github:user/repo@v1.0.0", {});

      expect(mockedParseSourceSpecifier).toHaveBeenCalledWith("github:user/repo@v1.0.0");
      expect(mockedFetchRepository).toHaveBeenCalled();
      expect(mockedValidateRepository).toHaveBeenCalledWith(fetchedRepoDir);
      expect(mockedInstallAgentFiles).toHaveBeenCalled();
      expect(mockedAddAgentToFleetConfig).toHaveBeenCalled();
      expect(consoleLogs.some((log) => log.includes("installed successfully"))).toBe(true);
    });

    it("calls cleanup even after successful installation", async () => {
      setupSuccessfulGitHubMocks();

      await agentAddCommand("github:user/repo", {});

      expect(cleanupCalled).toBe(true);
    });
  });

  describe("successful installation from local path", () => {
    it("installs an agent from local path", async () => {
      setupSuccessfulLocalMocks("local-agent");

      await agentAddCommand("./local/path", {});

      expect(mockedParseSourceSpecifier).toHaveBeenCalledWith("./local/path");
      expect(mockedFetchRepository).toHaveBeenCalled();
      expect(mockedValidateRepository).toHaveBeenCalled();
      expect(mockedInstallAgentFiles).toHaveBeenCalled();
      expect(mockedAddAgentToFleetConfig).toHaveBeenCalled();
      expect(consoleLogs.some((log) => log.includes("installed successfully"))).toBe(true);
    });
  });

  describe("dry run mode", () => {
    it("does not modify files in dry run mode", async () => {
      setupSuccessfulGitHubMocks("dry-run-agent");

      await agentAddCommand("github:user/repo", { dryRun: true });

      // Should parse and fetch
      expect(mockedParseSourceSpecifier).toHaveBeenCalled();
      expect(mockedFetchRepository).toHaveBeenCalled();
      expect(mockedValidateRepository).toHaveBeenCalled();

      // Should NOT install or update config
      expect(mockedInstallAgentFiles).not.toHaveBeenCalled();
      expect(mockedAddAgentToFleetConfig).not.toHaveBeenCalled();

      // Should print dry run message
      expect(consoleLogs.some((log) => log.includes("Dry run mode"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Would install"))).toBe(true);
    });

    it("still calls cleanup in dry run mode", async () => {
      setupSuccessfulGitHubMocks();

      await agentAddCommand("github:user/repo", { dryRun: true });

      expect(cleanupCalled).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles SourceParseError gracefully", async () => {
      mockedParseSourceSpecifier.mockImplementation(() => {
        throw new SourceParseError("Invalid source format", "bad-source");
      });

      await expect(agentAddCommand("bad-source", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Invalid source"))).toBe(true);
    });

    it("handles RepositoryFetchError gracefully", async () => {
      createFleetConfig(tempDir);
      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);
      mockedIsRegistrySource.mockReturnValue(false);

      mockedFetchRepository.mockRejectedValue(
        new RepositoryFetchError("Clone failed", { type: "github", owner: "user", repo: "repo" }),
      );

      await expect(agentAddCommand("github:user/repo", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Failed to fetch"))).toBe(true);
    });

    it("handles GitHubCloneAuthError gracefully", async () => {
      createFleetConfig(tempDir);
      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "private-repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/private-repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);
      mockedIsRegistrySource.mockReturnValue(false);

      mockedFetchRepository.mockRejectedValue(
        new GitHubCloneAuthError({ type: "github", owner: "user", repo: "private-repo" }),
      );

      await expect(agentAddCommand("github:user/private-repo", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Authentication failed"))).toBe(true);
    });

    it("handles GitHubRepoNotFoundError gracefully", async () => {
      createFleetConfig(tempDir);
      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "nonexistent",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/nonexistent");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);
      mockedIsRegistrySource.mockReturnValue(false);

      mockedFetchRepository.mockRejectedValue(
        new GitHubRepoNotFoundError({ type: "github", owner: "user", repo: "nonexistent" }),
      );

      await expect(agentAddCommand("github:user/nonexistent", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Repository not found"))).toBe(true);
    });

    it("handles AgentInstallError (already exists)", async () => {
      createFleetConfig(tempDir);
      createMockAgentRepo(fetchedRepoDir, "existing-agent");

      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);
      mockedIsRegistrySource.mockReturnValue(false);

      mockedFetchRepository.mockResolvedValue({
        path: fetchedRepoDir,
        cleanup: async () => {
          cleanupCalled = true;
        },
      });

      mockedValidateRepository.mockResolvedValue({
        valid: true,
        agentName: "existing-agent",
        agentConfig: { name: "existing-agent", permission_mode: "default", runtime: "sdk" },
        repoMetadata: null,
        errors: [],
        warnings: [],
      });

      mockedInstallAgentFiles.mockRejectedValue(
        new AgentInstallError("Agent already exists", AGENT_ALREADY_EXISTS),
      );

      await expect(agentAddCommand("github:user/repo", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Installation failed"))).toBe(true);
      expect(consoleErrors.some((e) => e.includes("--force"))).toBe(true);
      expect(cleanupCalled).toBe(true);
    });

    it("handles validation errors (stops installation)", async () => {
      createFleetConfig(tempDir);
      createMockAgentRepo(fetchedRepoDir, "invalid-agent");

      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);
      mockedIsRegistrySource.mockReturnValue(false);

      mockedFetchRepository.mockResolvedValue({
        path: fetchedRepoDir,
        cleanup: async () => {
          cleanupCalled = true;
        },
      });

      mockedValidateRepository.mockResolvedValue({
        valid: false,
        agentName: null,
        agentConfig: null,
        repoMetadata: null,
        errors: [
          { code: "MISSING_AGENT_YAML", message: "agent.yaml not found", path: "agent.yaml" },
        ],
        warnings: [],
      });

      await expect(agentAddCommand("github:user/repo", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Validation failed"))).toBe(true);
      expect(mockedInstallAgentFiles).not.toHaveBeenCalled();
      expect(cleanupCalled).toBe(true);
    });

    it("handles validation warnings (continues installation)", async () => {
      setupSuccessfulGitHubMocks("warning-agent");

      mockedValidateRepository.mockResolvedValue({
        valid: true,
        agentName: "warning-agent",
        agentConfig: { name: "warning-agent", permission_mode: "default", runtime: "sdk" },
        repoMetadata: null,
        errors: [],
        warnings: [
          { code: "MISSING_README", message: "No README.md found", path: "README.md" },
          { code: "MISSING_CLAUDE_MD", message: "No CLAUDE.md found", path: "CLAUDE.md" },
        ],
      });

      await agentAddCommand("github:user/repo", {});

      // Should print warnings
      expect(consoleLogs.some((log) => log.includes("Warnings"))).toBe(true);

      // But should still install
      expect(mockedInstallAgentFiles).toHaveBeenCalled();
      expect(consoleLogs.some((log) => log.includes("installed successfully"))).toBe(true);
    });

    it("calls cleanup even on errors", async () => {
      createFleetConfig(tempDir);
      createMockAgentRepo(fetchedRepoDir, "error-agent");

      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);
      mockedIsRegistrySource.mockReturnValue(false);

      mockedFetchRepository.mockResolvedValue({
        path: fetchedRepoDir,
        cleanup: async () => {
          cleanupCalled = true;
        },
      });

      mockedValidateRepository.mockRejectedValue(new Error("Unexpected error"));

      await expect(agentAddCommand("github:user/repo", {})).rejects.toThrow("Unexpected error");

      expect(cleanupCalled).toBe(true);
    });

    it("handles FleetConfigError gracefully", async () => {
      setupSuccessfulGitHubMocks("config-error-agent");

      mockedAddAgentToFleetConfig.mockRejectedValue(
        new FleetConfigError("Config not found", "CONFIG_NOT_FOUND"),
      );

      await expect(agentAddCommand("github:user/repo", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Config update failed"))).toBe(true);
      expect(cleanupCalled).toBe(true);
    });
  });

  describe("environment variables display", () => {
    it("displays required env vars correctly", async () => {
      setupSuccessfulGitHubMocks("env-agent");

      mockedScanEnvVariables.mockReturnValue({
        variables: [{ name: "DISCORD_WEBHOOK_URL" }, { name: "WEBSITES" }],
        required: [{ name: "DISCORD_WEBHOOK_URL" }, { name: "WEBSITES" }],
        optional: [],
      });

      await agentAddCommand("github:user/repo", {});

      expect(consoleLogs.some((log) => log.includes("Environment variables to configure"))).toBe(
        true,
      );
      expect(consoleLogs.some((log) => log.includes("Required (no defaults)"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("DISCORD_WEBHOOK_URL"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("WEBSITES"))).toBe(true);
    });

    it("displays optional env vars with defaults", async () => {
      setupSuccessfulGitHubMocks("env-agent");

      mockedScanEnvVariables.mockReturnValue({
        variables: [{ name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" }],
        required: [],
        optional: [{ name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" }],
      });

      await agentAddCommand("github:user/repo", {});

      expect(consoleLogs.some((log) => log.includes("Optional (have defaults)"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("CRON_SCHEDULE"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("*/5 * * * *"))).toBe(true);
    });

    it("does not display env section when no variables found", async () => {
      setupSuccessfulGitHubMocks("no-env-agent");

      mockedScanEnvVariables.mockReturnValue({
        variables: [],
        required: [],
        optional: [],
      });

      await agentAddCommand("github:user/repo", {});

      expect(consoleLogs.some((log) => log.includes("Environment variables to configure"))).toBe(
        false,
      );
    });
  });

  describe("force mode", () => {
    it("passes force option to installAgentFiles", async () => {
      setupSuccessfulGitHubMocks("force-agent");

      await agentAddCommand("github:user/repo", { force: true });

      expect(mockedInstallAgentFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          force: true,
        }),
      );
    });

    it("does not pass force when not specified", async () => {
      setupSuccessfulGitHubMocks("no-force-agent");

      await agentAddCommand("github:user/repo", {});

      expect(mockedInstallAgentFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          force: undefined,
        }),
      );
    });
  });

  describe("custom path option", () => {
    it("passes custom path to installAgentFiles", async () => {
      setupSuccessfulGitHubMocks("custom-path-agent");

      const customPath = path.join(tempDir, "custom", "location");

      await agentAddCommand("github:user/repo", { path: customPath });

      expect(mockedInstallAgentFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPath: customPath,
        }),
      );
    });
  });
});
