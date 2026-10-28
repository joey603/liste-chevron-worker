const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const TOKEN_KEY = 'liste-gmail-token'
const TOKEN_EXP_KEY = 'liste-gmail-token-exp'

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string
            scope: string
            callback: (resp: { access_token?: string; error?: string }) => void
          }) => TokenClient
        }
      }
    }
  }
}

function readStoredToken(): string {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? ''
  const exp = Number(sessionStorage.getItem(TOKEN_EXP_KEY) ?? 0)
  if (!token || !exp || Date.now() >= exp) {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_EXP_KEY)
    return ''
  }
  return token
}

function storeToken(token: string, expiresInSec?: number) {
  const ttl = Math.max(60, (expiresInSec ?? 3600) - 60)
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + ttl * 1000))
}

export function hasGmailToken(): boolean {
  return Boolean(readStoredToken())
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
        storeToken(resp.access_token)
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

async function getAccessToken(clientId: string): Promise<string> {
  const existing = readStoredToken()
  if (existing) return existing
  await loadGis()
  try {
    return await requestToken(clientId, '')
  } catch {
    return requestToken(clientId, 'consent')
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
        sessionStorage.removeItem(TOKEN_KEY)
        sessionStorage.removeItem(TOKEN_EXP_KEY)
        return { ok: false, error: 'gmail_denied' }
      }
      return { ok: false, error: data?.error?.message || 'gmail_send_failed' }
    }
    return { ok: true, messageId: data?.id }
  } catch {
    return { ok: false, error: 'gmail_send_failed' }
  }
}
