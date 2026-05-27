import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { saveAccount } from "./account-service.js";

function isEmail(loginValue) {
  return loginValue.includes("@");
}

export function createBaseHeaders(token, extraHeaders = {}) {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0",
    accept: "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    origin: config.deepseekBaseUrl,
    referer: `${config.deepseekBaseUrl}/`,
    "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Microsoft Edge";v="144"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-app-version": config.deepseekHeaders.appVersion,
    "x-client-version": config.deepseekHeaders.clientVersion,
    "x-client-platform": config.deepseekHeaders.clientPlatform,
    "x-client-locale": config.deepseekHeaders.locale,
    "x-client-timezone-offset": config.deepseekHeaders.timezoneOffset,
    ...extraHeaders
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}

function buildLoginPayload(loginValue, password, deviceId) {
  return {
    email: isEmail(loginValue) ? loginValue : "",
    mobile: isEmail(loginValue) ? "" : loginValue,
    password,
    area_code: "+86",
    device_id: deviceId,
    os: "web"
  };
}

export async function loginToDeepseek({ loginValue, password, deviceId }) {
  const response = await fetchWithTimeout(`${config.deepseekBaseUrl}/api/v0/users/login`, {
    method: "POST",
    headers: createBaseHeaders("", { "content-type": "application/json" }),
    body: JSON.stringify(buildLoginPayload(loginValue, password, deviceId))
  });

  const rawText = await response.text();

  if (!rawText) {
    throw new Error(
      `DeepSeek 登录响应为空（HTTP ${response.status}）。可能是网络被拦截或区域受限，请检查服务器能否访问 chat.deepseek.com。`
    );
  }

  let result;
  try {
    result = JSON.parse(rawText);
  } catch {
    const preview = rawText.slice(0, 200).replace(/\s+/g, " ");
    throw new Error(
      `DeepSeek 登录响应不是 JSON（HTTP ${response.status}）。响应预览: ${preview}`
    );
  }

  if (result.data?.biz_code !== 0) {
    throw new Error(result.msg || result.data?.biz_msg || "DeepSeek login failed");
  }

  return result;
}

export async function refreshAccountToken(account) {
  const loginResult = await loginToDeepseek({
    loginValue: account.loginValue,
    password: account.password,
    deviceId: account.deviceId
  });

  return saveAccount({
    ...account,
    token: loginResult.data.biz_data.user.token
  });
}
