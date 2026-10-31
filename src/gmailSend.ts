const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const TOKEN_KEY = 'liste-gmail-token'
const TOKEN_EXP_KEY = 'liste-gmail-token-exp'
/** Rafraîchir silencieusement quand il reste moins de 10 min */
const REFRESH_BEFORE_MS = 10 * 60 * 1000
/** Ping keep-alive toutes les 5 min */
const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: string }) => void
}

type TokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string
            scope: string
            callback: (resp: TokenResponse) => void
          }) => TokenClient
        }
      }
    }
  }
}

type GmailAuthListener = () => void
const gmailAuthListeners = new Set<GmailAuthListener>()

function notifyGmailAuthChange() {
  for (const listener of gmailAuthListeners) {
    try {
      listener()
    } catch {
      /* ignore listener errors */
    }
  }
}

export function subscribeGmailAuth(listener: GmailAuthListener): () => void {
  gmailAuthListeners.add(listener)
  return () => {
    gmailAuthListeners.delete(listener)
  }
}

function storageGet(key: string): string {
  try {
    const fromLocal = localStorage.getItem(key)
    if (fromLocal) return fromLocal
    const fromSession = sessionStorage.getItem(key)
    if (fromSession) {
      localStorage.setItem(key, fromSession)
      sessionStorage.removeItem(key)
      return fromSession
    }
  } catch {
    /* ignore */
  }
  return ''
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
    sessionStorage.removeItem(key)
  } catch {
    try {
      sessionStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
  }
}

function storageRemove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function clearStoredToken() {
  storageRemove(TOKEN_KEY)
  storageRemove(TOKEN_EXP_KEY)
  notifyGmailAuthChange()
}

function readTokenExpiry(): number {
  return Number(storageGet(TOKEN_EXP_KEY) || 0)
}

function readStoredToken(): string {
  const token = storageGet(TOKEN_KEY)
  const exp = readTokenExpiry()
  if (!token || !exp || Date.now() >= exp) {
    if (token || exp) {
      storageRemove(TOKEN_KEY)
      storageRemove(TOKEN_EXP_KEY)
      queueMicrotask(() => notifyGmailAuthChange())
    }
    return ''
  }
  return token
}

function storeToken(token: string, expiresInSec?: number) {
  const rawTtl = Number.isFinite(expiresInSec) ? Number(expiresInSec) : 3600
  // Garde 2 min de marge avant l’expiry Google
  const ttl = Math.max(120, rawTtl - 120)
  storageSet(TOKEN_KEY, token)
  storageSet(TOKEN_EXP_KEY, String(Date.now() + ttl * 1000))
  notifyGmailAuthChange()
}

export function hasGmailToken(): boolean {
  return Boolean(readStoredToken())
}

/** True si un token existe encore, ou s’il expire bientôt (keep-alive possible). */
export function hasGmailSessionHint(): boolean {
  if (readStoredToken()) return true
  const exp = readTokenExpiry()
  // Token récemment expiré (< 30 min) : une refresh silencieuse peut encore marcher
  if (exp && Date.now() - exp < 30 * 60 * 1000) return true
  return Boolean(storageGet(TOKEN_KEY))
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    )
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('gmail_script')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('gmail_script'))
    document.head.appendChild(script)
  })
}

function requestToken(clientId: string, prompt: '' | 'consent'): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google?.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'gmail_denied'))
          return
        }
        storeToken(resp.access_token, resp.expires_in)
        resolve(resp.access_token)
      },
    })
    if (!client) {
      reject(new Error('gmail_script'))
      return
    }
    client.requestAccessToken({ prompt })
  })
}

export async function connectGmail(clientId: string): Promise<{ ok: boolean; error?: string }> {
  const id = clientId.trim()
  if (!id) return { ok: false, error: 'gmail_client_missing' }
  try {
    await loadGis()
    await requestToken(id, 'consent')
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'gmail_denied'
    return { ok: false, error: msg }
  }
}

/**
 * Obtient un access token valide : cache, sinon refresh silencieuse (sans popup),
 * sinon popup consent si nécessaire.
 */
export async function ensureGmailToken(clientId: string): Promise<string> {
  const id = clientId.trim()
  if (!id) throw new Error('gmail_client_missing')
  const existing = readStoredToken()
  if (existing) return existing
  await loadGis()
  try {
    return await requestToken(id, '')
  } catch {
    return requestToken(id, 'consent')
  }
}

async function getAccessToken(clientId: string): Promise<string> {
  return ensureGmailToken(clientId)
}

/** Refresh silencieuse si le token expire bientôt. Retourne true si encore connecté. */
export async function refreshGmailTokenIfNeeded(
  clientId: string,
): Promise<boolean> {
  const id = clientId.trim()
  if (!id) return false
  const token = readStoredToken()
  const exp = readTokenExpiry()
  if (token && exp - Date.now() > REFRESH_BEFORE_MS) return true
  try {
    await loadGis()
    await requestToken(id, '')
    return true
  } catch {
    // Pas de popup ici — keep-alive uniquement silencieux
    return Boolean(readStoredToken())
  }
}

let keepAliveTimer: number | null = null
let keepAliveInFlight = false

/**
 * Ping périodique : prolonge la session Gmail tant que l’onglet est ouvert
 * et que la session Google du navigateur est encore valide.
 */
export function startGmailTokenKeepAlive(
  getClientId: () => string,
): () => void {
  const tick = () => {
    if (document.visibilityState === 'hidden') return
    const clientId = getClientId().trim()
    if (!clientId) return
    if (!hasGmailToken() && !hasGmailSessionHint()) return
    if (keepAliveInFlight) return
    keepAliveInFlight = true
    void refreshGmailTokenIfNeeded(clientId).finally(() => {
      keepAliveInFlight = false
    })
  }

  tick()
  if (keepAliveTimer != null) window.clearInterval(keepAliveTimer)
  keepAliveTimer = window.setInterval(tick, KEEPALIVE_INTERVAL_MS)

  const onVisible = () => {
    if (document.visibilityState === 'visible') tick()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', tick)

  return () => {
    if (keepAliveTimer != null) {
      window.clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', tick)
  }
}

function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value
  const utf8 = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
  return `=?UTF-8?B?${btoa(utf8)}?=`
}

function bytesToBase64(bytes: number[]): string {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk))
  }
  return btoa(binary)
}

function buildRfc822(payload: {
  to: string
  subject: string
  text: string
  attachments: Array<{ name: string; bytes: number[] }>
}): string {
  const boundary = `chevron${Date.now().toString(16)}`
  const lines = [
    `To: ${payload.to}`,
    `Subject: ${encodeMimeHeader(payload.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    payload.text,
  ]
  for (const att of payload.attachments) {
    const name = String(att.name || 'file.bin').replace(/[\r\n"]/g, '')
    const wrapped = bytesToBase64(att.bytes).replace(/(.{76})/g, '$1\r\n')
    lines.push(
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrapped,
    )
  }
  lines.push(`--${boundary}--`, '')
  return lines.join('\r\n')
}

function toBase64Url(raw: string): string {
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sendGmailMessage(payload: {
  clientId: string
  to: string
  subject: string
  text: string
  attachments?: Array<{ name: string; bytes: number[] }>
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const clientId = payload.clientId.trim()
  const to = payload.to.trim()
  if (!clientId) return { ok: false, error: 'gmail_client_missing' }
  if (!to) return { ok: false, error: 'missing_config' }
  let token: string
  try {
    token = await getAccessToken(clientId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'gmail_denied'
    return { ok: false, error: msg === 'popup_closed_by_user' ? 'gmail_denied' : msg }
  }
  const raw = toBase64Url(
    buildRfc822({
      to,
      subject: payload.subject,
      text: payload.text,
      attachments: payload.attachments ?? [],
    }),
  )
  try {
    const res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      },
    )
    const data = (await res.json().catch(() => null)) as {
      id?: string
      error?: { message?: string }
    } | null
    if (!res.ok) {
      if (res.status === 401) {
        clearStoredToken()
        // Une tentative de refresh silencieuse puis retry unique
        try {
          token = await ensureGmailToken(clientId)
          const retry = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ raw }),
            },
          )
          const retryData = (await retry.json().catch(() => null)) as {
            id?: string
            error?: { message?: string }
          } | null
          if (retry.ok) return { ok: true, messageId: retryData?.id }
          if (retry.status === 401) {
            clearStoredToken()
            return { ok: false, error: 'gmail_denied' }
          }
          return {
            ok: false,
            error: retryData?.error?.message || 'gmail_send_failed',
          }
        } catch {
          return { ok: false, error: 'gmail_denied' }
        }
      }
      return { ok: false, error: data?.error?.message || 'gmail_send_failed' }
    }
    return { ok: true, messageId: data?.id }
  } catch {
    return { ok: false, error: 'gmail_send_failed' }
  }
}
