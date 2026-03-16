import { spawnSync } from "node:child_process";
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

console.log(`Smoke test passed with tarball: ${tarball}`);
