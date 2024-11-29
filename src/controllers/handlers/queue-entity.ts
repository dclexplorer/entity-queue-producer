import { HandlerContextWithPath } from '../../types'

// handlers arguments only type what they need, to make unit testing easier
export async function queueEntity(
  context: Pick<HandlerContextWithPath<'metrics', '/queue-entity'>, 'url' | 'components'>
) {
  const { url } = context

  return {
    body: url.pathname
  }
}
