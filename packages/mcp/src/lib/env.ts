import fs from "fs";
import path from "path";
import { config as loadDotenv } from "dotenv";

const DEFAULT_ENV_FILES = [".env", ".env.local"];

export function loadMcpEnv(cwd: string = process.cwd()): void {
  const explicitEnvFile = process.env.CONTEXT7_ENV_FILE;

  if (explicitEnvFile) {
    loadDotenv({ path: explicitEnvFile, quiet: true });
    return;
  }

  for (const fileName of DEFAULT_ENV_FILES) {
    const filePath = path.resolve(cwd, fileName);
    if (fs.existsSync(filePath)) {
      loadDotenv({ path: filePath, quiet: true });
    }
  }
}
