import { IDeployerComponent } from '@dcl/snapshots-fetcher/dist/types'
import { AppComponents, DeploymentToSqsWithType } from '../../types'
import { Readable } from 'stream'
import { ISNSAdapterComponent } from '../sns'

export function createDeployerComponent(
  components: Pick<AppComponents, 'logs' | 'storage' | 'downloadQueue' | 'fetch' | 'metrics'>,
  {
    sceneSnsAdapter,
    wearableSnsAdapter,
    emoteSnsAdapter
  }: { sceneSnsAdapter: ISNSAdapterComponent; wearableSnsAdapter: ISNSAdapterComponent; emoteSnsAdapter: ISNSAdapterComponent },
  rectFilter: string | undefined,
  disableScenes: boolean = false
): IDeployerComponent {
  const logger = components.logs.getLogger('downloader')

  if (disableScenes) {
    logger.info('Scene publishing is DISABLED')
  }

  return {
    async deployEntity(entity, servers) {
      const markAsDeployed = entity.markAsDeployed ? entity.markAsDeployed : async () => {}
      try {
        const exists = await components.storage.exist(entity.entityId)

        const isSceneEntity = entity.entityType === 'scene'
        const isWearableEntity = entity.entityType === 'wearable'
        const isEmoteEntity = entity.entityType === 'emote'

        if (rectFilter && entity.pointers && isSceneEntity) {
          const pointers = entity.pointers
          // Parse the rectFilter into numeric values
          const [minX, minY, maxX, maxY] = rectFilter.split(',').map(Number)

          // Filter the pointers based on the rectFilter
          const pointerIsInside = pointers.some((pointer) => {
            const [x, y] = pointer.split(',').map(Number) // Parse x and y values from pointer
            return x >= minX && x <= maxX && y >= minY && y <= maxY // Check if the point is within the bounds
          })

          if (!pointerIsInside) {
            logger.info('scene ignored: ', {
              pointerIsInside: JSON.stringify(pointerIsInside),
              pointers: JSON.stringify(pointers)
            })
            return await markAsDeployed()
          }
        }

        if (exists || (!isSceneEntity && !isWearableEntity && !isEmoteEntity)) {
          return await markAsDeployed()
        }

        await components.downloadQueue.onSizeLessThan(1000)

        void components.downloadQueue.scheduleJob(async () => {
          // touch
          await components.storage.storeStream(entity.entityId, Readable.from([]))

          logger.info('Entity stored', { entityId: entity.entityId, entityType: entity.entityType })

          const deploymentToSqs: DeploymentToSqsWithType = {
            entity: {
              entityId: entity.entityId,
              entityType: entity.entityType,
              authChain: entity.authChain
            },
            contentServerUrls: servers
          }

          // send to appropriate SNS based on entity type
          if (isSceneEntity && !disableScenes) {
            await sceneSnsAdapter.publish(deploymentToSqs)
          }

          if (isWearableEntity) {
            await wearableSnsAdapter.publish(deploymentToSqs)
          }

          if (isEmoteEntity) {
            await emoteSnsAdapter.publish(deploymentToSqs)
          }
          await markAsDeployed()
        })
      } catch (error: any) {
        const isNotRetryable = /status: 4\d{2}/.test(error.message)
        logger.error('Failed to publish entity', {
          entityId: entity.entityId,
          entityType: entity.entityType,
          error: error?.message,
          stack: error?.stack
        })

        if (isNotRetryable) {
          logger.error('Failed to download entity', {
            entityId: entity.entityId,
            entityType: entity.entityType,
            error: error?.message
          })
          await markAsDeployed()
        }
      }
    },
    async onIdle() {
      logger.info('onIdle')
    }
  }
}
