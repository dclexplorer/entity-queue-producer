import type { ILoggerComponent, IConfigComponent, IBaseComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@well-known-components/http-server'
import { SQSClient, GetQueueAttributesCommand, QueueAttributeName } from '@aws-sdk/client-sqs'

export interface IMonitoringReporter extends IBaseComponent {
  incrementPublished(): void
  getPublishedCount(): number
}

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

  // Metrics tracking
  let messagesPublished = 0
  let lastReportedCount = 0
  let lastReportTime = Date.now()

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
    const now = Date.now()
    const timeDiffHours = (now - lastReportTime) / 3600000 // Convert to hours

    // Calculate publish rate per hour
    const newMessages = messagesPublished - lastReportedCount
    const publishRatePerHour = timeDiffHours > 0 ? newMessages / timeDiffHours : 0

    // Get queue depth from SQS
    const queueDepth = await getQueueDepth()

    const metrics = {
      messagesPublished,
      messagesInFlight: queueDepth,
      publishRatePerHour: Math.round(publishRatePerHour)
    }

    logger.info('Reporting queue metrics', metrics)

    report('/api/monitoring/queue-metrics', metrics)

    lastReportedCount = messagesPublished
    lastReportTime = now
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

  return {
    async start() {
      await initConfig()
      isRunning = true
      startReporting()
    },

    async stop() {
      isRunning = false
      stopReporting()
    },

    incrementPublished() {
      messagesPublished++
    },

    getPublishedCount() {
      return messagesPublished
    }
  }
}
