import { domToPng } from 'modern-screenshot'

const CAPTURE_TIMEOUT_MS = 12_000

/** Supprime tout calque de capture orphelin qui pourrait bloquer les clics. */
export function purgeCaptureHosts(): void {
  document
    .querySelectorAll('[data-capture-host]')
    .forEach((node) => node.remove())
}

function clearInlinePointerEvents(root: ParentNode): void {
  const clear = (node: HTMLElement) => {
    if (node.closest('[data-capture-host]')) return
    if (node.style.getPropertyValue('pointer-events') === 'none') {
      node.style.removeProperty('pointer-events')
    }
  }
  if (root instanceof HTMLElement) clear(root)
  root.querySelectorAll<HTMLElement>('[style*="pointer-events"]').forEach(clear)
}

function unlockLiveUi(): void {
  document.body?.removeAttribute('inert')
  document.documentElement.removeAttribute('inert')
  document.getElementById('root')?.removeAttribute('inert')

  if (document.body.style.pointerEvents === 'none') {
    document.body.style.pointerEvents = ''
  }
  if (document.documentElement.style.pointerEvents === 'none') {
    document.documentElement.style.pointerEvents = ''
  }

  const liveRoot = document.getElementById('root')
  if (liveRoot) clearInlinePointerEvents(liveRoot)
}

function liveUiLooksBlocked(): boolean {
  return Boolean(
    document.querySelector('[data-capture-host]') ||
      document.body?.hasAttribute('inert') ||
      document.documentElement.hasAttribute('inert') ||
      document.body.style.pointerEvents === 'none' ||
      document.documentElement.style.pointerEvents === 'none',
  )
}

function purgeUiBlockers(): void {
  purgeCaptureHosts()

  document
    .querySelectorAll('.list-capture-share.is-capturing')
    .forEach((node) => node.classList.remove('is-capturing'))

  unlockLiveUi()
}

/**
 * Remet l’UI cliquable après capture / dialogue natif / perte de focus.
 * Ne change aucune logique métier — nettoyage défensif uniquement.
 */
export function restoreUiInteractivity(): void {
  purgeUiBlockers()
}

let watchdogInstalled = false

/**
 * Nettoie un calque de capture orphelin sans voler le focus (sinon pas de sélection).
 */
export function installUiInteractivityWatchdog(): () => void {
  if (watchdogInstalled) return () => {}
  watchdogInstalled = true

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target
    if (target instanceof HTMLElement) {
      const captureHost = target.closest('[data-capture-host]')
      if (captureHost) {
        captureHost.remove()
        return
      }
    }

    /* Ne pas appeler focus() ici : ça annule le drag de sélection de texte. */
    if (liveUiLooksBlocked()) unlockLiveUi()
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    watchdogInstalled = false
  }
}

function forceNoPointerEvents(root: HTMLElement) {
  root.style.setProperty('pointer-events', 'none', 'important')
  root.querySelectorAll<HTMLElement>('*').forEach((node) => {
    node.style.setProperty('pointer-events', 'none', 'important')
  })
}

/**
 * Capture un nœud DOM en PNG sans recouvrir l’UI.
 * Le clone est placé hors écran ; timeout + nettoyage garantis.
 */
export async function captureElementToPng(
  source: HTMLElement,
  options?: {
    minWidth?: number
    prepareClone?: (clone: HTMLElement) => void
  },
): Promise<string | null> {
  purgeCaptureHosts()

  const host = document.createElement('div')
  host.setAttribute('data-capture-host', '1')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = [
    'position:fixed',
    'left:-20000px',
    'top:0',
    'z-index:-1',
    'background:#ffffff',
    'padding:0',
    'margin:0',
    'opacity:1',
    'filter:none',
    'pointer-events:none',
    'transform:translateX(-20000px)',
    'overflow:hidden',
  ].join(';')

  const clone = source.cloneNode(true) as HTMLElement
  const minWidth = options?.minWidth ?? 720
  clone.style.width = `${Math.max(source.scrollWidth, source.clientWidth, minWidth)}px`
  clone.style.maxWidth = 'none'
  clone.style.height = 'auto'
  clone.style.maxHeight = 'none'
  clone.style.overflow = 'visible'
  clone.style.opacity = '1'
  clone.style.filter = 'none'
  clone.style.background = '#ffffff'
  clone.style.boxShadow = 'none'
  clone.style.border = 'none'
  clone.style.transform = 'none'
  clone.style.contain = 'none'
  clone.style.left = '0'
  clone.style.top = '0'

  clone.querySelectorAll<HTMLElement>('*').forEach((node) => {
    node.style.animation = 'none'
    node.style.transition = 'none'
  })

  options?.prepareClone?.(clone)
  forceNoPointerEvents(host)
  forceNoPointerEvents(clone)

  host.appendChild(clone)
  document.body.appendChild(host)

  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    host.remove()
    purgeCaptureHosts()
  }, CAPTURE_TIMEOUT_MS)

  try {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    if (timedOut || !host.isConnected) return null

    const dataUrl = await domToPng(clone, {
      backgroundColor: '#ffffff',
      scale: Math.min(2, window.devicePixelRatio || 2),
      quality: 1,
      style: {
        opacity: '1',
        filter: 'none',
        transform: 'none',
      },
    })
    if (timedOut) return null
    return dataUrl
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
    host.remove()
    restoreUiInteractivity()
  }
}
