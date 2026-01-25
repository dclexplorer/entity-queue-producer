import { IJobQueue } from '@dcl/snapshots-fetcher/dist/job-queue-port'
import { IDeployerComponent, SynchronizerComponent } from '@dcl/snapshots-fetcher/dist/types'
import type { IFetchComponent } from '@well-known-components/http-server'
import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IBaseComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { IContentStorageComponent, IFileSystemComponent } from '@dcl/catalyst-storage'
import { Entity } from '@dcl/schemas'
import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { metricDeclarations } from './metrics'
import { ISNSAdapterComponent } from './adapters/sns'
import { IMonitoringReporter } from './adapters/monitoring-reporter'
import { ILRUNormalizedCache } from './adapters/lru-cache'

export interface IWorldsComponent {
  getWorld(worldId: string, worldContentServerUrl?: string): Promise<Entity | null>
  isWorldDeployment(event: DeploymentToSqs): boolean
}

/**
 * Extended DeploymentToSqs that includes entityType for routing and identification
 */
export type DeploymentToSqsWithType = DeploymentToSqs & {
  entity: {
    entityType: string
  }
}

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<GlobalContext>
  fetch: IFetchComponent
  downloadQueue: IJobQueue
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  fs: IFileSystemComponent
  storage: IContentStorageComponent
  synchronizer: SynchronizerComponent
  deployer: IDeployerComponent
  sceneSnsAdapter: ISNSAdapterComponent
  prioritySceneSnsAdapter: ISNSAdapterComponent
  wearableEmotesSnsAdapter: ISNSAdapterComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
  worldSyncService?: IBaseComponent
  monitoringReporter: IMonitoringReporter
  worlds?: IWorldsComponent
  worldsCache?: ILRUNormalizedCache<boolean>
}

// components used in tests
export type TestComponents = BaseComponents & {
  // A fetch component that only hits the test server
  localFetch: IFetchComponent
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = any
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }>,
  Path
>

export type Context<Path extends string = any> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>
