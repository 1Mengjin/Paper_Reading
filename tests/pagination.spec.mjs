import { test, expect } from '@playwright/test'
for (const viewport of [{width:1200,height:800},{width:375,height:667},{width:780,height:360}]) {
  test('真实页面边界 ' + viewport.width, async ({page}) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const result = await page.evaluate(async () => {
      await import('/src/paper.css')
      const { paginate, metrics, makePart } = await import('/src/utils/epubSlicer.ts')
      const blocks = [
        {tag:'h1',text:'清晨的图书馆'}, {tag:'p',text:'有句号的长段落。'.repeat(500)},
        {tag:'blockquote',text:'山河之间'.repeat(1900)}, {tag:'p',text:'换行\n'.repeat(150)},
        {tag:'img',image:'art',text:'插图'}, {tag:'p',text:'thelongestword'.repeat(240)}
      ].map(b=>({...b,chapter:'测试章'}))
      const img = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1400"/>')
      const book = {blocks,images:{art:{src:img,width:600,height:1400}}}
      const m = metrics(), layout = await paginate(book,m,20), recovered = blocks.map(()=>''), overflow = []
      const leaf = document.createElement('section')
      leaf.className='leaf measuring'
      Object.assign(leaf.style,{width:m.width+'px',height:m.height+'px'})
      const body = document.createElement('div')
      body.className='page-text'
      leaf.append(document.createElement('header'),body,document.createElement('footer'))
      document.body.append(leaf)
      for(const [index,p] of layout.pages.entries()){
        body.replaceChildren()
        for(const part of p.parts){
          const el=makePart(book,part)
          body.append(el)
          if(el instanceof HTMLImageElement) await el.decode()
          else recovered[part.block]+=el.textContent
          if(el.getBoundingClientRect().bottom>body.getBoundingClientRect().bottom+.02 || el.scrollWidth>body.clientWidth+1) overflow.push(index)
        }
      }
      leaf.remove()
      return {overflow,intact:blocks.every((b,i)=> b.tag==='img'|| b.text===recovered[i]),pages:layout.pages.length,end:layout.volumes.at(-1).end}
    })
    expect(result.overflow).toEqual([])
    expect(result.intact).toBe(true)
    expect(result.end).toBe(result.pages)
  })
}
