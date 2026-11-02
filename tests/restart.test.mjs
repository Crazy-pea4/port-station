import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createLoader, apiRequest, plain } from "./helpers.mjs";

async function project(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "port-station-test My Project-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  await fs.writeFile(path.join(cwd, "package.json"), JSON.stringify({ scripts: { dev: "node server.js" } }));
  return cwd;
}

test("结构化参数完整保留空格、空字符串及等号", async (t) => {
  const cwd = await project(t);
  const loader = createLoader();
  const { buildRestartRecipe } = loader.load("src/lib/restart.ts");
  const argv = [process.execPath, "/tmp/My Project/server.js", "hello world", "--port=4000", ""];
  const result = buildRestartRecipe({ command: argv.join(" "), cwd, argv });
  assert.deepEqual(plain(result.recipe.argv), argv);
  const { recipeError, launchCommand } = loader.load("src/lib/restart-recipe.ts");
  const script = { kind: "script", cwd, manager: "npm", script: "dev", args: ["--port=4000", "hello world", ""] };
  assert.equal(recipeError(script), undefined);
  assert.deepEqual(plain(launchCommand(script).args), ["run", "dev", "--", "--port=4000", "hello world", ""]);
});

test("无法恢复边界的 ps 文本不生成猜测配方", async (t) => {
  const cwd = await project(t);
  const { buildRestartRecipe } = createLoader().load("src/lib/restart.ts");
  for (const context of [
    { command: `${process.execPath} /tmp/My Project/server.js`, cwd },
    { command: "next-server", parentCommand: "npm run dev -- --port=4000", cwd },
  ]) {
    const result = buildRestartRecipe(context);
    assert.equal(result.recipe, undefined);
    assert.match(result.reason, /参数边界/);
  }
  assert.equal(buildRestartRecipe({ command: "next-server", parentCommand: "npm run dev", cwd }).recipe.kind, "script");
  await fs.writeFile(path.join(cwd, "package.json"), "{}");
  assert.equal(buildRestartRecipe({ command: "next-server", parentCommand: "npm run dev", cwd }).recipe, undefined);
});

test("工作目录失效时在 spawn 前返回明确错误", async () => {
  const loader = createLoader({ mocks: { "node:child_process": { spawn() { throw new Error("must not spawn"); } } } });
  await assert.rejects(loader.load("src/lib/launcher.ts").launchService({ kind: "argv", cwd: "/missing/port-station-directory", argv: [process.execPath] }, () => {}), /启动目录|不可用/);
});

test("spawn 异步 error 被捕获并释放启动锁", async () => {
  let releases = 0;
  const loader = createLoader({ mocks: { "node:child_process": { spawn() {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
    return child;
  } } } });
  let message;
  try {
    await loader.load("src/lib/launcher.ts").launchService({ kind: "argv", cwd: os.tmpdir(), argv: [process.execPath] }, () => releases++);
    assert.fail("expected launch error");
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /spawn ENOENT/);
  assert.equal(releases, 1);
  const logPath = message.split("日志：")[1];
  assert.equal((await fs.stat(logPath)).mode & 0o777, 0o600);
  await fs.rm(path.dirname(logPath), { recursive: true, force: true });
});

test("真实子进程收到原样参数,退出和输出可追踪", async (t) => {
  const cwd = await project(t);
  let releases = 0;
  const { launchService } = createLoader().load("src/lib/launcher.ts");
  const launch = await launchService({ kind: "argv", cwd, argv: [process.execPath, "-e", "console.log(JSON.stringify(process.argv.slice(1)))", "hello world", "--port=4000"] }, () => releases++);
  t.after(() => fs.rm(path.dirname(launch.logPath), { recursive: true, force: true }));
  for (let i = 0; i < 100 && !launch.exited; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(launch.exited, true);
  assert.equal(launch.exitCode, 0);
  assert.equal(releases, 1);
  assert.match(await fs.readFile(launch.logPath, "utf8"), /\["hello world","--port=4000"\]/);
});

function startFixture({ exited = false, exitCode = null, occupiedV6 = false } = {}) {
  let launches = 0;
  let onExit;
  const loader = createLoader({ fastTimers: true, mocks: {
    "@/lib/port-check": { isListening: async (_port, host) => occupiedV6 && host === "::1" },
    "@/lib/launcher": { launchService: async (_recipe, release) => {
      launches++;
      onExit = release;
      if (exited) release();
      return { exited, exitCode, logPath: "/tmp/test-startup.log" };
    } },
  } });
  const store = loader.load("src/lib/restart-store.ts");
  const id = store.saveRestart(54321, { kind: "argv", cwd: os.tmpdir(), argv: [process.execPath] });
  const route = loader.load("src/app/api/services/start/route.ts");
  return {
    run: () => route.POST(apiRequest(loader, "/api/services/start", { restartId: id })),
    count: () => launches, exit: () => onExit(),
  };
}

test("启动进程提前退出返回失败及日志位置", async () => {
  const fixture = startFixture({ exited: true, exitCode: 1 });
  const result = await fixture.run();
  assert.equal(result.status, 500);
  assert.match((await result.json()).error, /退出码 1.*日志/);
});

test("慢启动期间并发和重复请求都不会重复 spawn", async () => {
  const fixture = startFixture();
  const first = fixture.run();
  assert.equal((await fixture.run()).status, 409);
  assert.equal((await first).status, 202);
  assert.equal((await fixture.run()).status, 409);
  assert.equal(fixture.count(), 1);
  fixture.exit();
  assert.equal((await fixture.run()).status, 202);
  assert.equal(fixture.count(), 2);
});

test("IPv6 上端口已有监听时不会启动新进程", async () => {
  const fixture = startFixture({ occupiedV6: true });
  assert.equal((await fixture.run()).status, 409);
  assert.equal(fixture.count(), 0);
});
