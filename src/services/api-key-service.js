import { readStore, updateStore } from "../storage/store.js";
import { createApiKey, createId, hashValue } from "../utils/id.js";
import { forgetApiKeyRotation } from "./account-rotation-service.js";

function sanitizeKey(record) {
  const { keyHash, ...rest } = record;
  return rest;
}

export function listApiKeysForOwner(ownerId) {
  return readStore().apiKeys
    .filter((record) => record.ownerId === ownerId)
    .map(sanitizeKey);
}

export function createApiKeyRecord({ ownerId, accountId, label, plainKey }) {
  const key = plainKey || createApiKey();
  const record = {
    id: createId(),
    ownerId,
    accountId,
    label,
    keyHash: hashValue(key),
    preview: `${key.slice(0, 8)}...${key.slice(-4)}`,
    createdAt: new Date().toISOString()
  };

  updateStore((state) => ({
    ...state,
    apiKeys: [...state.apiKeys, record]
  }));

  return {
    key,
    record: sanitizeKey(record)
  };
}

export function deleteApiKeyRecord(ownerId, keyId) {
  updateStore((state) => ({
    ...state,
    apiKeys: state.apiKeys.filter(
      (record) => !(record.id === keyId && record.ownerId === ownerId)
    )
  }));
  forgetApiKeyRotation(keyId);
}

export function getApiKeyRecord(key) {
  const keyHash = hashValue(key);
  return readStore().apiKeys.find((record) => record.keyHash === keyHash) ?? null;
}
