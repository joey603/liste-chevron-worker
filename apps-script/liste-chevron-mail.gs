/**
 * Relais mail Liste Chevron (Google Apps Script).
 *
 * Setup:
 * 1. https://script.google.com → Nouveau projet → coller ce fichier
 * 2. Projet → Paramètres → Propriétés du script → ajouter MAIL_SECRET
 *    (longue clé au hasard, la même que dans Liste Chevron)
 * 3. Déployer → Nouvelle déploiement → Type: Application Web
 *    - Exécuter en tant que: Moi
 *    - Qui peut y accéder: Tout le monde
 * 4. Copier l’URL …/exec dans les réglages Liste Chevron + la clé MAIL_SECRET
 *
 * Le navigateur envoie Content-Type: text/plain (évite les soucis CORS).
 */

function doPost(e) {
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('MAIL_SECRET') || ''
    if (!secret) {
      return json_({ ok: false, error: 'relay_not_configured' })
    }
    const raw = (e && e.postData && e.postData.contents) || ''
    if (!raw) return json_({ ok: false, error: 'invalid_json' })
    const body = JSON.parse(raw)
    if (String(body.secret || '') !== secret) {
      return json_({ ok: false, error: 'unauthorized' })
    }

    const to = String(body.to || '').trim()
    const subject = String(body.subject || 'Liste Chevron')
    const text = String(body.text || '')
    if (!to) return json_({ ok: false, error: 'missing_config' })

    const options = {
      name: 'Liste Chevron',
      htmlBody: text.replace(/\n/g, '<br>'),
    }

    const attachments = Array.isArray(body.attachments) ? body.attachments : []
    if (attachments.length) {
      options.attachments = attachments.map(function (att) {
        const name = String(att.name || 'file.bin')
        const b64 = String(att.base64 || '')
        const bytes = Utilities.base64Decode(b64)
        return Utilities.newBlob(bytes, guessMime_(name), name)
      })
    }

    GmailApp.sendEmail(to, subject, text, options)
    return json_({ ok: true, messageId: 'apps-script' })
  } catch (err) {
    return json_({
      ok: false,
      error: err && err.message ? String(err.message) : 'relay_failed',
    })
  }
}

function doGet() {
  return json_({
    ok: true,
    service: 'liste-chevron-apps-script-mail',
    message: 'Relais mail OK. Utilisez POST JSON (text/plain).',
  })
}

function guessMime_(name) {
  const lower = String(name).toLowerCase()
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}
