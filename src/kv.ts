import { KeyvFile, makeField } from 'keyv-file'
import { tempDir } from './consts'

export interface Link {
  href: string
  title: string
}
export interface Collection {
  links: Link[]
  name: string

}
export interface Follower {
  name: string
  link: string
  desc: string
}
class Kv extends KeyvFile {
  collections = makeField(this, 'collections', [] as Collection[])
  followers = makeField(this, 'followers', [] as Follower[])
  constructor(name = '') {
    super({
      filename: `${tempDir}/data${name}.json`,
    })
  }
}
export const kv = new Kv
export const newKv = new Kv('-new')
