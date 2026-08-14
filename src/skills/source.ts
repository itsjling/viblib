import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SourceIdentity } from "./types.js";

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function safeSubpath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid skill subpath '${value}'.`);
  }
  return normalized === "." ? "" : normalized;
}

function splitFragment(value: string): { input: string; ref: string | null } {
  const hash = value.indexOf("#");
  if (hash === -1) {
    return { input: value, ref: null };
  }
  const ref =
    value
      .slice(hash + 1)
      .split("@")[0]
      ?.trim() || null;
  return { input: value.slice(0, hash), ref };
}

export function splitSkillSelector(value: string): {
  source: string;
  skill: string | null;
} {
  const shorthand = value.match(/^([^/:\s]+\/[^/@\s]+)@(.+)$/);
  if (shorthand) {
    return { skill: shorthand[2], source: shorthand[1] };
  }
  const fragment = value.match(/^(.+#[^@]+)@(.+)$/);
  if (fragment) {
    return { skill: fragment[2], source: fragment[1] };
  }
  return { skill: null, source: value };
}

export async function normalizeSource(
  input: string,
  cwd = process.cwd()
): Promise<SourceIdentity> {
  const trimmed = splitSkillSelector(input.trim()).source;
  if (!trimmed) {
    throw new Error("A skill source is required.");
  }
  const { input: bareInput, ref: fragmentRef } = splitFragment(trimmed);
  if (bareInput.startsWith("github:")) {
    return normalizeSource(
      `${bareInput.slice("github:".length)}${fragmentRef ? `#${fragmentRef}` : ""}`,
      cwd
    );
  }
  if (bareInput.startsWith("gitlab:")) {
    return normalizeSource(
      `https://gitlab.com/${bareInput.slice("gitlab:".length)}${fragmentRef ? `#${fragmentRef}` : ""}`,
      cwd
    );
  }
  const localLike =
    bareInput.startsWith(".") ||
    bareInput.startsWith("/") ||
    bareInput === "~" ||
    bareInput.startsWith("~/") ||
    /^[a-zA-Z]:[/\\]/.test(bareInput);
  if (localLike) {
    const absolute = path.resolve(cwd, expandHome(bareInput)),
      source = await fs.realpath(absolute).catch(() => absolute);
    return { ref: null, source, subpath: null, type: "local" };
  }

  const githubTree = bareInput.match(
    /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?\/?$/i
  );
  if (githubTree) {
    return {
      ref: githubTree[3] || fragmentRef,
      source: `https://github.com/${githubTree[1]}/${githubTree[2].replace(/\.git$/i, "")}.git`,
      subpath: githubTree[4] ? safeSubpath(githubTree[4]) : null,
      type: "git",
    };
  }
  const gitlabTree = bareInput.match(
    /^https?:\/\/gitlab\.com\/(.+?)\/-\/tree\/([^/]+)(?:\/(.+))?\/?$/i
  );
  if (gitlabTree) {
    return {
      ref: gitlabTree[2] || fragmentRef,
      source: `https://gitlab.com/${gitlabTree[1].replace(/\.git$/i, "")}.git`,
      subpath: gitlabTree[3] ? safeSubpath(gitlabTree[3]) : null,
      type: "git",
    };
  }
  const shorthand = bareInput.match(/^([^/:\s]+)\/([^/\s]+)(?:\/(.+))?\/?$/);
  if (shorthand) {
    return {
      ref: fragmentRef,
      source: `https://github.com/${shorthand[1]}/${shorthand[2].replace(/\.git$/i, "")}.git`,
      subpath: shorthand[3] ? safeSubpath(shorthand[3]) : null,
      type: "git",
    };
  }
  if (/^https?:\/\//i.test(bareInput)) {
    try {
      const url = new URL(bareInput);
      if (url.hostname.toLowerCase() === "github.com") {
        const [owner, repo] = url.pathname.split("/").filter(Boolean);
        if (owner && repo) {
          return {
            ref: fragmentRef,
            source: `https://github.com/${owner}/${repo.replace(/\.git$/i, "")}.git`,
            subpath: null,
            type: "git",
          };
        }
      }
      if (url.hostname.toLowerCase() === "gitlab.com") {
        const repo = url.pathname.replace(/^\/+|\/+$/g, "");
        if (repo.includes("/")) {
          return {
            ref: fragmentRef,
            source: `https://gitlab.com/${repo.replace(/\.git$/i, "")}.git`,
            subpath: null,
            type: "git",
          };
        }
      }
      return {
        ref: fragmentRef,
        source: bareInput,
        subpath: null,
        type: bareInput.endsWith(".git") ? "git" : "well-known",
      };
    } catch {
      /* Handled as a raw git URL below */
    }
  }
  const githubSsh = bareInput.match(
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i
  );
  if (githubSsh) {
    return {
      ref: fragmentRef,
      source: `https://github.com/${githubSsh[1]}/${githubSsh[2].replace(/\.git$/i, "")}.git`,
      subpath: null,
      type: "git",
    };
  }
  return { ref: fragmentRef, source: bareInput, subpath: null, type: "git" };
}

export function sourceKey(source: SourceIdentity): string {
  return `${source.type}:${source.source}#${source.ref ?? ""}:${source.subpath ?? ""}`;
}

export async function sourceForInvocation(
  input: string,
  cwd = process.cwd()
): Promise<string> {
  const normalized = await normalizeSource(input, cwd);
  if (normalized.type !== "local") {
    return input;
  }
  return normalized.source;
}

export async function sourceForCatalog(
  input: string,
  cwd = process.cwd()
): Promise<string> {
  const { source } = splitSkillSelector(input.trim()),
    normalized = await normalizeSource(source, cwd);
  if (normalized.type !== "local") {
    return source;
  }
  const home = os.homedir(),
    relative = path.relative(home, normalized.source);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `~/${relative.replaceAll(path.sep, "/")}`;
  }
  return normalized.source;
}
