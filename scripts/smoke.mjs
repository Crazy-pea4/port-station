import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createLoader } from "../tests/helpers.mjs";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* 等待临时测试服务就绪 */ }
    await delay(100);
  }
  throw new Error(`服务启动超时：${url}`);
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "port-station-smoke My Project-"));
const fixtureName = `port-station-smoke-${randomUUID()}`;
const children = [];
const ownedTargets = new Map();
let startupLog;
let output = "";
try {
  const appPort = await freePort();
  const fixturePort = await freePort();
  const origin = `http://127.0.0.1:${appPort}`;
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ name: fixtureName, scripts: { dev: "node server.cjs" } }));
  await fs.writeFile(path.join(directory, "server.cjs"), `
const http = require('node:http');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJv0AAAAASUVORK5CYII=', 'base64');
const server = http.createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.setHeader('Content-Type', 'image/png'); response.end(png); }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<title>Port Station smoke fixture</title>ok'); }
});
server.listen(${fixturePort}, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
  function start(command, args, cwd) {
    const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => { output += error.message; });
    return child;
  }
  start("npm", ["run", "dev"], directory);
  start(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(appPort)], process.cwd());
  await waitFor(`${origin}/`);
  await waitFor(`http://127.0.0.1:${fixturePort}/`);
  const page = await fetch(origin);
  assert.match(await page.text(), /Port Station/);
  let snapshot = await fetch(`${origin}/api/services`).then((response) => {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  });
  const service = snapshot.services.find((entry) => entry.port === fixturePort);
  assert.ok(service, "临时项目应该出现在扫描列表中");
  service.targets.forEach((target) => ownedTargets.set(target.pid, target));
  assert.equal(service.title, fixtureName);
  assert.equal(service.targets.length, service.pids.length);
  assert.equal(service.restartable, true, service.noRestartReason);
  assert.equal(service.restart, undefined);
  assert.equal(snapshot.services.some((entry) => entry.port === appPort), false);
  const icon = await fetch(`${origin}/api/services/icon?port=${fixturePort}`);
  assert.equal(icon.status, 200, "图标路由应能读取列表路由的共享快照");
  await icon.arrayBuffer();

  function mutate(endpoint, body, headers = {}) {
    return fetch(origin + endpoint, {
      method: "POST", signal: AbortSignal.timeout(20_000),
      headers: { Origin: origin, "Content-Type": "application/json", "X-Port-Station-Token": snapshot.sessionToken, ...headers },
      body: JSON.stringify(body),
    });
  }
  const closeBody = { port: fixturePort, targets: service.targets };
  assert.equal((await mutate("/api/services/close", closeBody, { "X-Port-Station-Token": "" })).status, 403);
  assert.equal((await mutate("/api/services/close", closeBody, { Origin: "https://attacker.example" })).status, 403);
  assert.equal((await fetch(`${origin}/api/services`, { headers: { Origin: "https://attacker.example" } })).status, 403);
  assert.equal((await mutate("/api/services/start", { port: fixturePort, restart: { kind: "argv", argv: ["/bin/echo"] } })).status, 400);
  assert.equal((await mutate("/api/services/close", { ...closeBody, targets: service.targets.map((target) => ({ ...target, startedAt: "stale" })) })).status, 409);
  assert.equal((await fetch(`http://127.0.0.1:${fixturePort}/`)).status, 200);

  const closedResponse = await mutate("/api/services/close", closeBody);
  const closed = await closedResponse.json();
  assert.equal(closedResponse.status, 200, JSON.stringify(closed));
  assert.equal(closed.closed, true);
  assert.equal(typeof closed.restartId, "string");
  const startedResponse = await mutate("/api/services/start", { restartId: closed.restartId });
  const started = await startedResponse.json();
  startupLog = started.logPath;
  assert.equal(startedResponse.status, 200, JSON.stringify(started));
  assert.equal(started.listening, true);
  await waitFor(`http://127.0.0.1:${fixturePort}/`);
  snapshot = await fetch(`${origin}/api/services`).then((response) => response.json());
  const restarted = snapshot.services.find((entry) => entry.port === fixturePort && entry.title === fixtureName);
  assert.ok(restarted, "重启后的测试项目应该重新出现");
  restarted.targets.forEach((target) => ownedTargets.set(target.pid, target));
  assert.notDeepEqual(restarted.pids, service.pids);
  const cleanup = await mutate("/api/services/close", { port: fixturePort, targets: restarted.targets });
  assert.equal((await cleanup.json()).closed, true);
  console.log("PASS: 生产页面、真实端口扫描、共享图标缓存、接口权限、旧身份拒绝、关闭及重启完整流程");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  // 只清理本脚本创建并确认过身份的测试进程。
  const { signalOriginal } = createLoader().load("src/lib/process-identity.ts");
  for (const target of ownedTargets.values()) {
    try { await signalOriginal(target, "SIGTERM"); } catch { /* 已退出或身份已变化 */ }
  }
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* 已退出 */ }
    }
  }
  await delay(150);
  await fs.rm(directory, { recursive: true, force: true });
  if (startupLog) await fs.rm(path.dirname(startupLog), { recursive: true, force: true });
}
