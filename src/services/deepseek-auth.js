import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { saveAccount } from "./account-service.js";

function isEmail(loginValue) {
  return loginValue.includes("@");
}

export function createBaseHeaders(token, extraHeaders = {}) {
  const headers = {
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

  const result = await response.json();
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
