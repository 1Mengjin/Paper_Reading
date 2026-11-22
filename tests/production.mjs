import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture } from './reader-fixture.mjs'

const port = 4187, origin = 'http://127.0.0.1:' + port
const server = spawn(process.execPath,['start.mjs'],{env:{...process.env,PAPERPOCKET_PORT:String(port)},stdio:'inherit'})
let browser
try {
  for (let i=0;i<60;i++) {
    if (server.exitCode !== null) throw new Error('本地验证服务启动失败')
    if (await fetch(origin).then(r=>r.ok).catch(()=>false)) break
    await delay(200)
  }
  browser = await chromium.launch({channel:process.env.PAPERPOCKET_BROWSER || undefined})
  const page = await browser.newPage()
  const errors=[], external=[]
  page.on('pageerror',e=>errors.push(String(e)))
  await page.route(/^https?:/,async route=>{
    if (new URL(route.request().url()).origin===origin) await route.continue()
    else { external.push(route.request().url()); await route.abort() }
  })
  await page.goto(origin)
  await expect(page.getByRole('heading',{name:'我的书架'})).toBeVisible()
  await page.getByLabel('选择 EPUB 文件').setInputFiles(await fixture())
  await page.locator('.volume').first().click()
  await expect(page.getByRole('heading',{name:'窗前',exact:true})).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.sheet footer').first()).toHaveText('3')
  expect(errors).toEqual([])
  expect(external).toEqual([])
  console.log('生产版已完成 EPUB 导入、分册和翻页验证')
} finally { await browser?.close(); server.kill() }
