import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { HandlerContextWithPath } from '../../types'

// handlers arguments only type what they need, to make unit testing easier
export async function addQueueHandler(
  context: HandlerContextWithPath<'sceneSnsAdapter' | 'prioritySceneSnsAdapter' | 'config', '/queue-task'>
) {
  const {
    components: { sceneSnsAdapter, prioritySceneSnsAdapter, config },
    request,
    url
  } = context

  if (request.headers.get('Authorization') !== (await config.requireString('TMP_SECRET')))
    return { status: 401, body: 'Unauthorized' }

  const body = await request.json()

  //if (!DeploymentToSqs.validate(body)) return { status: 403, body: { errors: DeploymentToSqs.validate.errors } }

  const shouldPrioritize = !!(body as any)?.prioritize

  if (shouldPrioritize) {
    if (prioritySceneSnsAdapter) {
      await prioritySceneSnsAdapter.publish(body)
    } else {
      return { status: 500, body: 'Missing priority scene sns configuration' }
    }
  } else {
    if (sceneSnsAdapter) {
      await sceneSnsAdapter.publish(body)
    } else {
      return { status: 500, body: 'Missing scene sns configuration' }
    }
  }

  return {
    body: url.pathname
  }
}
