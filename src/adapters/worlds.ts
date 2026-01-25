import { Entity } from '@dcl/schemas'
import { BaseComponents, IWorldsComponent } from '../types'
import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'

export async function createWorldsAdapter({
  logs,
  config,
  fetch
}: Pick<BaseComponents, 'logs' | 'config' | 'fetch'>): Promise<IWorldsComponent> {
  const logger = logs.getLogger('worlds-adapter')
  const defaultWorldsContentServerUrl =
    (await config.getString('WORLDS_CONTENT_SERVER_URL')) || 'https://worlds-content-server.decentraland.org'

  async function getWorld(
    worldId: string,
    worldContentServerUrl: string = defaultWorldsContentServerUrl
  ): Promise<Entity | null> {
    try {
      const url = `${worldContentServerUrl}/contents/${worldId}`
      const response = await fetch.fetch(url)

      if (!response.ok) {
        return null
      }

      const parsedResponse = await response.json()

      return {
        ...parsedResponse,
        id: worldId,
        type: 'world',
        pointers: [parsedResponse.metadata.worldConfiguration.name]
      }
    } catch (error: any) {
      logger.error('Error fetching world', { worldId, error: error?.message || 'Unknown error' })
      return null
    }
  }

  function isWorldDeployment(event: DeploymentToSqs): boolean {
    return (
      !!event.contentServerUrls &&
      !!event.contentServerUrls[0] &&
      event.contentServerUrls[0].includes('worlds-content-server')
    )
  }

  return {
    getWorld,
    isWorldDeployment
  }
}
