import { task, desc, option, fs, logger, setGlobalOptions, sleep } from 'foy'
import puppeteer from 'puppeteer-extra'
import * as _puppeteer from 'puppeteer'

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

import * as playwright from 'playwright'
import { oldDataDir as oldDataDir,tempDir, newDataDir } from './src/consts'
import { kv, newKv, Collection, Link, Follower } from './src/kv'
import { chunkBy } from './src/utils'
const findChrome = require('chrome-finder')
const logFile = `${tempDir}/data.log`
fs.rmrf(logFile)

setGlobalOptions({ loading: false, logger: {
  onLog(info) {
    fs.appendFile(logFile, `[${info.level}] ${info.message}\n`)
  }
} })
export interface Context {
  // browser: playwright.FirefoxBrowser
  // page: playwright.Page
  browser: _puppeteer.Browser
  page: _puppeteer.Page
  profilerUrl: string
}


async function login(dataDir: string): Promise<Context> {
  await fs.mkdirp(dataDir)
  logger.info('launch')
  let browser = await puppeteer.launch({
    headless: true,
    // executablePath: '/Applications/Firefox.app/Contents/MacOS/firefox-bin'
    executablePath: findChrome(),
    userDataDir: dataDir,
  })
  logger.info('after launch')
  let page = await browser.newPage()
  // await page.evaluateOnNewDocument(() => {
  //   Object.defineProperty(navigator, 'webdriver', {
  //      get: () => false,
  //      configurable: true,
  //   });
  // });
  const zhihuUrl = 'https://www.zhihu.com'
  await page.goto(zhihuUrl)
  logger.info('请进入浏览器登录')
  await page.waitForSelector('#Popover15-toggle')
  await page.click('#Popover15-toggle')
  const profilerUrl = await page.$eval('.AppHeaderProfileMenu-item', el => el['href'])
  logger.info('profilerUrl', profilerUrl)
  return {
    browser,
    page, profilerUrl
  }
  // await page.close()
}
// 备份收藏夹
async function backCols({browser, page, profilerUrl}: Context) {
  await page.goto(`${profilerUrl}/collections`)
  const cols = await page.$$eval('a.SelfCollectionItem-title', (els) => els.map((e) => ({
    href: e['href'],
    name: e.childNodes[0].textContent
  })))
  // cols.forEach(c => {
  //   c.href = `${zhihuUrl}${c.href}`
  // })
  logger.info('cols', cols)
  kv.collections.delete()
  await cols.map(async col => {

    const colData: Collection = {
      name: col.name,
      links: [],
    }
    console.log(`start col ${colData.name}`)
    let page = await browser.newPage()
    await page.goto(col.href)

    const getColLinks = () => page.$$eval('.ContentItem-title a', (els) => els.map(e => {
      return {
        href:e['href'],
        title: e.textContent
      }
    }))
    const getNextBtn = () => page.$('.PaginationButton-next')

    colData.links = await getColLinks()
    logger.info('init col', colData)
    // let nextBtn: playwright.ElementHandle<SVGElement | HTMLElement> | null
    let nextBtn: _puppeteer.ElementHandle<Element> | null
    while (nextBtn = await getNextBtn()) {
      await nextBtn.click()
      await page.waitForTimeout(1000)
      const links = await getColLinks()
      logger.info('push col links', colData.name, links)
      colData.links.push(...links)
    }

    let colDatas = kv.collections.get()
    colDatas.push(colData)
    kv.collections.set(colDatas)
    console.log(`end col ${colData.name}`)
    await page.close()
  })
}
// 备份关注者
async function backFollowers({browser, page, profilerUrl}: Context) {
  await page.goto(`${profilerUrl}/following`)
  await page.waitForTimeout(1000)
  kv.followers.delete()
  const followers = kv.followers.get()
  const getFollowers = () => page.$$eval('.ContentItem-head a.UserLink-link', (els) => els.map(e => {
    return {
      link: e['href'],
      name: e.textContent,
    } as Follower
  }))
  const getNextBtn = () => page.$('.PaginationButton-next')
  logger.info('before getFollowers')
  const newFollowers = await getFollowers()
  logger.info('after getFollowers')
  followers.push(...newFollowers)
  logger.info('init followers', newFollowers)
  // let nextBtn: playwright.ElementHandle<SVGElement | HTMLElement> | null
  let nextBtn: _puppeteer.ElementHandle<Element> | null

  while (nextBtn = await getNextBtn()) {
    await nextBtn.click()
    await page.waitForTimeout(1000)
    const newFollowers = await getFollowers()
    logger.info('push followers', newFollowers)
    followers.push(...newFollowers)
  }
  kv.followers.set(followers)
  await kv.saveToDisk()
}

// (async ctx => {
//   // Your build tasks
//   let pctx = await login()
//   // await backCols(pctx)
//   await backFollowers(pctx)
// })()
task('backup', async ctx => {
    // Your build tasks
  let pctx = await login(oldDataDir)
  await backCols(pctx)
  await backFollowers(pctx)
})
const myBigBuggyCol = 'wtf'

async function restoreCols({browser, page, profilerUrl}: Context) {
  let cols = kv.collections.get()
  console.log('cols', cols.map(c=> [c.name, c.links.length]))
  await page.goto(`${profilerUrl}/collections`)
  let curColTitles = await page.$$eval('.SelfCollectionItem-title', els => els.map(e => e.textContent))
  for (const col of cols) {
    if (curColTitles.includes(col.name) && col.name !=myBigBuggyCol) {
      logger.info('skip', col.name)
      continue
    }
    if (col.name !== myBigBuggyCol) {
      await sleep(1000)
      await (await page.$('.CollectionsHeader-addFavlistButton')).click()
      await sleep(500)
      await (await page.$('.Favlists-titleInput')).type(col.name)
      await (await page.$('.Favlists-privacyOptionRadio')).click()
      await (await page.$('.ModalButtonGroup--horizontal .Button--primary')).click()
    }

    logger.info('add', col.name)
    let chunks = chunkBy(col.links, 100)
    await Promise.all(chunks.map(async c => {
      let page = await browser.newPage()
      for (const l of c) {
        logger.log('start add to', col.name, l)
        await sleep(500)
        await page.goto(l.href, {
          waitUntil: 'networkidle0'
        })
        let btn = await page.evaluateHandle<_puppeteer.ElementHandle>(() => {
          var btns = Array.from(document.querySelectorAll('.ContentItem-actions .Button'))
          return btns.find(b => b.textContent.includes('收藏'))
        })
        await btn.click()
        await page.waitForSelector('.Favlists-item')
        let find = await page.evaluate((name) => {
          var els = document.querySelectorAll('.Favlists-item')
          var find = false
          els.forEach(el => {
            let text = el.querySelector('.Favlists-itemNameText').textContent
            let btn = el.querySelector<HTMLButtonElement>('button.Button--blue')
            if (text == name) {
              if (btn) {
                btn.click()
                console.info('clicked', el)
              } else {
                console.info('no', el)
              }
              find = true
            }
          })
          return find
        }, col.name)
        if (!find) {
          logger.error('cannot find col:', col.name, l)
        } else {
          logger.log('add to', col.name, l)
        }
      }
      await page.close()
    }))
  }
}

async function restoreFollowers(ctx: Context) {
  logger.info('restoreFollowers start')
  let followers = kv.followers.get()
  let group = chunkBy(followers, 60)
  await Promise.all(group.map(async g => {
    const page = await ctx.browser.newPage()
    for (const f of g) {
      await page.goto(f.link, {
        waitUntil: 'networkidle0'
      })
      let btn = await page.$('.FollowButton.Button--blue')
      if (btn) {
        await btn.click()
        try {
          await page.waitForSelector('.FollowButton.Button--grey', {
            timeout: 2000
          })
          logger.info('follow', f.name)
        } catch (error) {
          logger.error('follow failed',f.name, f.link, error)
          throw error
        }
      } else {
        logger.info('skip follow', f.name)
      }
    }
    await page.close()
  }))
  logger.info('restoreFollowers end')
}

task('sync', async ctx => {
  let pctx = await login(newDataDir)
  // await restoreCols(pctx).catch(logger.error)
  await restoreFollowers(pctx).catch(logger.error)
})
