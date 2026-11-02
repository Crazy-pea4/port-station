import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoader, apiRequest, plain } from "./helpers.mjs";

const original = { pid: 111, uid: 501, startedAt: "Mon Nov 2 10:00:00 2026" };
const replacement = { pid: 222, uid: 501, startedAt: "Mon Nov 2 10:01:00 2026" };

function setup({ onTerm, stale = false, brokenPs = false, system = false } = {}) {
  const live = new Map([[111, { ...original }]]);
  if (stale) live.set(111, { ...original, startedAt: "Mon Nov 2 10:01:00 2026" });
  const kills = [];
  const fakeProcess = {
    pid: 9999, env: {}, getuid: () => 501,
    kill(pid, signal) {
      if (!live.has(pid)) throw Object.assign(new Error("gone"), { code: "ESRCH" });
      if (signal === 0) return;
      kills.push([pid, signal]);
      if (signal === "SIGTERM") {
        if (onTerm) onTerm(live);
        else live.delete(pid);
      } else live.delete(pid);
    },
  };
  const loader = createLoader({
    fastTimers: true,
    globals: { process: fakeProcess },
    mocks: {
      "node:child_process": { execFile(_command, args, _options, callback) {
        if (brokenPs) return callback(Object.assign(new Error("denied"), { code: "EPERM" }), "");
        const pids = args.at(-1).split(",").map(Number);
        const out = pids.flatMap((pid) => live.has(pid) ? [`${pid} 501 ${live.get(pid).startedAt} S`] : []).join("\n");
        callback(out ? null : { code: 1 }, out);
      } },
      "@/lib/scan": {
        scanListeners: async () => [{ port: 54321, pid: 111, process: system ? "rapportd" : "node", login: "test" }],
        isUserLogin: () => true, isSystemProcess: (name) => name === "rapportd",
      },
      "@/lib/restart": {
        captureLaunchContexts: async () => new Map([[111, { command: "node" }]]),
        buildRestartRecipe: () => ({ recipe: { kind: "app", appPath: "/tmp/Test.app" } }),
      },
    },
  });
  loader.load("src/lib/service-cache.ts").updateSnapshot([{ port: 54321, pids: [111], targets: [original] }]);
  const route = loader.load("src/app/api/services/close/route.ts");
  return { live, kills, run: (targets = [original]) => route.POST(apiRequest(loader, "/api/services/close", { port: 54321, targets })) };
}

test("原进程退出后端口由新 PID 接替,不强杀新 PID", async () => {
  const fixture = setup({ onTerm(live) { live.delete(111); live.set(222, replacement); } });
  const response = await fixture.run();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.closed, true);
  assert.equal(result.forced, false);
  assert.equal(typeof result.restartId, "string");
  assert.deepEqual(fixture.kills, [[111, "SIGTERM"]]);
  assert.equal(fixture.live.has(222), true);
});

test("同一 PID 被复用后,启动时间不同的新进程不被强杀", async () => {
  const fixture = setup({ onTerm(live) { live.set(111, { ...original, startedAt: replacement.startedAt }); } });
  assert.equal((await (await fixture.run()).json()).closed, true);
  assert.deepEqual(fixture.kills, [[111, "SIGTERM"]]);
  assert.equal(fixture.live.has(111), true);
});

test("原进程忽略 SIGTERM 时,仅向原 PID 发送 SIGKILL", async () => {
  const fixture = setup({ onTerm(live) { live.set(222, replacement); } });
  const result = await (await fixture.run()).json();
  assert.equal(result.forced, true);
  assert.equal(result.closed, true);
  assert.deepEqual(fixture.kills, [[111, "SIGTERM"], [111, "SIGKILL"]]);
  assert.equal(fixture.live.has(222), true);
});

test("卡片身份已过期时拒绝关闭", async () => {
  const fixture = setup({ stale: true });
  assert.equal((await fixture.run()).status, 409);
  assert.deepEqual(fixture.kills, []);
});

test("系统进程、伪造身份、无身份请求均不能关闭", async () => {
  const system = setup({ system: true });
  assert.equal((await system.run()).status, 409);
  assert.deepEqual(system.kills, []);
  const fixture = setup();
  assert.equal((await fixture.run([{ ...original, uid: 0 }])).status, 409);
  assert.equal((await fixture.run([])).status, 400);
  assert.deepEqual(fixture.kills, []);
});

test("身份读取失败时不发送信号,也不误报关闭成功", async () => {
  const fixture = setup({ brokenPs: true });
  assert.equal((await fixture.run()).status, 503);
  assert.deepEqual(plain(fixture.kills), []);
});
