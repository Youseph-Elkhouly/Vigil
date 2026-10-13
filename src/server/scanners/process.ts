import { spawn } from "node:child_process";

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
  timedOut: boolean;
  outputTruncated: boolean;
}

/** Spawn a command without a shell and retain only a bounded amount of output. */
export function runProcess(
  command: string,
  args: readonly string[],
  options: { timeoutMs?: number; outputLimit?: number } = {},
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;

  return new Promise((resolve) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let outputTruncated = false;
    let timedOut = false;
    let spawnError: NodeJS.ErrnoException | null = null;
    let settled = false;

    const child = spawn(command, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const append = (current: Buffer, chunk: Buffer | string): Buffer => {
      if (current.length >= outputLimit) {
        outputTruncated = true;
        return current;
      }
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = outputLimit - current.length;
      if (value.length > remaining) outputTruncated = true;
      return Buffer.concat([current, value.subarray(0, remaining)]);
    };

    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on("error", (error: NodeJS.ErrnoException) => { spawnError = error; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        error: spawnError,
        timedOut,
        outputTruncated,
      });
    });
  });
}

/** Remove terminal control characters and prevent untrusted tool output flooding UI/logs. */
export function safeText(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, maxLength);
}

export function processError(result: ProcessResult, fallback: string): string {
  if (result.error?.code === "ENOENT") return "Executable was not found on PATH";
  if (result.timedOut) return "Command timed out";
  return safeText(result.stderr || result.error?.message || fallback);
}
