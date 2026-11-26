import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

async function buildSampleEpub() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>纸间行旅</dc:title>
    <dc:creator>林深</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="ch1.xhtml">第一章 夜雨听书</a></li>
        <li><a href="ch2.xhtml">第二章 晨光初照</a></li>
      </ol>
    </nav>
  </body>
</html>`
  )
  const longPara =
    '窗外细雨绵绵，灯下翻开一本装帧素雅的小书，字句如溪水般缓缓流淌过掌心。在手机屏幕上也能感受到沉静而专注的阅读节奏，单页轻滑或上下滚动皆可随心切换。'
  zip.file(
    'OEBPS/ch1.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1>第一章 夜雨听书</h1>
    ${Array.from({ length: 14 }, (_, i) => `<p>第${i + 1}段：${longPara}</p>`).join('\n')}
  </body>
</html>`
  )
  zip.file(
    'OEBPS/ch2.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1>第二章 晨光初照</h1>
    ${Array.from({ length: 8 }, (_, i) => `<p>次日第${i + 1}段：${longPara}</p>`).join('\n')}
  </body>
</html>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('Android mobile full reading workflow: shelf, page mode, scroll mode, bookmarks, annotations', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByText('书架还是空的')).toBeVisible()

  // 1. Import EPUB
  const epubBuffer = await buildSampleEpub()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'sample.epub',
    mimeType: 'application/epub+zip',
    buffer: epubBuffer,
  })

  // Should open directly in Page Mode
  await expect(page.locator('.m-page-sheet')).toBeVisible()
  const foot = page.locator('.m-page-foot')
  await expect(foot).toContainText('1 /')

  // 2. Right-zone tap turns to page 2
  await page.mouse.click(350, 420)
  await expect(foot).toContainText('2 /')

  // 3. Left-zone tap returns to page 1
  await page.mouse.click(40, 420)
  await expect(foot).toContainText('1 /')

  // 4. Swipe left (pointer drag) turns to page 2
  await page.mouse.move(320, 420)
  await page.mouse.down()
  await page.mouse.move(120, 420, { steps: 6 })
  await page.mouse.up()
  await expect(foot).toContainText('2 /')

  // 5. Center tap opens floating chrome & toggle Bookmark
  await page.mouse.click(195, 420)
  await expect(page.locator('.m-chrome-top.is-open')).toBeVisible()
  await page.getByRole('button', { name: '添加书签' }).click()
  await expect(page.getByRole('status')).toContainText('已添加书签')

  // 6. Toggle Night theme and back
  await page.getByRole('button', { name: '夜间' }).click()
  await expect(page.locator('.m-reader-root')).toHaveAttribute('data-theme', 'night')
  await page.getByRole('button', { name: '日间' }).click()
  await expect(page.locator('.m-reader-root')).toHaveAttribute('data-theme', 'cream')

  // 7. Open Settings and switch to Scroll Mode (上下滚动)
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('dialog', { name: '阅读设置' })).toBeVisible()
  await page.getByRole('button', { name: '上下滚动' }).click()
  await page.mouse.click(195, 40) // dismiss backdrop
  await expect(page.locator('.m-scroll-viewport')).toBeVisible()
  await expect(page.getByRole('button', { name: /继续阅读下一章/ })).toBeVisible()

  // 8. Long-press a visible paragraph to open mobile annotation bar & save note
  const firstPara = page.locator('.m-scroll-article p').first()
  await firstPara.scrollIntoViewIfNeeded()
  const box = await firstPara.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box.x + 40, box.y + 40)
  await page.mouse.down()
  await page.waitForTimeout(500)
  await page.mouse.up()

  await expect(page.getByRole('toolbar', { name: '段落批注工具栏' })).toBeVisible()
  await page.getByRole('button', { name: '写批注' }).click()
  await expect(page.getByRole('dialog', { name: '编辑批注' })).toBeVisible()
  await page.getByLabel('批注内容').fill('手机端长按批注很顺手')
  await page.getByRole('button', { name: '保存批注' }).click()
  await expect(page.locator('.m-note-mark').first()).toBeVisible()

  // 8b. Tapping an existing highlight opens the mobile Note Viewer/Editor Bottom Sheet
  await page.locator('.m-note-mark').first().click()
  await expect(page.getByRole('dialog', { name: '编辑批注' })).toBeVisible()
  await expect(page.getByLabel('批注内容')).toHaveValue('手机端长按批注很顺手')
  await page.getByRole('button', { name: '取消' }).click()

  // 9. Verify Bookmark & Note in unified bottom drawer
  await page.mouse.click(195, 520) // open chrome on unhighlighted area
  await expect(page.locator('.m-chrome-bottom.is-open')).toBeVisible()
  await page.getByRole('button', { name: '书签笔记' }).click()
  await expect(page.getByRole('dialog', { name: '目录与书签笔记' })).toBeVisible()
  await expect(page.getByText('手机端长按批注很顺手')).toBeVisible()
  await page.getByRole('tab', { name: /书签 \(1\)/ }).click()
  await expect(page.locator('.m-item-card')).toHaveCount(1)

  // 10. Return to bookshelf and verify Continue Reading + Grid
  await page.mouse.click(195, 40) // close drawer
  await page.mouse.click(195, 520) // open chrome
  await expect(page.locator('.m-chrome-top.is-open')).toBeVisible()
  await page.getByRole('button', { name: '返回书架' }).click()
  await expect(page.getByLabel('最近在读')).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(1)
})
