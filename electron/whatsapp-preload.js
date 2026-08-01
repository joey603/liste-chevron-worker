/**
 * WhatsApp Web bloque Electron et affiche "Télécharger Chrome".
 * Expose un objet chrome minimal + vendor Google.
 */
try {
  Object.defineProperty(navigator, 'vendor', {
    get: function () {
      return 'Google Inc.'
    },
    configurable: true,
  })
} catch (_) {
  /* ignore */
}

if (typeof globalThis.chrome === 'undefined') {
  globalThis.chrome = {
    runtime: {},
    app: { isInstalled: false },
    csi: function () {
      return {}
    },
    loadTimes: function () {
      return {}
    },
  }
}
