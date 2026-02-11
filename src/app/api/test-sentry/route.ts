import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'

export async function GET() {
  console.log('[Test Sentry] API called')
  console.log('[Test Sentry] DSN:', process.env.NEXT_PUBLIC_SENTRY_DSN ? 'Present' : 'Missing')

  // Check if Sentry is initialized
  const client = Sentry.getClient()
  console.log('[Test Sentry] Sentry client:', client ? 'Initialized' : 'NOT initialized')

  if (client) {
    const options = client.getOptions()
    console.log('[Test Sentry] Sentry DSN from client:', options.dsn ? 'Configured' : 'Missing')
    console.log('[Test Sentry] Sentry debug mode:', options.debug)
  }

  try {
    // Send a test message
    Sentry.captureMessage('Test message from SentryOS', {
      level: 'info',
      tags: { test: 'true', source: 'api' }
    })

    console.log('[Test Sentry] Message sent')

    // Send a test error
    Sentry.captureException(new Error('Test error from SentryOS'), {
      tags: { test: 'true', source: 'api' }
    })

    console.log('[Test Sentry] Error sent')

    // Add a breadcrumb
    Sentry.addBreadcrumb({
      category: 'test',
      message: 'Test breadcrumb',
      level: 'info',
    })

    console.log('[Test Sentry] Breadcrumb added')

    return NextResponse.json({
      success: true,
      message: 'Sentry test events sent',
      dsnConfigured: !!process.env.NEXT_PUBLIC_SENTRY_DSN
    })
  } catch (error) {
    console.error('[Test Sentry] Error:', error)
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 })
  }
}
