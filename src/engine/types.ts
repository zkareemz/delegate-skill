/**
 * delegate-skill · engine · types
 *
 * The seam between the target-agnostic relay engine and a per-target adapter.
 * Adding a new target (codex, claude, opencode, cursor, …) means writing ONE
 * Adapter — the engine never changes.
 */

export type Status = "completed" | "failed" | "target_unavailable";

/** Parsed CLI options for a single relay invocation. */
export interface RelayOptions {
  /** Path to the brief file; null means read the brief from stdin. */
  brief: string | null;
  /** Working root for the target (resolved absolute path). */
  cd: string;
  /** Model override; null = the target's own configured default. */
  model: string | null;
  /** Provider override; null = the target's own configured default. */
  provider: string | null;
  /** Session id to use/resume; null = the engine generates a fresh one. */
  sessionId: string | null;
  /** Continue an existing session (send only the delta brief). */
  resume: boolean;
  /** Allow running outside a git repository. */
  skipGitRepoCheck: boolean;
  /** Where run artifacts go; null = a fresh dir under the system temp dir. */
  outDir: string | null;
}

/** Everything an adapter needs about one resolved run. */
export interface RunContext {
  opts: RelayOptions;
  /** The resolved session id (generated or provided). */
  sessionId: string;
  /** The brief text actually sent. */
  briefText: string;
  outDir: string;
  eventsPath: string;
  briefPath: string;
  resultPath: string;
}

/**
 * A target adapter. Holds every target-specific mechanic; everything else
 * (spawning, capture, blocking, result.json, git, exit codes) is the engine.
 */
export interface Adapter {
  /** Target binary name, e.g. "pi". */
  readonly name: string;
  /** Args that print the target's version (used for the pre-flight check). */
  readonly versionArgv: string[];
  /** How the brief reaches the target: a final positional arg, or stdin. */
  readonly sendBrief: "argv" | "stdin";
  /** Build argv for a fresh dispatch (WITHOUT the brief payload). */
  buildArgv(ctx: RunContext): string[];
  /** Build argv to continue an existing session (WITHOUT the delta brief). */
  buildResumeArgv(ctx: RunContext): string[];
  /** Extract the target's final human-readable report from captured stdout. */
  parseFinalMessage(events: string): string;
  /** Extract a session id from captured stdout (null if not derivable). */
  parseSessionId(events: string): string | null;
}

/** The result.json contract — the orchestrator reads exactly this. */
export interface RelayResult {
  schema: "delegate-relay.result.v1";
  target: string;
  status: Status;
  exitCode: number;
  targetVersion: string | null;
  workdir: string;
  model: string | null;
  provider: string | null;
  /** The session id to resume later. */
  sessionId: string | null;
  resume: boolean;
  /** The target's own final report. */
  finalMessage: string;
  /** `git status --porcelain` lines; null when git can't report. */
  touchedFiles: string[] | null;
  /** True if the working tree already had changes before the run (muddy attribution). */
  dirtyBefore: boolean;
  briefPath: string;
  eventsPath: string;
  startedAt: string;
  finishedAt: string;
  /** Last stderr lines; present only on a failed run. */
  stderrTail?: string[];
  /** Present only if the target failed to launch. */
  error?: string;
}
