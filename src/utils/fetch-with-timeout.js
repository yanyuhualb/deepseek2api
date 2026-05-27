import { config } from "../config.js";

export async function fetchWithTimeout(input, init = {}, options = {}) {
  const isStream = options.streaming === true;
  const timeoutMs = options.timeoutMs
    ?? (isStream ? config.upstreamStreamTimeoutMs : config.upstreamRequestTimeoutMs);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(input, init);
  }

  const controller = new AbortController();
  const externalSignal = init.signal;

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
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener?.("abort", onExternalAbort);
    }
  }
}
