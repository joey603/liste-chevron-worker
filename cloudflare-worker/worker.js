/**
 * Relais gratuit Telegram + e-mail pour Liste Chevron.
 * Secret Cloudflare à créer : ACCESS_KEY
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Key',
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }
    if (request.method === 'GET') {
      return json({
        ok: true,
        service: 'liste-chevron-relay',
        message: 'Le relais fonctionne. Telegram et e-mail passent par POST.',
      })
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405)
    }
    const key = request.headers.get('X-Relay-Key') || ''
    if (!env.ACCESS_KEY) {
      return json({ ok: false, error: 'relay_not_configured' }, 500)
    }
    if (!key || key !== env.ACCESS_KEY) {
      return json({ ok: false, error: 'unauthorized' }, 401)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400)
    }

    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      if (path === '/telegram/text' || path === '/telegram/text/') {
        return json(await sendTelegramText(body))
      }
      if (path === '/telegram/photo' || path === '/telegram/photo/') {
        return json(await sendTelegramPhoto(body))
      }
      if (path === '/email' || path === '/email/') {
        return json(await sendEmail(body))
      }
      return json({ ok: false, error: 'unknown_path' }, 404)
    } catch (err) {
      return json({
        ok: false,
        error: err instanceof Error ? err.message : 'relay_failed',
      })
    }
  },
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function sendTelegramText(body) {
  const token = String(body.token || '').trim()
  const chatId = String(body.chatId || '').trim()
  const text = String(body.text || '').trim()
  if (!token || !chatId) return { ok: false, error: 'telegram_not_configured' }
  if (!text) return { ok: false, error: 'failed' }

  const chunks = splitTelegram(text)
  for (const chunk of chunks) {
    const sent = await telegramJson(token, 'sendMessage', {
      chat_id: chatId,
      text: chunk,
    })
    if (!sent.ok) return sent
  }
  return { ok: true }
}

async function sendTelegramPhoto(body) {
  const token = String(body.token || '').trim()
  const chatId = String(body.chatId || '').trim()
  const imageDataUrl = String(body.imageDataUrl || '').trim()
  const caption = String(body.caption || '').trim()
  if (!token || !chatId) return { ok: false, error: 'telegram_not_configured' }
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(imageDataUrl)
  if (!match) return { ok: false, error: 'failed' }

  const bytes = base64ToBytes(match[2])
  const form = new FormData()
  form.append('chat_id', chatId)
  if (caption) form.append('caption', caption.slice(0, 1024))
  form.append(
    'photo',
    new Blob([bytes], { type: match[1] }),
    match[1].includes('png') ? 'photo.png' : 'photo.jpg',
  )

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  })
  return parseTelegram(await res.text())
}

async function telegramJson(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseTelegram(await res.text())
}

function parseTelegram(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed.ok) return { ok: true }
    return { ok: false, error: parsed.description || 'telegram_failed' }
  } catch {
    return { ok: false, error: 'telegram_failed' }
  }
}

function splitTelegram(message) {
  const chunks = []
  let rest = message
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf('\n', 4000)
    if (cut < 1000) cut = 4000
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)
  return chunks
}

function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function sendEmail(body) {
  const host = String(body.smtpHost || '').trim()
  const port = Number(body.smtpPort) || 587
  const user = String(body.smtpUser || '').trim()
  const pass = String(body.smtpPass || '')
  const to = String(body.directorEmail || body.to || '').trim()
  const subject = String(body.subject || 'Liste Chevron')
  const text = String(body.text || '')
  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  if (!host || !user || !pass || !to) {
    return { ok: false, error: 'missing_config' }
  }

  const from = user
  const mime = buildMime({ from, to, subject, text, attachments })
  await smtpSend({ host, port, user, pass, from, to, mime })
  return { ok: true }
}

function encodeHeader(value) {
  if (/^[\x20-\x7E]*$/.test(value)) return value
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`
}

function buildMime({ from, to, subject, text, attachments }) {
  const boundary = `chevron${Date.now().toString(16)}`
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ]
  for (const att of attachments) {
    const name = String(att.name || 'fichier.bin').replace(/[\r\n"]/g, '')
    const bytes = Array.isArray(att.bytes) ? att.bytes : []
    const b64 = bytesToBase64(bytes)
    const wrapped = b64.replace(/(.{76})/g, '$1\r\n')
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

function bytesToBase64(bytes) {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk))
  }
  return btoa(binary)
}

async function smtpSend({ host, port, user, pass, from, to, mime }) {
  const { connect } = await import('cloudflare:sockets')
  const useSsl = port === 465
  const socket = connect(
    { hostname: host, port },
    { secureTransport: useSsl ? 'on' : 'starttls' },
  )

  let reader = socket.readable.getReader()
  let writer = socket.writable.getWriter()
  const enc = new TextEncoder()
  let leftover = ''

  const read = async () => {
    const res = await readResponse(reader, leftover)
    leftover = res.leftover
    return { code: res.code, text: res.text }
  }
  const write = async (line) => {
    await writer.write(enc.encode(`${line}\r\n`))
  }
  const expect = async (okCodes) => {
    const res = await read()
    if (!okCodes.includes(res.code)) {
      throw new Error(res.text || `smtp_${res.code}`)
    }
    return res
  }

  await expect([220])
  await write(`EHLO liste-chevron`)
  let ehlo = await expect([250])

  if (!useSsl && /STARTTLS/i.test(ehlo.text)) {
    await write('STARTTLS')
    await expect([220])
    reader.releaseLock()
    writer.releaseLock()
    const tls = socket.startTls()
    reader = tls.readable.getReader()
    writer = tls.writable.getWriter()
    leftover = ''
    await write(`EHLO liste-chevron`)
    ehlo = await expect([250])
  }

  await write(`AUTH LOGIN`)
  await expect([334])
  await write(btoa(user))
  await expect([334])
  await write(btoa(pass))
  await expect([235, 503])

  await write(`MAIL FROM:<${from}>`)
  await expect([250])
  await write(`RCPT TO:<${to}>`)
  await expect([250, 251])
  await write('DATA')
  await expect([354])
  await writer.write(enc.encode(`${mime.replace(/^\./gm, '..')}\r\n.\r\n`))
  await expect([250])
  await write('QUIT')
  try {
    await read()
  } catch {
    /* ignore */
  }
  try {
    writer.releaseLock()
    reader.releaseLock()
    socket.close()
  } catch {
    /* ignore */
  }
}

async function readResponse(reader, leftover) {
  let buf = leftover
  for (;;) {
    const done = parseSmtp(buf)
    if (done) return done
    const { value, done: streamDone } = await reader.read()
    if (streamDone) throw new Error('smtp_closed')
    buf += new TextDecoder().decode(value)
  }
}

function parseSmtp(buf) {
  const lines = buf.replace(/\r\n/g, '\n').split('\n')
  const collected = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const m = /^(\d{3})([ -])(.*)$/.exec(line)
    if (!m) {
      if (i === lines.length - 1) return null
      continue
    }
    collected.push(line)
    if (m[2] === ' ') {
      const idx = buf.indexOf(line)
      if (idx < 0) return null
      let end = idx + line.length
      if (buf[end] === '\r') end += 1
      if (buf[end] === '\n') end += 1
      return {
        code: Number(m[1]),
        text: collected.join('\n'),
        leftover: buf.slice(end),
      }
    }
  }
  return null
}
