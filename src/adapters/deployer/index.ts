import { IDeployerComponent } from '@dcl/snapshots-fetcher/dist/types'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { AppComponents } from '../../types'
import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { Readable } from 'stream'

export function createDeployerComponent(
  components: Pick<AppComponents, 'logs' | 'storage' | 'downloadQueue' | 'fetch' | 'metrics' | 'sns'>
): IDeployerComponent {
  const logger = components.logs.getLogger('downloader')

  const client = new SNSClient({
    endpoint: components.sns.optionalSnsEndpoint
  })

  return {
    async deployEntity(entity, servers) {
      const markAsDeployed = entity.markAsDeployed ? entity.markAsDeployed : async () => {}
      try {
        const exists = await components.storage.exist(entity.entityId)

        const isSceneSnsEntityToSend = entity.entityType === 'scene' && !!components.sns.scenesArn

        const isWearableEmotesSnsEntityToSend =
          (entity.entityType === 'wearable' || entity.entityType === 'emote') && !!components.sns.wearableEmotesArn

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
            const receipt = await client.send(
              new PublishCommand({
                TopicArn: components.sns.scenesArn,
                Message: JSON.stringify(deploymentToSqs)
              })
            )
            logger.info('Notification sent to scenes', {
              messageId: receipt.MessageId as any,
              sequenceNumber: receipt.SequenceNumber as any
            })
          }

          if (isWearableEmotesSnsEntityToSend) {
            const receipt = await client.send(
              new PublishCommand({
                TopicArn: components.sns.wearableEmotesArn,
                Message: JSON.stringify(deploymentToSqs)
              })
            )
            logger.info('Notification sent to wearables/emotes', {
              MessageId: receipt.MessageId as any,
              SequenceNumber: receipt.SequenceNumber as any
            })
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
