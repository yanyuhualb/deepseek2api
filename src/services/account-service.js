import { updateStore, readStore } from "../storage/store.js";
import { createId } from "../utils/id.js";
import { decryptSecret, encryptSecret } from "../utils/secret-cipher.js";

function decryptAccount(account) {
  if (!account) {
    return account;
  }
  return {
    ...account,
    password: decryptSecret(account.password)
  };
}

function encryptAccount(account) {
  if (!account) {
    return account;
  }
  return {
    ...account,
    password: encryptSecret(account.password)
  };
}

function withUpdatedRecord(account, nextFields) {
  return {
    ...account,
    ...nextFields,
    updatedAt: new Date().toISOString()
  };
}

export function listAccounts() {
  return readStore().accounts.map(decryptAccount);
}

export function getAccountById(accountId) {
  return listAccounts().find((account) => account.id === accountId) ?? null;
}

export function resolveAccountLabel(account) {
  return [
    account?.loginValue,
    account?.displayName,
    account?.emailMasked,
    account?.mobileMasked,
    account?.id
  ].find(Boolean) ?? "";
}

export function findAccountForOwner(ownerId, deepseekUserId) {
  return listAccounts().find(
    (account) => account.ownerId === ownerId && account.deepseekUserId === deepseekUserId
  ) ?? null;
}

export function listAccountsForOwner(ownerId) {
  return listAccounts().filter((account) => account.ownerId === ownerId);
}

export function saveAccount(accountInput) {
  const existing = accountInput.deepseekUserId
    ? findAccountForOwner(accountInput.ownerId, accountInput.deepseekUserId)
    : null;

  const account = existing
    ? withUpdatedRecord(existing, accountInput)
    : {
        id: createId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...accountInput
      };

  const persistedAccount = encryptAccount(account);

  updateStore((state) => ({
    ...state,
    accounts: existing
      ? state.accounts.map((entry) => (entry.id === persistedAccount.id ? persistedAccount : entry))
      : [...state.accounts, persistedAccount]
  }));

  return account;
}

export function deleteAccountById(accountId) {
  let deletedAccount = null;

  updateStore((state) => {
    deletedAccount = state.accounts.find((account) => account.id === accountId) ?? null;
    if (!deletedAccount) {
      return state;
    }

    return {
      ...state,
      accounts: state.accounts.filter((account) => account.id !== accountId)
    };
  });

  return decryptAccount(deletedAccount);
}
