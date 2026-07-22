// Minimal fetch wrapper for the FastAPI backend.
// Base URL is configurable via NEXT_PUBLIC_API_URL (see .env.example).

import axios, { AxiosHeaders } from "axios"

import { getAuthHeaderTokens } from "@/lib/auth-session-cache"
import { supabase } from "@/lib/supabase"

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// Axios instance for the FastAPI backend. A request interceptor attaches the
// Supabase access token (and refresh token) from the cached session — same
// contract as harmony-desktop's fragment-api-client: no session → no header,
// protected routes 401. Query hooks use this; mutations still use apiFetch.
export const apiClient = axios.create({ baseURL: API_BASE_URL })

apiClient.interceptors.request.use(async (config) => {
  const { accessToken, refreshToken } = await getAuthHeaderTokens()

  if (accessToken) {
    if (config.headers) {
      config.headers.Authorization = `Bearer ${accessToken}`
      if (refreshToken) {
        config.headers["x-refresh-token"] = refreshToken
      }
    } else {
      const headers = new AxiosHeaders()
      headers.set("Authorization", `Bearer ${accessToken}`)
      if (refreshToken) {
        headers.set("x-refresh-token", refreshToken)
      }
      config.headers = headers
    }
  }

  return config
})

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  // Attach the Supabase access token so the backend can verify the caller and
  // scope queries by user_id (see backend app/core/auth.py). No session → no
  // header, and protected routes will 401.
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${res.status} ${res.statusText}: ${body}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
