import { HandlerContextWithPath, DeploymentToSqsWithType } from '../../types'

type EntityType = 'scene' | 'wearable' | 'emote'

// handlers arguments only type what they need, to make unit testing easier
export async function addQueueHandler(
  context: HandlerContextWithPath<
    'sceneSnsAdapter' | 'prioritySceneSnsAdapter' | 'wearableSnsAdapter' | 'emoteSnsAdapter' | 'config',
    '/queue-task'
  >
) {
  const {
    components: { sceneSnsAdapter, prioritySceneSnsAdapter, wearableSnsAdapter, emoteSnsAdapter, config },
    request,
    url
  } = context

  if (request.headers.get('Authorization') !== (await config.requireString('TMP_SECRET')))
    return { status: 401, body: 'Unauthorized' }

  const body = await request.json()

  // Extract entityType for routing, default to 'scene'
  const entityType: EntityType = (body as any)?.entity?.entityType || 'scene'
  const shouldPrioritize = !!(body as any)?.prioritize

  // Priority queue is shared across all entity types - entityType is preserved in the message
  if (shouldPrioritize) {
    if (prioritySceneSnsAdapter) {
      await prioritySceneSnsAdapter.publish(body as DeploymentToSqsWithType)
    } else {
      return { status: 500, body: 'Missing priority sns configuration' }
    }
    return { body: url.pathname }
  }

  // Non-priority: route based on entity type
  switch (entityType) {
    case 'wearable':
      if (wearableSnsAdapter) {
        await wearableSnsAdapter.publish(body as DeploymentToSqsWithType)
      } else {
        return { status: 500, body: 'Missing wearable sns configuration' }
      }
      break

    case 'emote':
      if (emoteSnsAdapter) {
        await emoteSnsAdapter.publish(body as DeploymentToSqsWithType)
      } else {
        return { status: 500, body: 'Missing emote sns configuration' }
      }
      break

    case 'scene':
    default:
      if (sceneSnsAdapter) {
        await sceneSnsAdapter.publish(body as DeploymentToSqsWithType)
      } else {
        return { status: 500, body: 'Missing scene sns configuration' }
      }
      break
  }

  return {
    body: url.pathname
  }
}
