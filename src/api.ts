import type { DrcheckResult } from "./render.js";

/**
 * The two calls the CLI makes to domainrating.lol: look a domain up, and list
 * it when it is not there yet. Both answer with the same shape.
 */

export const DEFAULT_API_URL = "https://domainrating.lol";

/** A lookup is one indexed read on the other end. */
const LOOKUP_TIMEOUT_MS = 20_000;
/** Listing renders the site and asks a model about it; the server allows 120s. */
const CREATE_TIMEOUT_MS = 150_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  baseUrl: string;
  userAgent: string;
}

async function call(
  url: string,
  init: RequestInit & { timeoutMs: number },
  options: ApiOptions,
): Promise<{ status: number; body: unknown }> {
  const host = new URL(options.baseUrl).host;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        "user-agent": options.userAgent,
        ...init.headers,
      },
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "the request timed out"
        : error instanceof Error
          ? ((error.cause as Error | undefined)?.message ?? error.message)
          : String(error);
    throw new ApiError(`Could not reach ${host}: ${reason}.`, 0, "network");
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(
      `${host} answered with something that is not JSON (HTTP ${response.status}).`,
      response.status,
      "bad_response",
    );
  }
  return { status: response.status, body };
}

function failure(status: number, body: unknown, host: string): ApiError {
  const { error, code } = (body ?? {}) as { error?: unknown; code?: unknown };
  return new ApiError(
    typeof error === "string" && error
      ? error
      : `${host} answered with HTTP ${status}.`,
    status,
    typeof code === "string" ? code : undefined,
  );
}

function isResult(body: unknown): body is DrcheckResult {
  const value = body as DrcheckResult | null;
  return (
    typeof value?.domain === "string" &&
    typeof value.listing?.url === "string" &&
    (value.rating === null || typeof value.rating?.dr === "number")
  );
}

function expectResult(status: number, body: unknown, host: string) {
  if (!isResult(body))
    throw new ApiError(
      `${host} answered in a shape this version of drcheck does not understand. Try the latest: npx drcheck@latest`,
      status,
      "bad_response",
    );
  return body;
}

/** The listing's figures, or null when the domain is not on the ranking. */
export async function lookup(
  domain: string,
  options: ApiOptions,
): Promise<DrcheckResult | null> {
  const url = new URL("/api/drcheck", options.baseUrl);
  url.searchParams.set("domain", domain);
  const { status, body } = await call(
    url.toString(),
    { method: "GET", timeoutMs: LOOKUP_TIMEOUT_MS },
    options,
  );
  const host = url.host;
  if (
    status === 404 &&
    (body as { code?: unknown } | null)?.code === "not_listed"
  )
    return null;
  if (status !== 200) throw failure(status, body, host);
  return expectResult(status, body, host);
}

/** List the domain (locked) and answer with its figures. */
export async function create(
  domain: string,
  options: ApiOptions,
): Promise<DrcheckResult> {
  const url = new URL("/api/drcheck", options.baseUrl);
  const { status, body } = await call(
    url.toString(),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain }),
      timeoutMs: CREATE_TIMEOUT_MS,
    },
    options,
  );
  if (status !== 200 && status !== 201) throw failure(status, body, url.host);
  return expectResult(status, body, url.host);
}
