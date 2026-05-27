import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { config } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CIPHERTEXT_PREFIX = "enc:v1:";

let cachedKey = null;
let warnedMissingKey = false;

function resolveKey() {
  if (cachedKey) {
    return cachedKey;
  }

  const rawKey = config.secretEncryptionKey;
  if (!rawKey) {
    if (!warnedMissingKey) {
      console.warn(
        "[secret-cipher] SECRET_ENCRYPTION_KEY 未配置，账号密码将以明文形式存储。" +
          "请在生产环境设置该环境变量以启用加密。"
      );
      warnedMissingKey = true;
    }
    return null;
  }

  cachedKey = createHash("sha256").update(rawKey, "utf8").digest();
  return cachedKey;
}

export function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(CIPHERTEXT_PREFIX);
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return plaintext;
  }

  if (isEncryptedSecret(plaintext)) {
    return plaintext;
  }

  const key = resolveKey();
  if (!key) {
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, ciphertext]).toString("base64");

  return `${CIPHERTEXT_PREFIX}${payload}`;
}

export function decryptSecret(value) {
  if (typeof value !== "string" || !isEncryptedSecret(value)) {
    return value;
  }

  const key = resolveKey();
  if (!key) {
    return value;
  }

  try {
    const payload = Buffer.from(value.slice(CIPHERTEXT_PREFIX.length), "base64");
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (error) {
    console.error("[secret-cipher] 解密失败:", error.message);
    return value;
  }
}
