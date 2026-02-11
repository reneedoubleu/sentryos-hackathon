import { query } from '@anthropic-ai/claude-agent-sdk'
import { logger, incrementMetric, gaugeMetric, distributionMetric } from '@/lib/sentry-utils'

const SYSTEM_PROMPT = `You are a helpful personal assistant designed to help with general research, questions, and tasks.

Your role is to:
- Answer questions on any topic accurately and thoroughly
- Help with research by searching the web for current information
- Assist with writing, editing, and brainstorming
- Provide explanations and summaries of complex topics
- Help solve problems and think through decisions

Guidelines:
- Be friendly, clear, and conversational
- Use web search when you need current information, facts you're unsure about, or real-time data
- Keep responses concise but complete - expand when the topic warrants depth
- Use markdown formatting when it helps readability (bullet points, code blocks, etc.)
- Be honest when you don't know something and offer to search for answers`

interface MessageInput {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    incrementMetric('chat.request', 1, {
      tags: { endpoint: 'chat' }
    })

    const { messages } = await request.json() as { messages: MessageInput[] }

    if (!messages || !Array.isArray(messages)) {
      logger.warn('Invalid chat request', {
        extra: { reason: 'missing_messages_array' }
      })

      incrementMetric('chat.error', 1, {
        tags: { error_type: 'validation', reason: 'missing_messages' }
      })

      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    if (!lastUserMessage) {
      logger.warn('No user message in chat request', {
        extra: { message_count: messages.length }
      })

      incrementMetric('chat.error', 1, {
        tags: { error_type: 'validation', reason: 'no_user_message' }
      })

      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Processing chat request', {
      extra: {
        message_count: messages.length,
        message_length: lastUserMessage.content.length,
        has_conversation_context: messages.length > 1
      }
    })

    gaugeMetric('chat.message_length', lastUserMessage.content.length)
    gaugeMetric('chat.conversation_depth', messages.length)

    // Build conversation context
    const conversationContext = messages
      .slice(0, -1) // Exclude the last message since we pass it as the prompt
      .map((m: MessageInput) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')

    const fullPrompt = conversationContext
      ? `${SYSTEM_PROMPT}\n\nPrevious conversation:\n${conversationContext}\n\nUser: ${lastUserMessage.content}`
      : `${SYSTEM_PROMPT}\n\nUser: ${lastUserMessage.content}`

    // Create a streaming response
    const encoder = new TextEncoder()
    let toolUseCount = 0
    let textChunkCount = 0

    const stream = new ReadableStream({
      async start(controller) {
        try {
          logger.debug('Starting Claude Agent SDK query', {
            extra: { max_turns: 10 }
          })

          // Use the claude-agent-sdk query function with all default tools enabled
          for await (const message of query({
            prompt: fullPrompt,
            options: {
              maxTurns: 10,
              // Use the preset to enable all Claude Code tools including WebSearch
              tools: { type: 'preset', preset: 'claude_code' },
              // Bypass all permission checks for automated tool execution
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              // Enable partial messages for real-time text streaming
              includePartialMessages: true,
              // Set working directory to the app's directory for sandboxing
              cwd: process.cwd(),
            }
          })) {
            // Handle streaming text deltas (partial messages)
            if (message.type === 'stream_event' && 'event' in message) {
              const event = message.event
              // Handle content block delta events for text streaming
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                textChunkCount++
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: 'text_delta', text: event.delta.text })}\n\n`
                ))
              }
            }

            // Send tool start events from assistant messages
            if (message.type === 'assistant' && 'message' in message) {
              const content = message.message?.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_use') {
                    toolUseCount++
                    logger.debug('Tool invoked', {
                      extra: { tool_name: block.name }
                    })

                    incrementMetric('chat.tool_use', 1, {
                      tags: { tool: block.name }
                    })

                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ type: 'tool_start', tool: block.name })}\n\n`
                    ))
                  }
                }
              }
            }

            // Send tool progress updates
            if (message.type === 'tool_progress') {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_progress', tool: message.tool_name, elapsed: message.elapsed_time_seconds })}\n\n`
              ))
            }

            // Signal completion
            if (message.type === 'result' && message.subtype === 'success') {
              const duration = Date.now() - startTime

              logger.info('Chat request completed successfully', {
                extra: {
                  duration_ms: duration,
                  tool_use_count: toolUseCount,
                  text_chunks: textChunkCount
                }
              })

              distributionMetric('chat.response_time', duration, {
                unit: 'millisecond',
                tags: { status: 'success' }
              })

              gaugeMetric('chat.tool_use_count', toolUseCount)
              gaugeMetric('chat.text_chunks', textChunkCount)

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'done' })}\n\n`
              ))
            }

            // Handle errors
            if (message.type === 'result' && message.subtype !== 'success') {
              const duration = Date.now() - startTime

              logger.error('Chat query did not complete successfully', {
                extra: {
                  duration_ms: duration,
                  subtype: message.subtype
                }
              })

              incrementMetric('chat.error', 1, {
                tags: { error_type: 'query_failed', subtype: message.subtype }
              })

              distributionMetric('chat.response_time', duration, {
                unit: 'millisecond',
                tags: { status: 'error' }
              })

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Query did not complete successfully' })}\n\n`
              ))
            }
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          const duration = Date.now() - startTime

          logger.error('Stream error occurred', {
            extra: {
              error: error instanceof Error ? error.message : String(error),
              duration_ms: duration,
              tool_use_count: toolUseCount,
              text_chunks: textChunkCount
            }
          })

          incrementMetric('chat.error', 1, {
            tags: { error_type: 'stream_error' }
          })

          distributionMetric('chat.response_time', duration, {
            unit: 'millisecond',
            tags: { status: 'stream_error' }
          })

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`
          ))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('Chat API request failed', {
      extra: {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: duration
      }
    })

    incrementMetric('chat.error', 1, {
      tags: { error_type: 'request_failed' }
    })

    distributionMetric('chat.response_time', duration, {
      unit: 'millisecond',
      tags: { status: 'failed' }
    })

    return new Response(
      JSON.stringify({ error: 'Failed to process chat request. Check server logs for details.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
