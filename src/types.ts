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
import { metricDeclarations } from './metrics'
import { ISNSAdapterComponent } from './adapters/sns'

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
}

// components used in runtime
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
  sceneSnsAdapter?: ISNSAdapterComponent
  prioritySceneSnsAdapter?: ISNSAdapterComponent
  wearableEmotesSnsAdapter?: ISNSAdapterComponent
  worldSyncService?: IBaseComponent
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
