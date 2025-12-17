import { HandlerContextWithPath } from '../../types'

interface BulkQueueRequest {
  entities: Array<{
    entity: {
      entityId: string
      authChain: any[]
    }
    contentServerUrls?: string[]
  }>
  prioritize?: boolean
}

interface BulkQueueResult {
  success: string[]
  failed: Array<{ entityId: string; error: string }>
}

// Handler for bulk queue operations - accepts multiple entities at once
export async function addQueueBulkHandler(
  context: HandlerContextWithPath<'sceneSnsAdapter' | 'prioritySceneSnsAdapter' | 'config' | 'logs', '/queue-tasks'>
) {
  const {
    components: { sceneSnsAdapter, prioritySceneSnsAdapter, config, logs },
    request
  } = context

  const logger = logs.getLogger('queue-bulk')

  if (request.headers.get('Authorization') !== (await config.requireString('TMP_SECRET')))
    return { status: 401, body: 'Unauthorized' }

  const body = (await request.json()) as BulkQueueRequest

  // Validate request
  if (!body.entities || !Array.isArray(body.entities) || body.entities.length === 0) {
    return { status: 400, body: { error: 'Missing or invalid entities array' } }
  }

  const shouldPrioritize = !!body.prioritize
  const adapter = shouldPrioritize ? prioritySceneSnsAdapter : sceneSnsAdapter

  if (!adapter) {
    return {
      status: 500,
      body: { error: shouldPrioritize ? 'Missing priority scene sns configuration' : 'Missing scene sns configuration' }
    }
  }

  const results: BulkQueueResult = {
    success: [],
    failed: []
  }

  logger.info('Processing bulk queue request', {
    count: body.entities.length,
    prioritize: shouldPrioritize ? 'true' : 'false'
  })

  // Process all entities
  for (const item of body.entities) {
    const entityId = item.entity?.entityId

    if (!entityId) {
      results.failed.push({ entityId: 'unknown', error: 'Missing entityId' })
      continue
    }

    try {
      await adapter.publish({
        entity: item.entity,
        contentServerUrls: item.contentServerUrls || ['https://peer.decentraland.org/content']
      })
      results.success.push(entityId)
    } catch (error: any) {
      logger.error('Failed to publish entity', { entityId, error: error.message })
      results.failed.push({ entityId, error: error.message })
    }
  }

  logger.info('Bulk queue request completed', {
    total: body.entities.length,
    success: results.success.length,
    failed: results.failed.length
  })

  return {
    status: 200,
    body: {
      success: true,
      total: body.entities.length,
      queued: results.success.length,
      failed: results.failed.length,
      results
    }
  }
}
