/**
 * Python Bridge
 *
 * Manages Python subprocess execution for backends that require
 * Python runtimes (CadQuery, SkiDL, etc.).
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_PYTHON = "python3";
const DEFAULT_TIMEOUT_MS = 30_000;
const SIGKILL_GRACE_MS = 3_000;

export interface PythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a Python script by piping it to a Python interpreter via stdin.
 *
 * @param script     The full Python source code to execute
 * @param pythonPath Optional path to the Python binary (defaults to "python3")
 * @returns          stdout, stderr, and exit code
 */
export async function runPython(
  script: string,
  pythonPath?: string,
): Promise<PythonResult> {
  const python = pythonPath ?? DEFAULT_PYTHON;

  return new Promise<PythonResult>((resolve, reject) => {
    const proc = spawn(python, ["-u", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // Enforce timeout: SIGTERM first, then SIGKILL after grace period
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      killTimer = setTimeout(() => {
        // Process did not exit after SIGTERM; force kill
        proc.kill("SIGKILL");
      }, SIGKILL_GRACE_MS);

      // Clean up any temp files left by the Python process
      cleanupTempFiles().catch(() => {});

      reject(
        new Error(
          `Python process timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`,
        ),
      );
    }, DEFAULT_TIMEOUT_MS);

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(new Error(`Failed to spawn Python (${python}): ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 1,
      });
    });

    // Pipe the script to stdin and close the stream
    proc.stdin.write(script);
    proc.stdin.end();
  });
}

/**
 * Clean up any temp files left behind by timed-out Python processes.
 * Removes files matching the meshforge-py-* pattern in the OS temp directory.
 */
async function cleanupTempFiles(): Promise<void> {
  const tmp = tmpdir();
  const entries = await readdir(tmp);
  const stale = entries.filter((e) => e.startsWith("meshforge-py-"));
  await Promise.all(
    stale.map((f) => unlink(join(tmp, f)).catch(() => {})),
  );
}

/**
 * Check whether a Python package is importable.
 *
 * @param pkg        The package name to check (e.g. "cadquery")
 * @param pythonPath Optional path to the Python binary
 * @returns          true if the package can be imported, false otherwise
 */
export async function checkPythonPackage(
  pkg: string,
  pythonPath?: string,
): Promise<boolean> {
  try {
    const result = await runPython(`import ${pkg}; print("ok")`, pythonPath);
    return result.exitCode === 0 && result.stdout.trim() === "ok";
  } catch {
    return false;
  }
}
