import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.cwd(), "dist");

function removeTestFiles(dir) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      removeTestFiles(fullPath);
      continue;
    }

    if (entry.name.endsWith(".test.js")) {
      fs.unlinkSync(fullPath);
    }
  }
}

removeTestFiles(distDir);
