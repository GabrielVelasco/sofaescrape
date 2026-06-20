#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const port = String(process.env.PORT ?? 3000);
const localBaseUrl = `http://127.0.0.1:${port}`;
const ngrokApiUrl = process.env.NGROK_API_URL ?? "http://127.0.0.1:4040/api/tunnels";
const websiteRepo = process.env.WEBSITE_REPO ?? "/home/gabriel-velasco/Downloads/BET-Attack-Momentum";
const apiConfigPath = resolve(websiteRepo, "scripts/apiConfig.js");

const children = new Set();

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? "inherit",
  });

  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", (err) => {
    console.error(`[publish] failed to start ${command}:`, err.message);
  });

  return child;
}

async function waitForJson(url, timeoutMs, select) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const selected = select(data);
        if (selected) return selected;
      }
    } catch (err) {
      lastError = err;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

async function waitForOk(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (err) {
      lastError = err;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

async function updateApiConfig(publicUrl) {
  const source = await readFile(apiConfigPath, "utf8");
  const baseUrlPattern = /baseUrl:\s*["'`][^"'`]+["'`]/;

  if (!baseUrlPattern.test(source)) {
    throw new Error(`Could not find baseUrl in ${apiConfigPath}`);
  }

  const updated = source.replace(baseUrlPattern, `baseUrl: "${publicUrl}"`);

  if (source === updated) {
    return false;
  }

  await writeFile(apiConfigPath, updated);
  return true;
}

async function gitHasApiConfigChange() {
  const chunks = [];
  const child = spawn("git", ["-C", websiteRepo, "status", "--porcelain", "--", "scripts/apiConfig.js"], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  child.stdout.on("data", (chunk) => chunks.push(chunk));

  await new Promise((resolveRun, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveRun() : reject(new Error("git status failed")));
  });

  return Buffer.concat(chunks).toString("utf8").trim().length > 0;
}

async function publishConfig(publicUrl) {
  const changed = await updateApiConfig(publicUrl);
  if (!changed || !(await gitHasApiConfigChange())) {
    console.log(`[publish] apiConfig.js already points at ${publicUrl}`);
    return false;
  }

  await run("git", ["-C", websiteRepo, "add", "scripts/apiConfig.js"]);
  await run("git", ["-C", websiteRepo, "commit", "-m", `Update API URL to ${publicUrl}`]);
  await run("git", ["-C", websiteRepo, "push"]);
  return true;
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.once("SIGINT", () => {
  stopChildren();
  process.exit(130);
});

process.once("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});

try {
  console.log(`[publish] starting API on ${localBaseUrl}`);
  start("node", ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: port,
      NODE_ENV: process.env.NODE_ENV ?? "production",
    },
  });

  await waitForOk(`${localBaseUrl}/health`, 30_000);

  console.log("[publish] starting ngrok tunnel");
  start("ngrok", ["http", localBaseUrl], {
    cwd: projectRoot,
  });

  const publicUrl = await waitForJson(
    ngrokApiUrl,
    30_000,
    (data) => data.tunnels?.find((tunnel) => (
      tunnel.proto === "https" &&
      String(tunnel.config?.addr ?? "").includes(`:${port}`)
    ))?.public_url
  );

  console.log(`[publish] public API URL: ${publicUrl}`);
  const pushed = await publishConfig(publicUrl);
  if (pushed) {
    console.log("[publish] GitHub Pages config updated and pushed");
  }
  console.log("[publish] API and ngrok are still running. Press Ctrl+C to stop.");

  await new Promise(() => {});
} catch (err) {
  console.error("[publish]", err.message);
  stopChildren();
  process.exit(1);
}
