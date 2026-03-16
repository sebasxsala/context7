import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, test } from "vitest";
import { loadMcpEnv } from "./env.js";

const ORIGINAL = {
  CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY,
  CONTEXT7_PROXY_URL: process.env.CONTEXT7_PROXY_URL,
  CONTEXT7_ENV_FILE: process.env.CONTEXT7_ENV_FILE,
};

function restoreEnv() {
  process.env.CONTEXT7_API_KEY = ORIGINAL.CONTEXT7_API_KEY;
  process.env.CONTEXT7_PROXY_URL = ORIGINAL.CONTEXT7_PROXY_URL;
  process.env.CONTEXT7_ENV_FILE = ORIGINAL.CONTEXT7_ENV_FILE;
}

afterEach(() => {
  restoreEnv();
});

describe("loadMcpEnv", () => {
  test("loads values from .env in the provided directory", () => {
    delete process.env.CONTEXT7_API_KEY;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-env-test-"));
    fs.writeFileSync(path.join(tempDir, ".env"), "CONTEXT7_API_KEY=ctx7sk-from-dotenv\n", "utf8");

    loadMcpEnv(tempDir);

    expect(process.env.CONTEXT7_API_KEY).toBe("ctx7sk-from-dotenv");
  });

  test("does not override existing env values", () => {
    process.env.CONTEXT7_API_KEY = "ctx7sk-existing";

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-env-test-"));
    fs.writeFileSync(path.join(tempDir, ".env"), "CONTEXT7_API_KEY=ctx7sk-from-dotenv\n", "utf8");

    loadMcpEnv(tempDir);

    expect(process.env.CONTEXT7_API_KEY).toBe("ctx7sk-existing");
  });

  test("loads explicit env file from CONTEXT7_ENV_FILE", () => {
    delete process.env.CONTEXT7_PROXY_URL;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-env-test-"));
    const customFile = path.join(tempDir, "custom.env");
    fs.writeFileSync(customFile, "CONTEXT7_PROXY_URL=https://worker.example.workers.dev\n", "utf8");

    process.env.CONTEXT7_ENV_FILE = customFile;
    loadMcpEnv(tempDir);

    expect(process.env.CONTEXT7_PROXY_URL).toBe("https://worker.example.workers.dev");
  });
});
