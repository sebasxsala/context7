import fs from "node:fs";
import path from "node:path";

const [, , bump = "patch"] = process.argv;
const allowed = new Set(["patch", "minor", "major"]);

if (!allowed.has(bump)) {
  console.error("Usage: node ./scripts/bump-version.mjs <patch|minor|major>");
  process.exit(1);
}

const packageJsonPath = path.resolve(process.cwd(), "package.json");
const raw = fs.readFileSync(packageJsonPath, "utf8");
const pkg = JSON.parse(raw);

const [majorRaw, minorRaw, patchRaw] = String(pkg.version || "0.0.0").split(".");
let major = Number.parseInt(majorRaw, 10) || 0;
let minor = Number.parseInt(minorRaw, 10) || 0;
let patch = Number.parseInt(patchRaw, 10) || 0;

if (bump === "major") {
  major += 1;
  minor = 0;
  patch = 0;
}

if (bump === "minor") {
  minor += 1;
  patch = 0;
}

if (bump === "patch") {
  patch += 1;
}

pkg.version = `${major}.${minor}.${patch}`;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

console.log(pkg.version);
