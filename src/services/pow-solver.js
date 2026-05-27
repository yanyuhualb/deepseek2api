import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";

let wasmExportsPromise;
let cachedBytes;
let cachedView;
let writtenLength = 0;

const encoder = new TextEncoder();
const encodeInto =
  typeof encoder.encodeInto === "function"
    ? (value, view) => encoder.encodeInto(value, view)
    : (value, view) => {
        const bytes = encoder.encode(value);
        view.set(bytes);
        return { read: value.length, written: bytes.length };
      };

function getBytes() {
  if (!cachedBytes || cachedBytes.buffer !== wasm.memory.buffer) {
    cachedBytes = new Uint8Array(wasm.memory.buffer);
  }
  return cachedBytes;
}

function getView() {
  if (!cachedView || cachedView.buffer !== wasm.memory.buffer) {
    cachedView = new DataView(wasm.memory.buffer);
  }
  return cachedView;
}

function passString(value, malloc, realloc) {
  let length = value.length;
  let pointer = malloc(length, 1) >>> 0;
  let offset = 0;
  let bytes = getBytes();

  while (offset < length) {
    const code = value.charCodeAt(offset);
    if (code > 0x7f) {
      break;
    }
    bytes[pointer + offset] = code;
    offset += 1;
  }

  if (offset !== length) {
    if (offset !== 0) {
      value = value.slice(offset);
    }

    const nextLength = offset + value.length * 3;
    pointer = realloc(pointer, length, nextLength, 1) >>> 0;
    bytes = getBytes();

    const target = bytes.subarray(pointer + offset, pointer + offset + value.length * 3);
    const result = encodeInto(value, target);
    offset += result.written;
    length = offset;
    pointer = realloc(pointer, nextLength, length, 1) >>> 0;
  }

  writtenLength = offset;
  return pointer;
}

function getLocalWasmCachePath() {
  const fileName = config.powWasmUrl.split("/").pop() || "deepseek_pow.wasm";
  return join(process.cwd(), "data", "wasm-cache", fileName);
}

function getExpectedWasmHash() {
  return process.env.POW_WASM_SHA256 || null;
}

function computeSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readLocalWasmCache() {
  const cachePath = getLocalWasmCachePath();
  if (!existsSync(cachePath)) {
    return null;
  }
  try {
    return readFileSync(cachePath);
  } catch {
    return null;
  }
}

function writeLocalWasmCache(buffer) {
  const cachePath = getLocalWasmCachePath();
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, buffer);
    renameSync(tempPath, cachePath);
  } catch (error) {
    console.warn("[pow-solver] 写入本地 WASM 缓存失败:", error.message);
  }
}

function verifyHash(buffer) {
  const expected = getExpectedWasmHash();
  if (!expected) {
    return true;
  }
  const actual = computeSha256(buffer);
  if (actual !== expected) {
    console.error(`[pow-solver] WASM 哈希校验失败: 期望 ${expected}, 实际 ${actual}`);
    return false;
  }
  return true;
}

async function fetchAndInstantiateWasm() {
  const cached = readLocalWasmCache();
  if (cached && verifyHash(cached)) {
    const { instance } = await WebAssembly.instantiate(cached, { wbg: {} });
    return instance.exports;
  }

  const response = await fetchWithTimeout(config.powWasmUrl, {}, { timeoutMs: 30_000 });
  if (!response.ok) {
    throw new Error(`下载 WASM 失败: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!verifyHash(buffer)) {
    throw new Error("WASM 哈希校验失败");
  }

  writeLocalWasmCache(buffer);
  const { instance } = await WebAssembly.instantiate(buffer, { wbg: {} });
  return instance.exports;
}

async function loadWasm() {
  if (wasmExportsPromise) {
    return wasmExportsPromise;
  }

  wasmExportsPromise = fetchAndInstantiateWasm().catch((error) => {
    wasmExportsPromise = null;
    throw error;
  });

  return wasmExportsPromise;
}

let wasm;

export async function solvePowChallenge(challenge) {
  wasm = await loadWasm();

  const prefix = `${challenge.salt}_${challenge.expire_at ?? challenge.expireAt}_`;
  const stackPointer = wasm.__wbindgen_add_to_stack_pointer(-16);

  try {
    const challengePointer = passString(
      challenge.challenge,
      wasm.__wbindgen_export_0,
      wasm.__wbindgen_export_1
    );
    const challengeLength = writtenLength;
    const prefixPointer = passString(prefix, wasm.__wbindgen_export_0, wasm.__wbindgen_export_1);
    const prefixLength = writtenLength;

    wasm.wasm_solve(
      stackPointer,
      challengePointer,
      challengeLength,
      prefixPointer,
      prefixLength,
      challenge.difficulty
    );

    const resultCode = getView().getInt32(stackPointer, true);
    const answer = getView().getFloat64(stackPointer + 8, true);

    if (resultCode === 0 || !Number.isFinite(answer)) {
      throw new Error("Failed to solve challenge");
    }

    return {
      algorithm: challenge.algorithm,
      answer,
      challenge: challenge.challenge,
      salt: challenge.salt,
      signature: challenge.signature
    };
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
