import type { ILoggerComponent, IConfigComponent, IBaseComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@well-known-components/http-server'

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
  let reportInterval: NodeJS.Timeout | undefined
  let isRunning = false

  // Metrics tracking
  let messagesPublished = 0
  let lastReportedCount = 0
  let lastReportTime = Date.now()

  async function initConfig() {
    monitoringUrl = await config.getString('MONITORING_URL')
    monitoringSecret = await config.getString('MONITORING_SECRET')

    if (!monitoringUrl || !monitoringSecret) {
      logger.info('Monitoring not configured (MONITORING_URL or MONITORING_SECRET missing)')
    } else {
      logger.info('Monitoring configured', { monitoringUrl })
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

  function sendQueueMetrics() {
    const now = Date.now()
    const timeDiffMinutes = (now - lastReportTime) / 60000

    // Calculate publish rate per minute
    const newMessages = messagesPublished - lastReportedCount
    const publishRatePerMin = timeDiffMinutes > 0 ? newMessages / timeDiffMinutes : 0

    report('/api/monitoring/queue-metrics', {
      messagesPublished,
      messagesInFlight: 0, // We don't track this on the producer side
      publishRatePerMin: Math.round(publishRatePerMin * 100) / 100
    })

    lastReportedCount = messagesPublished
    lastReportTime = now
  }

  function startReporting() {
    if (reportInterval) {
      return
    }

    // Send initial report
    sendQueueMetrics()

    // Set up interval (every 30 seconds)
    reportInterval = setInterval(sendQueueMetrics, 30000)
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
