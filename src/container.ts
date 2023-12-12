import { FilesystemAdapterService } from './filesystem-adapter.service'
import { PathFactoryService } from './path-factory.service'

const pathFactoryService = new PathFactoryService()

export const filesystemAdapterService = new FilesystemAdapterService(
  pathFactoryService,
)
