import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import Papa from 'papaparse';

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function readYaml<T = unknown>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return yaml.load(readFileSync(file, 'utf8')) as T;
}

export function readJson<T = unknown>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, data: unknown, pretty = false) {
  ensureDir(path.dirname(file));
  writeFileSync(file, JSON.stringify(data, null, pretty ? 2 : 0) + (pretty ? '\n' : ''));
}

export function readCsv(file: string): Record<string, string>[] {
  if (!existsSync(file)) return [];
  const res = Papa.parse<Record<string, string>>(readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true });
  return res.data;
}

export function listFiles(dir: string, ext?: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !ext || f.endsWith(ext));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchWithRetry(url: string, init: RequestInit = {}, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw lastErr;
}
