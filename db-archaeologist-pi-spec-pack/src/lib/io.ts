import fs from "node:fs";
import path from "node:path";
import { dumpYaml, parseYaml } from "./yaml_lite.js";

export const ROOT = process.cwd();

export function readText(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

export function readJson<T = unknown>(p: string): T {
  return JSON.parse(readText(p)) as T;
}

export function readYaml<T = unknown>(p: string): T {
  return parseYaml(readText(p)) as T;
}

export function readJsonl<T = unknown>(p: string): T[] {
  return readText(p)
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as T);
}

export function writeText(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

export function writeJson(p: string, data: unknown, pretty = true): void {
  writeText(p, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

export function writeYaml(p: string, data: unknown): void {
  writeText(p, dumpYaml(data));
}

export function writeJsonl(p: string, rows: unknown[]): void {
  writeText(p, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
}

export function exists(p: string): boolean {
  return fs.existsSync(p);
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}