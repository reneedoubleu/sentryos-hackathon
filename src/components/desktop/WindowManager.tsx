'use client'

import { useState, useCallback, createContext, useContext, ReactNode } from 'react'
import * as Sentry from '@sentry/nextjs'
import { WindowState } from './types'

interface WindowManagerContextType {
  windows: WindowState[]
  openWindow: (window: Omit<WindowState, 'zIndex' | 'isFocused'>) => void
  closeWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  maximizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  focusWindow: (id: string) => void
  updateWindowPosition: (id: string, x: number, y: number) => void
  updateWindowSize: (id: string, width: number, height: number) => void
  topZIndex: number
}

const WindowManagerContext = createContext<WindowManagerContextType | null>(null)

export function useWindowManager() {
  const context = useContext(WindowManagerContext)
  if (!context) {
    throw new Error('useWindowManager must be used within WindowManagerProvider')
  }
  return context
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WindowState[]>([])
  const [topZIndex, setTopZIndex] = useState(100)

  const openWindow = useCallback((window: Omit<WindowState, 'zIndex' | 'isFocused'>) => {
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => {
        const existing = prev.find(w => w.id === window.id)
        if (existing) {
          if (existing.isMinimized) {
            Sentry.logger.info('Window restored from minimized state', {
              extra: { window_id: window.id, window_title: window.title }
            })

            Sentry.metrics.increment('window.restore', 1, {
              tags: { window_id: window.id }
            })

            return prev.map(w =>
              w.id === window.id
                ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
                : { ...w, isFocused: false }
            )
          }

          Sentry.logger.debug('Window focused (already open)', {
            extra: { window_id: window.id, window_title: window.title }
          })

          return prev.map(w =>
            w.id === window.id
              ? { ...w, isFocused: true, zIndex: newZ }
              : { ...w, isFocused: false }
          )
        }

        Sentry.logger.info('New window opened', {
          extra: {
            window_id: window.id,
            window_title: window.title,
            width: window.width,
            height: window.height
          }
        })

        Sentry.metrics.increment('window.open', 1, {
          tags: { window_id: window.id }
        })

        const newWindowCount = prev.length + 1
        Sentry.metrics.gauge('window.active_count', newWindowCount)

        return [
          ...prev.map(w => ({ ...w, isFocused: false })),
          { ...window, zIndex: newZ, isFocused: true }
        ]
      })
      return newZ
    })
  }, [])

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.logger.info('Window closed', {
          extra: { window_id: id, window_title: window.title }
        })

        Sentry.metrics.increment('window.close', 1, {
          tags: { window_id: id }
        })

        const newWindowCount = prev.length - 1
        Sentry.metrics.gauge('window.active_count', newWindowCount)
      }

      return prev.filter(w => w.id !== id)
    })
  }, [])

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.logger.info('Window minimized', {
          extra: { window_id: id, window_title: window.title }
        })

        Sentry.metrics.increment('window.minimize', 1, {
          tags: { window_id: id }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, isMinimized: true, isFocused: false } : w
      )
    })
  }, [])

  const maximizeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        const action = window.isMaximized ? 'restore' : 'maximize'

        Sentry.logger.info(`Window ${action}d`, {
          extra: { window_id: id, window_title: window.title }
        })

        Sentry.metrics.increment(`window.${action}`, 1, {
          tags: { window_id: id }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, isMaximized: !w.isMaximized } : w
      )
    })
  }, [])

  const restoreWindow = useCallback((id: string) => {
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => prev.map(w =>
        w.id === id
          ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
          : { ...w, isFocused: false }
      ))
      return newZ
    })
  }, [])

  const focusWindow = useCallback((id: string) => {
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => prev.map(w =>
        w.id === id
          ? { ...w, isFocused: true, zIndex: newZ }
          : { ...w, isFocused: false }
      ))
      return newZ
    })
  }, [])

  const updateWindowPosition = useCallback((id: string, x: number, y: number) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.logger.debug('Window position updated', {
          extra: { window_id: id, x, y }
        })

        Sentry.metrics.increment('window.position_update', 1, {
          tags: { window_id: id }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, x, y } : w
      )
    })
  }, [])

  const updateWindowSize = useCallback((id: string, width: number, height: number) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.logger.debug('Window size updated', {
          extra: { window_id: id, width, height }
        })

        Sentry.metrics.increment('window.resize', 1, {
          tags: { window_id: id }
        })

        Sentry.metrics.gauge('window.size', width * height, {
          tags: { window_id: id }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, width, height } : w
      )
    })
  }, [])

  return (
    <WindowManagerContext.Provider value={{
      windows,
      openWindow,
      closeWindow,
      minimizeWindow,
      maximizeWindow,
      restoreWindow,
      focusWindow,
      updateWindowPosition,
      updateWindowSize,
      topZIndex
    }}>
      {children}
    </WindowManagerContext.Provider>
  )
}
