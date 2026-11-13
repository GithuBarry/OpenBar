import fs from "node:fs";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";

function privateMode(file: string, mode: number): void {
  try {
    fs.chmodSync(file, mode);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

/** Directory durability is best effort on platforms that support directory fsync. */
export function syncDirectory(directory: string): void {
  try {
    const descriptor = fs.openSync(directory, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch { /* Directory fsync is unavailable on some filesystems. */ }
}

/** Publish private metadata while retaining the destination's lexical path. */
export function writePrivateFileAtomic(file: string, contents: string | Buffer): void {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const staging = fs.mkdtempSync(path.join(directory, ".openbar-atomic-"));
  try {
    privateMode(staging, 0o700);
    const stagedFile = path.join(staging, path.basename(file));
    writeFileAtomic.sync(stagedFile, contents, {
      mode: 0o600,
      fsync: true,
      tmpfileCreated: temporary => privateMode(temporary, 0o600),
    });
    const expectedSize = typeof contents === "string" ? Buffer.byteLength(contents, "utf8") : contents.length;
    if (fs.statSync(stagedFile).size !== expectedSize) throw new Error("Metadata write ended before all bytes were saved.");
    fs.renameSync(stagedFile, file);
  } finally {
    try { fs.rmSync(staging, { recursive: true, force: true }); }
    catch { /* Preserve the original write result when temporary cleanup fails. */ }
    syncDirectory(directory);
  }
}
