import { accessSync, constants, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type RestartRecipe =
  | { kind: "argv"; cwd: string; argv: string[] }
  | { kind: "script"; cwd: string; manager: PackageManager; script: string; args: string[] }
  | { kind: "app"; appPath: string };

function validPath(value: string): boolean {
  return path.isAbsolute(value) && value.length <= 4096 && !value.includes("\0");
}

export function recipeError(recipe: RestartRecipe): string | undefined {
  try {
    if (recipe.kind === "app") {
      if (!validPath(recipe.appPath) || !/\.app$/i.test(recipe.appPath) || !statSync(recipe.appPath).isDirectory()) {
        return "应用已不存在，无法自动重启";
      }
      return;
    }
    if (!validPath(recipe.cwd) || !statSync(recipe.cwd).isDirectory()) return "启动目录已不存在，无法自动重启";
    const args = recipe.kind === "argv" ? recipe.argv : recipe.args;
    if (!Array.isArray(args) || args.length > 128 || args.some((arg) => typeof arg !== "string" || arg.includes("\0") || arg.length > 4096)) {
      return "启动参数无法可靠恢复";
    }
    if (recipe.kind === "argv") {
      if (!args.length || !validPath(args[0]) || !statSync(args[0]).isFile()) return "可执行文件已不存在";
      accessSync(args[0], constants.X_OK);
    } else {
      if (!["npm", "pnpm", "yarn", "bun"].includes(recipe.manager) || !/^[\w@:.\/-]+$/.test(recipe.script) || recipe.script.startsWith("-")) {
        return "无法确认项目脚本";
      }
      const pkg = JSON.parse(readFileSync(path.join(recipe.cwd, "package.json"), "utf8"));
      if (typeof pkg.scripts?.[recipe.script] !== "string") return "项目脚本已不存在";
    }
  } catch {
    return "启动目录、可执行文件或项目脚本已不可用，请回到终端启动";
  }
}

export function launchCommand(recipe: RestartRecipe): { executable: string; args: string[]; cwd?: string } {
  if (recipe.kind === "app") return { executable: "/usr/bin/open", args: [recipe.appPath] };
  if (recipe.kind === "argv") return { executable: recipe.argv[0], args: recipe.argv.slice(1), cwd: recipe.cwd };
  return {
    executable: recipe.manager,
    args: ["run", recipe.script, ...(recipe.manager === "npm" && recipe.args.length ? ["--"] : []), ...recipe.args],
    cwd: recipe.cwd,
  };
}
