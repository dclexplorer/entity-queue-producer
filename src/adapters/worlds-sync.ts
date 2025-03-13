import { Readable } from 'stream'
import { AppComponents } from '../types'
import { ISNSAdapterComponent } from './sns'
import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { IBaseComponent } from '@well-known-components/interfaces'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createWorldSync(
  { logs, storage, fetch }: Pick<AppComponents, 'logs' | 'storage' | 'fetch'>,
  sceneSnsAdapter: ISNSAdapterComponent | undefined
): IBaseComponent {
  const logger = logs.getLogger('world-sync')
  async function fetchSceneIds(): Promise<string[]> {
    const url = 'https://worlds-content-server.decentraland.org/index'

    try {
      const response = await fetch.fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`)
      }

      const data = await response.json()
      if (!data || !data.data) {
        throw new Error('Invalid response structure')
      }

      // Extracting scene IDs
      const sceneIds: string[] = data.data.flatMap((world: any) => world.scenes.map((scene: any) => scene.id))
      return sceneIds
    } catch (error) {
      logger.error('Error fetching scene IDs:' + error)
      throw Promise.reject('Error fetching scene IDs: ' + error)
    }
  }

  async function start(_: IBaseComponent.ComponentStartOptions): Promise<void> {
    if (sceneSnsAdapter === undefined) {
      logger.error('World sync requires sceneSnsAdapter')
      return
    }
    logger.info('World sync service started')
    while (true) {
      const sceneIds = await fetchSceneIds()
      for (const sceneId of sceneIds) {
        const storeKey = `${sceneId}-v2`
        try {
          if (!(await storage.exist(storeKey))) {
            const deploymentToSqs: DeploymentToSqs = {
              entity: {
                entityId: sceneId,
                authChain: []
              },
              contentServerUrls: ['https://worlds-content-server.decentraland.org']
            }

            // send sns
            await sceneSnsAdapter.publish(deploymentToSqs)

            await storage.storeStream(storeKey, Readable.from([]))

            logger.info('World deployed ' + sceneId)
          }
        } catch (error) {
          logger.error('Error deploying scene:' + sceneId)
        }
      }

      logger.info('Wait 10 minutes')
      await delay(60000) // 10 minutes
    }
  }

  return {
    start
  }
}
