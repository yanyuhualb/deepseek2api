import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { solvePowChallenge } from "./pow-solver.js";
import { createBaseHeaders, refreshAccountToken } from "./deepseek-auth.js";

const STREAMING_PATHS = new Set([
  "/api/v0/chat/completion",
  "/api/v0/chat/regenerate",
  "/api/v0/chat/resume_stream"
]);

function buildTargetUrl(path, query) {
  const url = new URL(path, config.deepseekBaseUrl);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

async function createPowHeader(account, path) {
  const response = await fetchWithTimeout(`${config.deepseekBaseUrl}/api/v0/chat/create_pow_challenge`, {
    method: "POST",
    headers: createBaseHeaders(account.token, { "content-type": "application/json" }),
    body: JSON.stringify({ target_path: path })
  });

  const payload = await response.json();
  const challenge = payload.data.biz_data.challenge;
  const solved = await solvePowChallenge({
    ...challenge,
    expireAt: challenge.expire_at
  });

  return Buffer.from(
    JSON.stringify({
      algorithm: solved.algorithm,
      challenge: solved.challenge,
      salt: solved.salt,
      answer: solved.answer,
      signature: solved.signature,
      target_path: path
    })
  ).toString("base64");
}

async function performRequest({ account, method, path, query, body, headers }) {
  const finalHeaders = createBaseHeaders(account.token, headers);

  if (config.powProtectedPaths.has(path)) {
    finalHeaders["x-ds-pow-response"] = await createPowHeader(account, path);
  }

  return fetchWithTimeout(
    buildTargetUrl(path, query),
    {
      method,
      headers: finalHeaders,
      body
    },
    { streaming: STREAMING_PATHS.has(path) }
  );
}

async function maybeRefreshAccount(response, account) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return { refreshedAccount: account, response };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const payloadText = buffer.toString("utf8");
  const payload = contentType.includes("application/json") ? JSON.parse(payloadText) : null;
  const shouldRefresh = payload?.code === 40002 || payload?.code === 40003;

  if (!shouldRefresh) {
    return {
      refreshedAccount: account,
      response: new Response(buffer, {
        headers: response.headers,
        status: response.status
      })
    };
  }

  const refreshedAccount = await refreshAccountToken(account);
  return { refreshedAccount, response: null };
}

export async function proxyDeepseekRequest(options) {
  const { account } = options;
  const initialResponse = await performRequest(options);
  const firstPass = await maybeRefreshAccount(initialResponse, account);

  if (firstPass.response) {
    return firstPass;
  }

  const retriedResponse = await performRequest({
    ...options,
    account: firstPass.refreshedAccount
  });

  const secondPass = await maybeRefreshAccount(retriedResponse, firstPass.refreshedAccount);
  if (!secondPass.response) {
    throw new Error("DeepSeek token refresh failed");
  }

  return secondPass;
}
