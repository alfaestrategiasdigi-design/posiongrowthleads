const AUTH_TIMEOUT_MS = 12_000;

// Password sign-in can legitimately take longer while the hosted auth service
// is warming up. Keep this separate from lightweight session checks so the UI
// does not report a false connection failure while the login is still running.
export const LOGIN_TIMEOUT_MS = 45_000;

export class AuthTimeoutError extends Error {
  constructor() {
    super("AUTH_TIMEOUT");
    this.name = "AuthTimeoutError";
  }
}

export function withAuthTimeout<T>(promise: PromiseLike<T>, timeoutMs = AUTH_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new AuthTimeoutError()), timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function clearStoredAuthSession() {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith("sb-") && key.endsWith("-auth-token")) keys.push(key);
  }
  keys.forEach((key) => window.localStorage.removeItem(key));
}

export function hasMalformedStoredAuthSession() {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) continue;

    try {
      const stored = JSON.parse(rawValue) as { access_token?: unknown };
      if (typeof stored.access_token !== "string" || stored.access_token.split(".").length !== 3) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

export function isNetworkAuthError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    error instanceof AuthTimeoutError ||
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("timeout")
  );
}

export function isInvalidSessionError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("jwt") || message.includes("token") || message.includes("session");
}