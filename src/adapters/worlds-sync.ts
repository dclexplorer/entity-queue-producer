import { Readable } from 'stream'
import { BaseComponents, DeploymentToSqsWithType } from '../types'
import { ISNSAdapterComponent } from './sns'
import { IBaseComponent } from '@well-known-components/interfaces'
import { ILRUNormalizedCache } from './lru-cache'
import { interruptibleSleep, withRetry } from '../utils/timer'

export function createWorldSync(
  { logs, storage, fetch, config }: Pick<BaseComponents, 'logs' | 'storage' | 'fetch' | 'config'>,
  sceneSnsAdapter: ISNSAdapterComponent,
  worldsCache?: ILRUNormalizedCache<boolean>
): IBaseComponent {
  const logger = logs.getLogger('world-sync')

  let abortController: AbortController | undefined
  let backgroundTask: Promise<void> | undefined

  async function fetchSceneIds(): Promise<string[]> {
    const worldsContentServerUrl =
      (await config.getString('WORLDS_CONTENT_SERVER_URL')) || 'https://worlds-content-server.decentraland.org'
    const url = `${worldsContentServerUrl}/index`

    return withRetry(
      async () => {
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
      },
      {
        logger,
        maxRetries: 3,
        baseDelay: 5000
      }
    )
  }

  async function run(): Promise<void> {
    abortController = new AbortController()

    const worldsContentServerUrl =
      (await config.getString('WORLDS_CONTENT_SERVER_URL')) || 'https://worlds-content-server.decentraland.org'
    const syncIntervalMs = (await config.getNumber('WORLDS_SYNC_INTERVAL_MS')) || 600000

    logger.info('World sync service started', { worldsContentServerUrl, syncIntervalMs })

    while (!abortController.signal.aborted) {
      try {
        const sceneIds = await fetchSceneIds()
        for (const sceneId of sceneIds) {
          if (abortController.signal.aborted) break

          const storeKey = `${sceneId}-v2`
          try {
            // Check LRU cache first if available, otherwise fall back to storage
            const isInCache = worldsCache?.has(storeKey)
            const alreadyProcessed = isInCache || (await storage.exist(storeKey))

            if (!alreadyProcessed) {
              const deploymentToSqs: DeploymentToSqsWithType = {
                entity: {
                  entityId: sceneId,
                  entityType: 'scene',
                  authChain: []
                },
                contentServerUrls: [worldsContentServerUrl]
              }

              // send sns
              await sceneSnsAdapter.publish(deploymentToSqs)

              await storage.storeStream(storeKey, Readable.from([]))

              // Update cache if available
              if (worldsCache) {
                worldsCache.set(storeKey, true)
              }

              logger.info('World deployed ' + sceneId)
            }
          } catch (error) {
            logger.error('Error deploying scene:' + sceneId)
          }
        }
      } catch (error) {
        logger.error('Error in world sync iteration:', { error: String(error) })
        // Continue the loop even if fetching fails
      }

      if (abortController.signal.aborted) break

      logger.info(`Wait ${syncIntervalMs / 60000} minutes`)
      await interruptibleSleep(syncIntervalMs, abortController.signal)
    }

    logger.info('World sync loop stopped')
  }

  async function start(_: IBaseComponent.ComponentStartOptions): Promise<void> {
    const disableWorlds = (await config.getString('DISABLE_WORLDS')) === 'true'
    if (disableWorlds) {
      logger.info('World sync is DISABLED')
      return
    }
    backgroundTask = run().catch((err) => logger.error('Sync task crashed: ', err))
  }

  async function stop(): Promise<void> {
    logger.info('Stopping world sync...')
    abortController?.abort()
    await backgroundTask
  }

  return {
    start,
    stop
  }
}
