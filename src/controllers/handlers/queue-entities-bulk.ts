import { HandlerContextWithPath } from '../../types'

type EntityType = 'scene' | 'wearable' | 'emote'

interface BulkQueueRequest {
  entities: Array<{
    entity: {
      entityId: string
      entityType?: EntityType
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
  context: HandlerContextWithPath<'sceneSnsAdapter' | 'prioritySceneSnsAdapter' | 'wearableSnsAdapter' | 'emoteSnsAdapter' | 'config' | 'logs', '/queue-tasks'>
) {
  const {
    components: { sceneSnsAdapter, prioritySceneSnsAdapter, wearableSnsAdapter, emoteSnsAdapter, config, logs },
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

  const results: BulkQueueResult = {
    success: [],
    failed: []
  }

  logger.info('Processing bulk queue request', {
    count: body.entities.length,
    prioritize: shouldPrioritize ? 'true' : 'false'
  })

  // Process all entities - route based on entityType
  for (const item of body.entities) {
    const entityId = item.entity?.entityId
    const entityType: EntityType = item.entity?.entityType || 'scene'

    if (!entityId) {
      results.failed.push({ entityId: 'unknown', error: 'Missing entityId' })
      continue
    }

    try {
      const payload = {
        entity: item.entity,
        contentServerUrls: item.contentServerUrls || ['https://peer.decentraland.org/content']
      }

      // Route based on entity type
      switch (entityType) {
        case 'wearable':
          if (!wearableSnsAdapter) {
            results.failed.push({ entityId, error: 'Missing wearable sns configuration' })
            continue
          }
          await wearableSnsAdapter.publish(payload)
          break

        case 'emote':
          if (!emoteSnsAdapter) {
            results.failed.push({ entityId, error: 'Missing emote sns configuration' })
            continue
          }
          await emoteSnsAdapter.publish(payload)
          break

        case 'scene':
        default:
          const sceneAdapter = shouldPrioritize ? prioritySceneSnsAdapter : sceneSnsAdapter
          if (!sceneAdapter) {
            results.failed.push({
              entityId,
              error: shouldPrioritize ? 'Missing priority scene sns configuration' : 'Missing scene sns configuration'
            })
            continue
          }
          await sceneAdapter.publish(payload)
          break
      }

      results.success.push(entityId)
    } catch (error: any) {
      logger.error('Failed to publish entity', { entityId, entityType, error: error.message })
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
