/**
 * Distribution module for herdctl
 *
 * Provides schemas and utilities for the agent distribution system:
 * - Agent repository metadata validation (herdctl.json)
 * - Installation metadata tracking (metadata.json)
 * - Source specifier parsing and repository fetching
 */

// Agent Repository Metadata (herdctl.json)
export {
  AGENT_NAME_PATTERN,
  type AgentRepoMetadata,
  AgentRepoMetadataSchema,
  type AgentRequires,
  AgentRequiresSchema,
} from "./agent-repo-metadata.js";

// Installation Metadata (metadata.json)
export {
  type InstallationMetadata,
  InstallationMetadataSchema,
  type InstallationSource,
  InstallationSourceSchema,
  ISO8601TimestampSchema,
  type SourceType,
  SourceTypeSchema,
} from "./installation-metadata.js";

// Repository Fetching
export {
  type FetchSource,
  fetchRepository,
  // Error classes
  GitHubCloneAuthError,
  type GitHubFetchSource,
  GitHubRepoNotFoundError,
  type LocalFetchSource,
  LocalPathError,
  NetworkError,
  type RegistryFetchSource,
  RegistryNotImplementedError,
  RepositoryFetchError,
  type RepositoryFetchResult,
} from "./repository-fetcher.js";
// Repository Validation
export {
  DOCKER_NETWORK_NONE,
  INVALID_AGENT_YAML,
  INVALID_HERDCTL_JSON,
  JSON_PARSE_ERROR,
  // Error codes
  MISSING_AGENT_YAML,
  MISSING_CLAUDE_MD,
  // Warning codes
  MISSING_HERDCTL_JSON,
  MISSING_README,
  NAME_MISMATCH,
  type ValidationMessage,
  type ValidationResult,
  validateRepository,
  YAML_PARSE_ERROR,
} from "./repository-validator.js";
// Source Specifier Parsing
export {
  type GitHubSource,
  isGitHubSource,
  isLocalSource,
  isRegistrySource,
  type LocalSource,
  parseSourceSpecifier,
  type RegistrySource,
  SourceParseError,
  type SourceSpecifier,
  stringifySourceSpecifier,
} from "./source-specifier.js";
