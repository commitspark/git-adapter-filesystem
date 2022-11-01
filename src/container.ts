import { asClass, createContainer, InjectionMode } from 'awilix'
import { GitLabAdapterService } from './git-lab-adapter.service'

const container = createContainer({ injectionMode: InjectionMode.CLASSIC })

container.register({
  gitLabAdapter: asClass(GitLabAdapterService),
})

const adapter = container.resolve<GitLabAdapterService>('gitLabAdapter')

export const app = {
  adapter,
  container,
}
