import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

const root = new URL('../../extension/', import.meta.url);

// Выполняет классический content-скрипт в изолированном контексте (режим тестов включается флагом).
export function loadScript(relativePath, globals = {}) {
  const code = fs.readFileSync(new URL(relativePath, root), 'utf8');
  const sandbox = { __tthTestMode: true, console, Reflect, Symbol, Set, Map, WeakMap, Promise, JSON, Object, Array, Number, String, Error, URL, Response, Headers, AbortSignal, crypto: webcrypto, setTimeout, clearTimeout, ...globals };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: relativePath });
  return sandbox;
}

// Берёт тело самодостаточной функции из ES-модуля и запускает её в контексте «страницы».
export async function pageFunction(modulePath, name, globals) {
  const mod = await import(new URL(modulePath, root));
  const source = mod[name].toString();
  const sandbox = { URL, Number, String, Array, Object, JSON, Promise, Error, Date, Map, Set, AbortSignal, crypto: webcrypto, encodeURIComponent, decodeURIComponent, setTimeout, ...globals };
  return vm.runInNewContext(`(${source})`, sandbox);
}
