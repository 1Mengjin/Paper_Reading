import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import type { ThemeId } from '../model'

const themeColors: Record<ThemeId, { bg: string; darkIcons: boolean }> = {
  cream: { bg: '#f5efe2', darkIcons: true },
  kraft: { bg: '#eadcc3', darkIcons: true },
  sage: { bg: '#e3eee3', darkIcons: true },
  white: { bg: '#fbfbfb', darkIcons: true },
  night: { bg: '#181a1f', darkIcons: false },
}

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function syncAndroidStatusBar(theme: ThemeId): Promise<void> {
  const cfg = themeColors[theme]
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', cfg.bg)

  if (!isNativeAndroid()) return
  try {
    await StatusBar.setBackgroundColor({ color: cfg.bg })
    await StatusBar.setStyle({ style: cfg.darkIcons ? Style.Light : Style.Dark })
  } catch {
    // Ignore when status bar plugin is unavailable
  }
}

export function registerAndroidBackHandler(handler: () => boolean): () => void {
  if (!isNativeAndroid()) return () => {}
  let cleanup = () => {}
  void CapApp.addListener('backButton', () => {
    const handled = handler()
    if (!handled) {
      void CapApp.exitApp()
    }
  }).then(handle => {
    cleanup = () => {
      void handle.remove()
    }
  })
  return () => cleanup()
}
