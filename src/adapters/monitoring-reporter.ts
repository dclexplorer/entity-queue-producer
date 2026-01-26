import type { ILoggerComponent, IConfigComponent, IBaseComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@well-known-components/http-server'
import { SQSClient, GetQueueAttributesCommand, QueueAttributeName } from '@aws-sdk/client-sqs'

export type IMonitoringReporter = IBaseComponent

interface MonitoringReporterComponents {
  logs: ILoggerComponent
  config: IConfigComponent
  fetch: IFetchComponent
}

type EntityType = 'scene' | 'wearable' | 'emote'

interface QueueConfig {
  entityType: EntityType
  url: string
}

export function createMonitoringReporter(
  components: MonitoringReporterComponents
): IMonitoringReporter {
  const { logs, config, fetch } = components
  const logger = logs.getLogger('monitoring-reporter')

  let monitoringUrl: string | undefined
  let monitoringSecret: string | undefined
  let sqsClient: SQSClient | undefined
  let queueConfigs: QueueConfig[] = []
  let reportInterval: NodeJS.Timeout | undefined
  let isRunning = false

  async function initConfig() {
    monitoringUrl = await config.getString('MONITORING_URL')
    monitoringSecret = await config.getString('MONITORING_SECRET')
    const awsRegion = await config.getString('AWS_REGION') || 'us-east-1'

    if (!monitoringUrl || !monitoringSecret) {
      logger.info('Monitoring not configured (MONITORING_URL or MONITORING_SECRET missing)')
    } else {
      logger.info('Monitoring configured', { monitoringUrl })
    }

    // Get queue URLs for each entity type
    const sceneQueueUrl = await config.getString('SQS_QUEUE_URL') || await config.getString('SQS_SCENE_QUEUE_URL')
    const wearableQueueUrl = await config.getString('SQS_WEARABLE_QUEUE_URL')
    const emoteQueueUrl = await config.getString('SQS_EMOTE_QUEUE_URL')

    queueConfigs = []
    if (sceneQueueUrl) {
      queueConfigs.push({ entityType: 'scene', url: sceneQueueUrl })
    }
    if (wearableQueueUrl) {
      queueConfigs.push({ entityType: 'wearable', url: wearableQueueUrl })
    }
    if (emoteQueueUrl) {
      queueConfigs.push({ entityType: 'emote', url: emoteQueueUrl })
    }

    if (queueConfigs.length > 0) {
      try {
        sqsClient = new SQSClient({ region: awsRegion })
        logger.info('SQS queue monitoring enabled', {
          queues: queueConfigs.map(q => `${q.entityType}: ${q.url}`).join(', ')
        })
      } catch (error) {
        logger.error('Failed to create SQS client', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    } else {
      logger.info('SQS queue monitoring not configured (no queue URLs provided)')
    }
  }

  async function getQueueDepth(queueUrl: string): Promise<number> {
    if (!sqsClient || !queueUrl) {
      return 0
    }

    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [QueueAttributeName.ApproximateNumberOfMessages]
      })
      const response = await sqsClient.send(command)
      const count = response.Attributes?.ApproximateNumberOfMessages
      return count ? parseInt(count, 10) : 0
    } catch (error) {
      logger.debug('Failed to get SQS queue depth', {
        queueUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return 0
    }
  }

  async function report(endpoint: string, data: object): Promise<void> {
    if (!monitoringUrl || !monitoringSecret) {
      logger.debug('Skipping report - not configured')
      return
    }

    try {
      const url = `${monitoringUrl}${endpoint}`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, secret: monitoringSecret }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        logger.debug('Report sent successfully', { endpoint })
      } else {
        logger.warn('Report failed', { endpoint, status: response.status })
      }
    } catch (error) {
      // Log but don't block - monitoring should never block pipeline
      logger.warn('Monitoring report failed (non-blocking)', {
        endpoint,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async function sendQueueMetrics() {
    logger.debug('sendQueueMetrics called')

    // Report metrics for each configured queue
    for (const queueConfig of queueConfigs) {
      const queueDepth = await getQueueDepth(queueConfig.url)

      logger.info('Reporting queue metrics', {
        entityType: queueConfig.entityType,
        queueDepth
      })

      await report('/api/monitoring/queue-metrics', {
        queueDepth,
        entityType: queueConfig.entityType
      })
    }
  }

  function startReporting() {
    if (reportInterval) {
      logger.info('Reporting already started, skipping')
      return
    }

    if (queueConfigs.length === 0) {
      logger.info('No queues configured, skipping metrics reporting')
      return
    }

    logger.info('Starting queue metrics reporting (every 30s)', {
      queues: queueConfigs.map(q => q.entityType).join(', ')
    })

    // Send initial report
    sendQueueMetrics().catch(err => {
      logger.error('Initial sendQueueMetrics failed', {
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    })

    // Set up interval (every 30 seconds)
    reportInterval = setInterval(() => {
      sendQueueMetrics().catch(err => {
        logger.error('sendQueueMetrics failed', {
          error: err instanceof Error ? err.message : 'Unknown error'
        })
      })
    }, 30000)
  }

  function stopReporting() {
    if (reportInterval) {
      clearInterval(reportInterval)
      reportInterval = undefined
    }
  }

  async function start(_: IBaseComponent.ComponentStartOptions): Promise<void> {
    logger.info('Monitoring reporter starting...')
    await initConfig()
    isRunning = true
    startReporting()
    logger.info('Monitoring reporter started')
  }

  async function stop(): Promise<void> {
    logger.info('Monitoring reporter stopping...')
    isRunning = false
    stopReporting()
  }

  return {
    start,
    stop
  }
}
