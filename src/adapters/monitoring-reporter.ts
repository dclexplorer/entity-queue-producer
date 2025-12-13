import type { ILoggerComponent, IConfigComponent, IBaseComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@well-known-components/http-server'
import { SQSClient, GetQueueAttributesCommand, QueueAttributeName } from '@aws-sdk/client-sqs'

export type IMonitoringReporter = IBaseComponent

interface MonitoringReporterComponents {
  logs: ILoggerComponent
  config: IConfigComponent
  fetch: IFetchComponent
}

export function createMonitoringReporter(
  components: MonitoringReporterComponents
): IMonitoringReporter {
  const { logs, config, fetch } = components
  const logger = logs.getLogger('monitoring-reporter')

  let monitoringUrl: string | undefined
  let monitoringSecret: string | undefined
  let sqsQueueUrl: string | undefined
  let sqsClient: SQSClient | undefined
  let reportInterval: NodeJS.Timeout | undefined
  let isRunning = false

  async function initConfig() {
    monitoringUrl = await config.getString('MONITORING_URL')
    monitoringSecret = await config.getString('MONITORING_SECRET')
    sqsQueueUrl = await config.getString('SQS_QUEUE_URL')
    const awsRegion = await config.getString('AWS_REGION') || 'us-east-1'

    if (!monitoringUrl || !monitoringSecret) {
      logger.info('Monitoring not configured (MONITORING_URL or MONITORING_SECRET missing)')
    } else {
      logger.info('Monitoring configured', { monitoringUrl })
    }

    if (sqsQueueUrl) {
      sqsClient = new SQSClient({ region: awsRegion })
      logger.info('SQS queue monitoring enabled', { sqsQueueUrl })
    } else {
      logger.info('SQS queue monitoring not configured (SQS_QUEUE_URL missing)')
    }
  }

  async function getQueueDepth(): Promise<number> {
    if (!sqsClient || !sqsQueueUrl) {
      return 0
    }

    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: sqsQueueUrl,
        AttributeNames: [QueueAttributeName.ApproximateNumberOfMessages]
      })
      const response = await sqsClient.send(command)
      const count = response.Attributes?.ApproximateNumberOfMessages
      return count ? parseInt(count, 10) : 0
    } catch (error) {
      logger.debug('Failed to get SQS queue depth', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return 0
    }
  }

  async function report(endpoint: string, data: object): Promise<void> {
    if (!monitoringUrl || !monitoringSecret) {
      return
    }

    try {
      const url = `${monitoringUrl}${endpoint}`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      await fetch.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, secret: monitoringSecret }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)
    } catch (error) {
      // Silently ignore - monitoring should never block pipeline
      logger.debug('Monitoring report failed (non-blocking)', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async function sendQueueMetrics() {
    const queueDepth = await getQueueDepth()

    logger.info('Reporting queue metrics', { queueDepth })

    report('/api/monitoring/queue-metrics', {
      queueDepth
    })
  }

  function startReporting() {
    if (reportInterval) {
      return
    }

    // Send initial report
    void sendQueueMetrics()

    // Set up interval (every 30 seconds)
    reportInterval = setInterval(() => void sendQueueMetrics(), 30000)
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
