import type { Session } from "@supabase/supabase-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The module under test holds state at module scope (sessionCache,
// isListenerAttached, inFlightSessionPromise). Each test re-imports it fresh
// via vi.resetModules() so that state never leaks between cases.

// Hoisted mock handles so vi.mock (hoisted) and the tests share the same fns.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(
    (_cb: (event: string, session: Session | null) => void) => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
  ),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
  },
}))

// Fresh import of the module under test after resetting the registry.
async function loadCache() {
  vi.resetModules()
  return import("@/lib/auth-session-cache")
}

// nowSec = current time in seconds; expiry offset in seconds from now.
function makeSession(expiresInSec: number, overrides: Partial<Session> = {}): Session {
  return {
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    token_type: "bearer",
    expires_in: expiresInSec,
    user: { id: "user-1" } as Session["user"],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("getAuthHeaderTokens", () => {
  it("returns access + refresh token from a live session", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: makeSession(3600) },
      error: null,
    })
    const cache = await loadCache()

    const tokens = await cache.getAuthHeaderTokens()

    expect(tokens).toEqual({ accessToken: "access-abc", refreshToken: "refresh-xyz" })
  })

  it("returns nulls when there is no session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const cache = await loadCache()

    const tokens = await cache.getAuthHeaderTokens()

    expect(tokens).toEqual({ accessToken: null, refreshToken: null })
  })
})

describe("caching + in-flight dedupe", () => {
  it("only calls supabase.getSession once for two concurrent callers", async () => {
    let resolve!: (v: unknown) => void
    mocks.getSession.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const cache = await loadCache()

    const p1 = cache.getSessionWithCacheResult()
    const p2 = cache.getSessionWithCacheResult()
    resolve({ data: { session: makeSession(3600) }, error: null })
    await Promise.all([p1, p2])

    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })

  it("serves cached session without re-hitting supabase", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: makeSession(3600) },
      error: null,
    })
    const cache = await loadCache()

    await cache.getSessionWithCacheResult()
    await cache.getSessionWithCacheResult()

    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })
})

describe("proactive refresh near expiry", () => {
  it("force-refreshes when the session expires within the 60s margin", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-09T00:00:00Z"))
    // First call: session expiring in 30s (< 60s margin). Second (forced): fresh.
    mocks.getSession
      .mockResolvedValueOnce({ data: { session: makeSession(30) }, error: null })
      .mockResolvedValueOnce({ data: { session: makeSession(3600) }, error: null })
    const cache = await loadCache()

    await cache.getAuthHeaderTokens()

    // one initial fetch + one forced refresh
    expect(mocks.getSession).toHaveBeenCalledTimes(2)
  })

  it("does NOT refresh when the session is comfortably fresh", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-09T00:00:00Z"))
    mocks.getSession.mockResolvedValue({
      data: { session: makeSession(3600) },
      error: null,
    })
    const cache = await loadCache()

    await cache.getAuthHeaderTokens()

    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })
})

describe("onAuthStateChange listener", () => {
  it("attaches exactly one listener across many calls (module singleton)", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const cache = await loadCache()

    cache.ensureAuthSessionCache()
    cache.ensureAuthSessionCache()
    await cache.getAuthHeaderTokens()

    expect(mocks.onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it("updates the cache when auth state changes", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const cache = await loadCache()
    cache.ensureAuthSessionCache()

    // Grab the callback supabase was handed, then fire it with a new session.
    const onChange = mocks.onAuthStateChange.mock.calls[0][0]
    onChange("SIGNED_IN", makeSession(3600))

    expect(cache.hasCachedSession()).toBe(true)
    expect(cache.getCachedSession()?.access_token).toBe("access-abc")
  })
})
