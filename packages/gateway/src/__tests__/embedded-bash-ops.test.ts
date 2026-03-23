import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bash, ReadWriteFs } from "just-bash";
import { createJustBashOperations } from "../orchestration/impl/embedded-bash-ops";

let tempDir: string;

function setup(executionLimits?: {
  maxCommandCount?: number;
  maxLoopIterations?: number;
  maxCallDepth?: number;
}) {
  tempDir = mkdtempSync(join(tmpdir(), "test-embedded-bash-ops-"));
  const rwfs = new ReadWriteFs({ root: tempDir });
  const bashInstance = new Bash({ fs: rwfs, executionLimits });
  return createJustBashOperations(bashInstance);
}

function collectChunks() {
  const chunks: Buffer[] = [];
  return {
    chunks,
    onData: (data: Buffer) => chunks.push(data),
    output: () => Buffer.concat(chunks).toString(),
  };
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("createJustBashOperations", () => {
  describe("core adapter behavior", () => {
    test("exec returns stdout via onData as Buffer", async () => {
      const ops = setup();
      const { chunks, onData } = collectChunks();
      await ops.exec("echo hello", "/", { onData });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(Buffer.isBuffer(chunks[0])).toBe(true);
      expect(Buffer.concat(chunks).toString()).toBe("hello\n");
    });

    test("exec returns stderr via onData as Buffer", async () => {
      const ops = setup();
      const { chunks, onData } = collectChunks();
      await ops.exec("echo err >&2", "/", { onData });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(Buffer.isBuffer(chunks[0])).toBe(true);
      expect(Buffer.concat(chunks).toString()).toBe("err\n");
    });

    test("exec returns exit code 0 for success", async () => {
      const ops = setup();
      const { onData } = collectChunks();
      const result = await ops.exec("true", "/", { onData });
      expect(result.exitCode).toBe(0);
    });

    test("exec returns non-zero exit code", async () => {
      const ops = setup();
      const { onData } = collectChunks();
      const result = await ops.exec("exit 42", "/", { onData });
      expect(result.exitCode).toBe(42);
    });

    test("empty stdout does not trigger onData for that chunk", async () => {
      const ops = setup();
      const { chunks, onData } = collectChunks();
      await ops.exec("true", "/", { onData });
      expect(chunks.length).toBe(0);
    });

    test("large output delivered as single buffer", async () => {
      const ops = setup();
      const { onData, output } = collectChunks();
      // Generate 1000+ characters of output
      await ops.exec("printf '%0.s-' $(seq 1 1100)", "/", { onData });
      const result = output();
      expect(result.length).toBe(1100);
      expect(result).toBe("-".repeat(1100));
    });

    test("multiline output preserved", async () => {
      const ops = setup();
      const { onData, output } = collectChunks();
      await ops.exec('printf "a\\nb\\nc"', "/", { onData });
      expect(output()).toBe("a\nb\nc");
    });
  });

  describe("sandbox containment", () => {
    test("files written via bash exist on real fs within root", async () => {
      const ops = setup();
      const { onData } = collectChunks();
      await ops.exec("echo x > file.txt", "/", { onData });
      const content = readFileSync(join(tempDir, "file.txt"), "utf-8");
      expect(content.trim()).toBe("x");
    });

    test("files from real fs within root readable via bash", async () => {
      const ops = setup();
      writeFileSync(join(tempDir, "input.txt"), "hello from node");
      const { onData, output } = collectChunks();
      await ops.exec("cat input.txt", "/", { onData });
      expect(output().trim()).toBe("hello from node");
    });

    test("mkdir creates real directory within root", async () => {
      const ops = setup();
      const { onData } = collectChunks();
      await ops.exec("mkdir -p subdir", "/", { onData });
      expect(existsSync(join(tempDir, "subdir"))).toBe(true);
    });

    test("rm removes real files within root", async () => {
      const ops = setup();
      writeFileSync(join(tempDir, "todelete.txt"), "delete me");
      const { onData } = collectChunks();
      await ops.exec("rm todelete.txt", "/", { onData });
      expect(existsSync(join(tempDir, "todelete.txt"))).toBe(false);
    });
  });

  describe("cwd parameter", () => {
    test("exec with cwd=/ uses sandbox root", async () => {
      const ops = setup();
      const { onData, output } = collectChunks();
      await ops.exec("pwd", "/", { onData });
      expect(output().trim()).toBe("/");
    });

    test("exec with cwd=/subdir resolves within sandbox", async () => {
      const ops = setup();
      const { onData: onData1 } = collectChunks();
      await ops.exec("mkdir -p /subdir", "/", { onData: onData1 });

      const { onData, output } = collectChunks();
      await ops.exec("pwd", "/subdir", { onData });
      expect(output().trim()).toBe("/subdir");
    });
  });

  describe("timeout/environment", () => {
    test("timeout=30 sets TIMEOUT_MS='30000' in env", async () => {
      const ops = setup();
      const { onData, output } = collectChunks();
      await ops.exec("echo $TIMEOUT_MS", "/", { onData, timeout: 30 });
      expect(output().trim()).toBe("30000");
    });

    test("timeout=0 sets TIMEOUT_MS='' (empty string)", async () => {
      const ops = setup();
      const { onData, output } = collectChunks();
      await ops.exec('echo "[$TIMEOUT_MS]"', "/", { onData, timeout: 0 });
      expect(output().trim()).toBe("[]");
    });

    test("timeout=undefined sets TIMEOUT_MS='' (empty string)", async () => {
      const ops = setup();
      const { onData, output } = collectChunks();
      await ops.exec('echo "[$TIMEOUT_MS]"', "/", {
        onData,
        timeout: undefined,
      });
      expect(output().trim()).toBe("[]");
    });
  });

  describe("network config", () => {
    test("curl is not available without network config", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "test-embedded-bash-ops-"));
      const rwfs = new ReadWriteFs({ root: tempDir });
      const bash = new Bash({ fs: rwfs });
      const result = await bash.exec("curl --help");
      expect(result.exitCode).not.toBe(0);
    });

    test("curl is available with network config", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "test-embedded-bash-ops-"));
      const rwfs = new ReadWriteFs({ root: tempDir });
      const bash = new Bash({
        fs: rwfs,
        network: {
          allowedUrlPrefixes: ["https://example.com/"],
          allowedMethods: ["GET", "HEAD"],
        },
      });
      const result = await bash.exec("curl --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("curl");
    });
  });

  describe("execution limits", () => {
    test("maxLoopIterations limit stops infinite loop", async () => {
      const ops = setup({ maxLoopIterations: 100 });
      const { onData, output } = collectChunks();
      const result = await ops.exec("while true; do :; done", "/", { onData });
      expect(result.exitCode).not.toBe(0);
      expect(output()).toContain("too many iterations");
    });

    test("maxCallDepth limit stops deep recursion", async () => {
      const ops = setup({ maxCallDepth: 5 });
      const { onData, output } = collectChunks();
      const result = await ops.exec("f() { f; }; f", "/", { onData });
      expect(result.exitCode).not.toBe(0);
      expect(output()).toContain("maximum recursion depth");
    });
  });
});
