import { config } from "../config.js";

let dispatcherCache;

function isSocksProxy(url) {
  return /^socks(4a?|5h?)?:\/\//i.test(url);
}

async function loadHttpProxyDispatcher(proxyUrl) {
  let undici;
  try {
    undici = await import("undici");
  } catch {
    throw new Error(
      `HTTP/HTTPS 代理 ${proxyUrl} 需要 undici 包，请在项目根目录执行: npm install undici`
    );
  }

  return new undici.ProxyAgent({ uri: proxyUrl });
}

async function loadSocksProxyDispatcher(proxyUrl) {
  let socksAgent;
  let undici;
  try {
    socksAgent = await import("socks-proxy-agent");
    undici = await import("undici");
  } catch {
    throw new Error(
      `SOCKS 代理 ${proxyUrl} 需要 socks-proxy-agent 和 undici 包，请执行: npm install undici socks-proxy-agent`
    );
  }

  const agent = new socksAgent.SocksProxyAgent(proxyUrl);
  return new undici.Agent({
    connect: (opts, callback) => {
      agent.createConnection({ ...opts, secureEndpoint: opts.protocol === "https:" }, callback);
    }
  });
}

async function getProxyDispatcher() {
  if (dispatcherCache !== undefined) {
    return dispatcherCache;
  }

  const proxyUrl = config.upstreamProxy;
  if (!proxyUrl) {
    dispatcherCache = null;
    return null;
  }

  try {
    dispatcherCache = isSocksProxy(proxyUrl)
      ? await loadSocksProxyDispatcher(proxyUrl)
      : await loadHttpProxyDispatcher(proxyUrl);
    console.log(`[fetch] 已启用上游代理: ${proxyUrl}`);
  } catch (error) {
    dispatcherCache = null;
    console.error(`[fetch] 启用代理失败: ${error.message}`);
  }

  return dispatcherCache;
}

export async function fetchWithTimeout(input, init = {}, options = {}) {
  const isStream = options.streaming === true;
  const timeoutMs = options.timeoutMs
    ?? (isStream ? config.upstreamStreamTimeoutMs : config.upstreamRequestTimeoutMs);

  const dispatcher = await getProxyDispatcher();
  const initWithDispatcher = dispatcher && !init.dispatcher
    ? { ...init, dispatcher }
    : init;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(input, initWithDispatcher);
  }

  const controller = new AbortController();
  const externalSignal = initWithDispatcher.signal;

  const timer = setTimeout(() => controller.abort(new Error("Upstream request timed out")), timeoutMs);
  const onExternalAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  try {
    return await fetch(input, { ...initWithDispatcher, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener?.("abort", onExternalAbort);
    }
  }
}
