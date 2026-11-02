import { spawn } from "node:child_process";
import { mkdtemp, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchCommand, recipeError, type RestartRecipe } from "./restart-recipe";

export interface Launch {
  pid?: number;
  logPath: string;
  exited: boolean;
  exitCode: number | null;
  error?: Error;
}

export async function launchService(recipe: RestartRecipe, onExit: () => void): Promise<Launch> {
  const invalid = recipeError(recipe);
  if (invalid) throw new Error(invalid);
  const directory = await mkdtemp(path.join(os.tmpdir(), "port-station-"));
  const logPath = path.join(directory, "startup.log");
  const log = await open(logPath, "a", 0o600);
  try {
    await log.write(`[${new Date().toISOString()}] starting\n`);
    const { executable, args, cwd } = launchCommand(recipe);
    const child = spawn(executable, args, { cwd, detached: true, stdio: ["ignore", log.fd, log.fd] });
    const launch: Launch = { pid: child.pid, logPath, exited: false, exitCode: null };
    await new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        launch.error = error;
        launch.exited = true;
        onExit();
        reject(new Error(`启动失败：${error.message}。日志：${logPath}`));
      });
      child.once("exit", (code) => {
        launch.exited = true;
        launch.exitCode = code;
        onExit();
      });
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    return launch;
  } catch (error) {
    await log.write(`[${new Date().toISOString()}] ${error instanceof Error ? error.message : "启动失败"}\n`).catch(() => {});
    throw error;
  } finally {
    await log.close();
  }
}
