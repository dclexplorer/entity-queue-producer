import { IDeployerComponent } from '@dcl/snapshots-fetcher/dist/types'
import { AppComponents } from '../../types'
import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { Readable } from 'stream'
import { ISNSAdapterComponent } from '../sns'

export function createDeployerComponent(
  components: Pick<AppComponents, 'logs' | 'storage' | 'downloadQueue' | 'fetch' | 'metrics'>,
  {
    sceneSnsAdapter,
    wearableEmotesSnsAdapter
  }: { sceneSnsAdapter?: ISNSAdapterComponent; wearableEmotesSnsAdapter?: ISNSAdapterComponent },
  rectFilter: string | undefined
): IDeployerComponent {
  const logger = components.logs.getLogger('downloader')

  return {
    async deployEntity(entity, servers) {
      const markAsDeployed = entity.markAsDeployed ? entity.markAsDeployed : async () => {}
      try {
        const exists = await components.storage.exist(entity.entityId)

        const isSceneSnsEntityToSend = entity.entityType === 'scene' && !!sceneSnsAdapter

        const isWearableEmotesSnsEntityToSend =
          (entity.entityType === 'wearable' || entity.entityType === 'emote') && !!wearableEmotesSnsAdapter

        if (rectFilter && entity.pointers && isSceneSnsEntityToSend) {
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

        if (exists || (isSceneSnsEntityToSend === false && isWearableEmotesSnsEntityToSend === false)) {
          return await markAsDeployed()
        }

        await components.downloadQueue.onSizeLessThan(1000)

        void components.downloadQueue.scheduleJob(async () => {
          // touch
          await components.storage.storeStream(entity.entityId, Readable.from([]))

          logger.info('Entity stored', { entityId: entity.entityId, entityType: entity.entityType })

          const deploymentToSqs: DeploymentToSqs = {
            entity,
            contentServerUrls: servers
          }

          // send sns
          if (isSceneSnsEntityToSend) {
            await sceneSnsAdapter.publish(deploymentToSqs)
          }

          if (isWearableEmotesSnsEntityToSend) {
            await wearableEmotesSnsAdapter.publish(deploymentToSqs)
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
