import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoader, apiRequest } from "./helpers.mjs";

test("同源本机请求必须携带正确令牌和 JSON 类型", async () => {
  const loader = createLoader();
  const { checkRequest } = loader.load("src/lib/api-security.ts");
  assert.equal(checkRequest(apiRequest(loader, "/api/services/start", {}), true), undefined);
  for (const [headers, status] of [
    [{ Origin: "https://attacker.example" }, 403],
    [{ Origin: "null" }, 403],
    [{ Origin: "" }, 403],
    [{ Host: "attacker.example:3000" }, 403],
    [{ "Sec-Fetch-Site": "cross-site" }, 403],
    [{ "X-Port-Station-Token": "" }, 403],
    [{ "X-Port-Station-Token": "é".repeat(64) }, 403],
    [{ "Content-Type": "text/plain" }, 415],
  ]) {
    const denied = checkRequest(apiRequest(loader, "/api/services/start", {}, headers), true);
    assert.equal(denied.status, status, JSON.stringify(headers));
  }
});

test("列表、图标等只读接口同样拒绝跨站及非本机 Host", () => {
  const loader = createLoader();
  const { checkRequest } = loader.load("src/lib/api-security.ts");
  assert.equal(checkRequest(apiRequest(loader, "/api/services")), undefined);
  assert.equal(checkRequest(apiRequest(loader, "/api/services", undefined, { Origin: "https://attacker.example" })).status, 403);
  assert.equal(checkRequest(apiRequest(loader, "/api/services", undefined, { Host: "192.168.1.2:3000" })).status, 403);
});

test("启动接口拒绝前端配方、伪造记录及额外命令字段", async () => {
  const loader = createLoader({ fastTimers: true });
  const route = loader.load("src/app/api/services/start/route.ts");
  for (const [body, status] of [
    [{ port: 54321, restart: { kind: "argv", argv: ["/bin/echo", "unsafe"] } }, 400],
    [{ restartId: "unknown-id" }, 404],
    [{ restartId: "unknown-id", restart: { argv: ["/bin/echo"] } }, 400],
  ]) {
    assert.equal((await route.POST(apiRequest(loader, "/api/services/start", body))).status, status);
  }
});

test("重启记录按端口互斥,并在过期后失效", () => {
  let now = 0;
  const loader = createLoader({ globals: { Date: class extends Date { static now() { return now; } } } });
  const store = loader.load("src/lib/restart-store.ts");
  const id = store.saveRestart(54321, { kind: "app", appPath: "/tmp/Test.app" });
  const anotherId = store.saveRestart(54321, { kind: "app", appPath: "/tmp/Test.app" });
  const release = store.claimRestart(store.getRestart(id));
  assert.equal(typeof release, "function");
  assert.equal(store.claimRestart(store.getRestart(anotherId)), undefined);
  release();
  const releaseOther = store.claimRestart(store.getRestart(anotherId));
  assert.equal(typeof releaseOther, "function");
  release();
  assert.equal(store.claimRestart(store.getRestart(id)), undefined, "旧回调重复释放不能解除新请求的锁");
  releaseOther();
  now = 24 * 60 * 60_000 + 1;
  assert.equal(store.getRestart(id), undefined);
});
