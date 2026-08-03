/**
 * Fetch wrapper for the copilot API.
 *
 * Auth model: a session cookie issued by the backend. Inside HighLevel the
 * session comes from the GHL context exchange; standalone, an unauthenticated
 * request bounces to the /login gate.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })

  if (response.status === 401 && window.location.pathname !== '/login') {
    // Session expired or absent — send the user to the gate, remembering
    // where they were. A hard navigation keeps this free of router coupling.
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`)
  }
  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, body)
  }
  return (await response.json()) as T
}

export async function login(email: string, password: string): Promise<void> {
  const response = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(response.status, body?.error ?? 'Sign-in failed')
  }
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
}

/** Establish a session from the GHL iframe context, if we are embedded. */
export async function bootstrapGhlSession(): Promise<void> {
  if (window === window.parent) return // not iframed — dev fallback will kick in
  try {
    // GHL Custom Pages hand back an *encrypted* payload via
    // REQUEST_USER_DATA_RESPONSE — the parent never sends plain fields.
    // We forward the ciphertext as-is; the backend decrypts it with the
    // app's Shared Secret (GHL_SSO_KEY) and figures out the location id.
    const encryptedPayload = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 1500)
      window.addEventListener(
        'message',
        (event: MessageEvent) => {
          const data = event.data as { message?: string; payload?: string } | undefined
          if (data?.message === 'REQUEST_USER_DATA_RESPONSE' && data.payload) {
            clearTimeout(timer)
            resolve(data.payload)
          }
        },
        { once: true },
      )
      window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
    })
    if (encryptedPayload) {
      await fetch('/auth/sso', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: encryptedPayload }),
      })
    }
  } catch {
    // Fall through — the dev-session fallback or an explicit error state covers it.
  }
}
