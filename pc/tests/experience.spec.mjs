import { test, expect } from '@playwright/test'
import { fixture } from './reader-fixture.mjs'

test('音效可选项、丝滑翻页动画、纸张质感与沉浸屏蔽通知模式', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  await page.goto('/')
  await page.getByLabel('选择 EPUB 文件').setInputFiles(await fixture())
  // 0. 开源字体切换（书版宋体 <-> 温润文楷）与 CSS 变量生效验证
  await expect(page.getByLabel('字体')).toHaveValue('serif')
  await page.locator('.volume').first().click()
  await expect(page.locator('.sheet')).toHaveCount(2)
  const serifFont = await page.locator('.page-text').first().evaluate(el => getComputedStyle(el).fontFamily)
  expect(serifFont).toContain('Literata')
  expect(serifFont).toContain('Noto Serif SC')
  await page.getByLabel('设置').click()
  await page.getByLabel('字体').selectOption('kai')
  await page.keyboard.press('Escape')
  await expect(page.locator('.sheet')).toHaveCount(2)
  const kaiFont = await page.locator('.page-text').first().evaluate(el => getComputedStyle(el).fontFamily)
  expect(kaiFont).toContain('LXGW WenKai Screen')
  await page.getByLabel('设置').click()
  await page.getByLabel('字体').selectOption('serif')
  await page.keyboard.press('Escape')
  await expect(page.locator('.sheet')).toHaveCount(2)

  // 1. 音效可选项（保留原有合成 + sound/ 文件夹新增音效，且可切换持久化）
  await page.getByLabel('声景混音').click()
  const rainSelect = page.getByLabel('雨声音效')
  const turnSelect = page.getByLabel('翻页音效')
  await expect(rainSelect).toHaveValue('file:哗啦啦下雨声')
  await expect(turnSelect).toHaveValue('file:纸张翻页')
  await expect(rainSelect.locator('option[value="synth"]')).toHaveText('轻柔细雨（原版合成）')
  await expect(turnSelect.locator('option[value="synth"]')).toHaveText('轻沙翻页（原版合成）')

  await page.getByLabel('雨声', { exact: true }).fill('0.25')
  await rainSelect.selectOption('synth')
  await turnSelect.selectOption('synth')
  await page.keyboard.press('Escape')

  await page.reload()
  await page.locator('.volume').first().click()
  await page.getByLabel('声景混音').click()
  await expect(page.getByLabel('雨声音效')).toHaveValue('synth')
  await expect(page.getByLabel('翻页音效')).toHaveValue('synth')
  await page.getByLabel('雨声音效').selectOption('file:哗啦啦下雨声')
  await page.getByLabel('翻页音效').selectOption('file:纸张翻页')
  await page.keyboard.press('Escape')

  // 2. 翻页动画（双页 3D 翻页、正反页严格对齐无错位、结束后清理）
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.turn-overlay.spread-turn.next')).toBeVisible()
  const alignment = await page.locator('.turn-overlay').evaluate(el => {
    const spread = el.parentElement.getBoundingClientRect()
    const underlay = el.querySelector('.turn-underlay').getBoundingClientRect()
    const front = el.querySelector('.turn-front')
    const back = el.querySelector('.turn-back')
    return {
      underlayTopDiff: Math.abs(underlay.top - spread.top),
      frontPos: getComputedStyle(front).position,
      backPos: getComputedStyle(back).position,
      frontTopOffset: front.offsetTop,
      backTopOffset: back.offsetTop,
    }
  })
  expect(alignment.underlayTopDiff).toBeLessThan(2)
  expect(alignment.frontPos).toBe('absolute')
  expect(alignment.backPos).toBe('absolute')
  expect(alignment.frontTopOffset).toBe(0)
  expect(alignment.backTopOffset).toBe(0)
  await expect(page.locator('.sheet footer').first()).toHaveText('3')
  await expect(page.locator('.turn-overlay')).toHaveCount(0, { timeout: 1500 })

  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.turn-overlay.spread-turn.back')).toBeVisible()
  await expect(page.locator('.sheet footer').first()).toHaveText('1')
  await expect(page.locator('.turn-overlay')).toHaveCount(0, { timeout: 1500 })

  // 3. 纸张质感（伪元素颗粒纹与主题纸张阴影）
  const texture = await page.locator('.sheet').first().evaluate(el => {
    const after = getComputedStyle(el, '::after')
    const box = getComputedStyle(el)
    return {
      pointerEvents: after.pointerEvents,
      bgImage: after.backgroundImage,
      opacity: Number(after.opacity),
      shadow: box.boxShadow,
    }
  })
  expect(texture.pointerEvents).toBe('none')
  expect(texture.bgImage).not.toBe('none')
  expect(texture.opacity).toBeGreaterThan(0)
  expect(texture.shadow).not.toBe('none')

  // 4. 批注弹窗 Q弹动效与清空批注（清空输入 + 清空已有高亮标记）
  const para = page.locator('.sheet .page-text p').first()
  const selectFirstFour = () => para.evaluate(el => {
    const range = document.createRange(), text = el.querySelector('span').firstChild
    range.setStart(text, 0); range.setEnd(text, 4)
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range)
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await selectFirstFour()
  await expect(page.locator('.annotation')).toBeVisible()
  const popAnim = await page.locator('.annotation').evaluate(el => getComputedStyle(el).animationName)
  expect(popAnim).toBe('annotation-pop')
  const clearBtn = page.getByRole('button', { name: '清空批注' })
  await expect(clearBtn).toBeDisabled()
  await page.getByLabel('批注内容').fill('临时批注')
  await expect(clearBtn).toBeEnabled()
  await clearBtn.click()
  await expect(page.getByLabel('批注内容')).toHaveValue('')
  await page.getByLabel('批注内容').fill('保留一下')
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  await expect(page.locator('.page-text .mark').first()).toBeVisible()

  // 4b. 悬停在被批注文本上 -> 书本外空白处弹出书边笔记浮窗，可修改与清空笔记内容
  await page.locator('.page-text .mark').first().hover()
  const marginCard = page.locator('.margin-note')
  await expect(marginCard).toBeVisible()
  await marginCard.hover()
  const noteInput = page.getByLabel('编辑笔记内容')
  await expect(noteInput).toHaveValue('保留一下')
  await noteInput.fill('改写后的书边笔记')
  await marginCard.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.page-text .mark').first()).toHaveAttribute('title', '改写后的书边笔记')
  await marginCard.getByRole('button', { name: '清空笔记' }).click()
  await expect(noteInput).toHaveValue('')
  await expect(page.locator('.page-text .mark').first()).not.toHaveAttribute('title', /.+/)
  await marginCard.getByRole('button', { name: '关闭笔记浮窗' }).click()
  await expect(marginCard).toHaveCount(0)

  await selectFirstFour()
  await expect(page.getByRole('button', { name: '清空批注' })).toBeEnabled()
  await page.getByRole('button', { name: '清空批注' }).click()
  await expect(page.locator('.page-text .mark')).toHaveCount(0)

  // 5. 沉浸模式（隐藏工具栏、显示已屏蔽通知提示、抑制通知并在退出后恢复）
  await page.getByLabel('沉浸模式').click()
  await expect(page.locator('.reader.immersive')).toBeVisible()
  await expect(page.locator('.reader-tools')).toBeHidden()
  await expect(page.locator('.reader-foot')).toBeHidden()
  await expect(page.locator('.immersive-hud')).toContainText('已屏蔽通知')

  // 在沉浸模式下投递非法文件触发报错通知，应被屏蔽不弹出
  await page.locator('.app').evaluate(el => {
    const dt = new DataTransfer()
    dt.items.add(new File(['not-epub'], 'bad.txt', { type: 'text/plain' }))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  })
  await expect(page.locator('.notice')).toHaveCount(0)

  // 按 Escape 退出沉浸模式后，被挂起的通知才显示
  await page.keyboard.press('Escape')
  await expect(page.locator('.reader.immersive')).toHaveCount(0)
  await expect(page.locator('.reader-tools')).toBeVisible()
  await expect(page.locator('.notice')).toContainText('请选择 EPUB 格式的电子书')

  // 窄屏单页翻页动画
  await page.getByRole('button', { name: '关闭' }).click()
  await page.setViewportSize({ width: 390, height: 740 })
  await expect(page.locator('.sheet')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.turn-overlay.single-turn.next')).toBeVisible()
  await expect(page.locator('.turn-overlay')).toHaveCount(0, { timeout: 1500 })

  expect(errors).toEqual([])
})
