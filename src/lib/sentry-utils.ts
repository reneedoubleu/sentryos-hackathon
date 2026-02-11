import * as Sentry from '@sentry/nextjs'

/**
 * Safe metric increment that falls back to breadcrumbs if metrics API is not available
 */
export function incrementMetric(
  name: string,
  value: number = 1,
  options?: { tags?: Record<string, string>; unit?: string }
) {
  try {
    // Use breadcrumb as a reliable fallback
    // The metrics API may not be fully available in all environments
    Sentry.addBreadcrumb({
      category: 'metric.counter',
      message: `${name}: +${value}`,
      level: 'info',
      data: { ...options?.tags, value, type: 'increment' },
    })
  } catch (error) {
    // Silently fail - metrics shouldn't break the app
    console.debug('Failed to record metric:', name, error)
  }
}

/**
 * Safe gauge metric that uses breadcrumbs
 */
export function gaugeMetric(
  name: string,
  value: number,
  options?: { tags?: Record<string, string>; unit?: string }
) {
  try {
    Sentry.addBreadcrumb({
      category: 'metric.gauge',
      message: `${name}: ${value}${options?.unit ? ` ${options.unit}` : ''}`,
      level: 'info',
      data: { ...options?.tags, value, type: 'gauge' },
    })
  } catch (error) {
    console.debug('Failed to record metric:', name, error)
  }
}

/**
 * Safe distribution metric that uses custom measurements and breadcrumbs
 */
export function distributionMetric(
  name: string,
  value: number,
  options?: { tags?: Record<string, string>; unit?: string }
) {
  try {
    // Use custom measurement for distributions
    Sentry.setMeasurement(name, value, options?.unit || '')

    // Also add breadcrumb for visibility
    Sentry.addBreadcrumb({
      category: 'metric.distribution',
      message: `${name}: ${value}${options?.unit ? ` ${options.unit}` : ''}`,
      level: 'info',
      data: { ...options?.tags, value, type: 'distribution' },
    })
  } catch (error) {
    console.debug('Failed to record metric:', name, error)
  }
}

/**
 * Logger wrapper with safe fallback
 */
export const logger = {
  debug: (message: string, extra?: { extra?: Record<string, unknown> }) => {
    try {
      if (typeof Sentry.logger !== 'undefined') {
        Sentry.logger.debug(message, extra)
      } else {
        console.debug(message, extra)
        Sentry.addBreadcrumb({
          category: 'log',
          message,
          level: 'debug',
          data: extra?.extra,
        })
      }
    } catch (error) {
      console.debug(message, extra)
    }
  },

  info: (message: string, extra?: { extra?: Record<string, unknown> }) => {
    try {
      if (typeof Sentry.logger !== 'undefined') {
        Sentry.logger.info(message, extra)
      } else {
        console.info(message, extra)
        Sentry.addBreadcrumb({
          category: 'log',
          message,
          level: 'info',
          data: extra?.extra,
        })
      }
    } catch (error) {
      console.info(message, extra)
    }
  },

  warn: (message: string, extra?: { extra?: Record<string, unknown> }) => {
    try {
      if (typeof Sentry.logger !== 'undefined') {
        Sentry.logger.warn(message, extra)
      } else {
        console.warn(message, extra)
        Sentry.addBreadcrumb({
          category: 'log',
          message,
          level: 'warning',
          data: extra?.extra,
        })
      }
    } catch (error) {
      console.warn(message, extra)
    }
  },

  error: (message: string, extra?: { extra?: Record<string, unknown> }) => {
    try {
      if (typeof Sentry.logger !== 'undefined') {
        Sentry.logger.error(message, extra)
      } else {
        console.error(message, extra)
        Sentry.captureMessage(message, {
          level: 'error',
          contexts: { extra: extra?.extra },
        })
      }
    } catch (error) {
      console.error(message, extra)
    }
  },
}
