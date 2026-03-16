import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const cwd = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, result.stdout, result.stderr].join("\n")
    );
  }

  return result.stdout;
}

const packJson = run("npm", ["pack", "--json"]);
const parsed = JSON.parse(packJson);
const tarball = parsed?.[0]?.filename;

if (!tarball) {
  throw new Error(`Could not resolve tarball from npm pack output: ${packJson}`);
}

const tarballPath = path.resolve(cwd, tarball);

run("npx", ["-y", "-p", tarballPath, "context7-mcp", "--help"]);

await new Promise((resolve, reject) => {
  const child = spawn("npx", ["-y", "-p", tarballPath, "context7-mcp", "--transport", "stdio"], {
    cwd,
    env: {
      ...process.env,
      CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY || "ctx7sk_smoke_test",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timer = setTimeout(() => {
    const stillRunning = child.exitCode === null;
    child.kill("SIGTERM");
    if (!stillRunning) {
      reject(new Error(`Binary exited too early in stdio mode. stderr: ${stderr}`));
      return;
    }
    console.log("Binary is still running after 1.5s, assuming it is working and killing it now.");
    resolve(undefined);
  }, 1500);

  child.on("exit", () => {
    clearTimeout(timer);
  });

  child.on("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

console.log(`Smoke test passed with tarball: ${tarball}`);
