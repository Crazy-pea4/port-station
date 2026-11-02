import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const compiled = new Map();

// 运行真实 TS 模块,只替换测试明确指定的 OS 边界,不需要安装测试框架。
export function createLoader({ mocks = {}, globals = {}, fastTimers = false } = {}) {
  const cache = new Map();
  const context = vm.createContext({
    process, console, Buffer, URL, Request, Response, AbortController, AbortSignal,
    setTimeout: fastTimers ? (callback) => { queueMicrotask(callback); return 0; } : setTimeout,
    clearTimeout, ...globals,
  });
  function load(name, from = root) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (!name.startsWith(".") && !name.startsWith("@/") && !path.isAbsolute(name)) return nodeRequire(name);
    let filename = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(from, name);
    if (!path.extname(filename)) filename += ".ts";
    if (cache.has(filename)) return cache.get(filename).exports;
    if (!compiled.has(filename)) {
      compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText);
    }
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const wrapper = new vm.Script(`(function(exports, require, module) {${compiled.get(filename)}\n})`, { filename }).runInContext(context);
    wrapper(loadedModule.exports, (id) => load(id, path.dirname(filename)), loadedModule);
    return loadedModule.exports;
  }
  return { load: (name) => load(path.resolve(root, name)), mocks };
}

export function apiRequest(loader, endpoint, body, headers = {}) {
  const origin = "http://127.0.0.1:3000";
  return new Request(origin + endpoint, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Host: "127.0.0.1:3000", Origin: origin,
      "Content-Type": "application/json",
      "X-Port-Station-Token": loader.load("src/lib/api-security.ts").sessionToken(),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const plain = (value) => JSON.parse(JSON.stringify(value));
