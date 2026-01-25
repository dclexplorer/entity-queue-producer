import { ILoggerComponent } from '@well-known-components/interfaces'

export async function sleep(ms: number) {
  return new Promise<void>((ok) => setTimeout(ok, ms))
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: {
    logger?: ILoggerComponent.ILogger
    maxRetries?: number
    baseDelay?: number
  }
): Promise<T> {
  const { logger = undefined, maxRetries = 5, baseDelay = 100 } = options || {}

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries - 1
      if (isLastAttempt) throw error

      const delay = baseDelay * Math.pow(2, attempt)
      logger?.warn('Operation failed, retrying...', {
        attempt: attempt + 1,
        delay,
        error: error?.message || 'unknown'
      })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error('Should never reach this point')
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: NodeJS.Timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  try {
    const result = await Promise.race([promise, timeoutPromise])
    clearTimeout(timeoutHandle!)
    return result
  } catch (error) {
    clearTimeout(timeoutHandle!)
    throw error
  }
}

export async function interruptibleSleep(ms: number, abortSignal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    // eslint-disable-next-line prefer-const
    let timeoutId: NodeJS.Timeout
    const abortHandler = () => {
      clearTimeout(timeoutId)
      abortSignal.removeEventListener('abort', abortHandler)
      resolve()
    }
    abortSignal.addEventListener('abort', abortHandler)
    timeoutId = setTimeout(() => {
      abortSignal.removeEventListener('abort', abortHandler)
      resolve()
    }, ms)
  })
}
