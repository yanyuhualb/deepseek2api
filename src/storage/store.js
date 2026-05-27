import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { config } from "../config.js";

function defaultState() {
  return {
    accounts: [],
    apiKeys: [],
    incognito: {
      globalEnabled: false,
      owners: {}
    },
    invites: [],
    registration: {
      inviteRequired: false
    },
    sessions: [],
    users: []
  };
}

function normalizeIncognito(value) {
  const owners = value?.owners;

  return {
    globalEnabled: Boolean(value?.globalEnabled),
    owners: owners && typeof owners === "object" ? owners : {}
  };
}

function normalizeInvites(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRegistration(value) {
  return {
    inviteRequired: Boolean(value?.inviteRequired)
  };
}

function normalizeUsers(value) {
  const normalizeLimit = (limit) => {
    const parsed = Number(limit);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };

  return Array.isArray(value) ? value.map((user) => ({
    ...user,
    disabled: Boolean(user?.disabled),
    requestLimits: {
      maxConcurrency: normalizeLimit(user?.requestLimits?.maxConcurrency),
      maxRequestsPerMinute: normalizeLimit(user?.requestLimits?.maxRequestsPerMinute)
    }
  })) : [];
}

function normalizeState(value) {
  return {
    accounts: Array.isArray(value?.accounts) ? value.accounts : [],
    apiKeys: Array.isArray(value?.apiKeys) ? value.apiKeys : [],
    incognito: normalizeIncognito(value?.incognito),
    invites: normalizeInvites(value?.invites),
    registration: normalizeRegistration(value?.registration),
    sessions: Array.isArray(value?.sessions) ? value.sessions : [],
    users: normalizeUsers(value?.users)
  };
}

function readStateFromDisk() {
  if (!existsSync(config.dataFile)) {
    const state = defaultState();
    writeStateToDisk(state);
    return state;
  }

  const raw = readFileSync(config.dataFile, "utf8");
  return normalizeState(JSON.parse(raw));
}

function writeStateToDisk(state) {
  const tempFile = `${config.dataFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempFile, JSON.stringify(normalizeState(state), null, 2));
  renameSync(tempFile, config.dataFile);
}

export function readStore() {
  return readStateFromDisk();
}

export function writeStore(state) {
  writeStateToDisk(state);
}

// updateStore 在 Node.js 单线程同步路径上是原子的：readFileSync + writeFileSync
// 之间没有 await，不会与其他 updateStore 调用交错。
// 原子 rename 写入额外保证：进程崩溃也不会留下半写入的损坏文件。
export function updateStore(updater) {
  const current = readStateFromDisk();
  const next = updater(current);
  writeStateToDisk(next);
  return next;
}
