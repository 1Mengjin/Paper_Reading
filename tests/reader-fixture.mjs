import JSZip from 'jszip'

export async function fixture() {
  const zip = new JSZip()
  zip.file('mimetype','application/epub+zip')
  zip.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="Book/contents.opf"/></rootfiles></container>')
  zip.file('Book/contents.opf','<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>窗边读本</dc:title><dc:creator>排版测试</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav"/><item id="one" href="chapters/one.xhtml"/><item id="two" href="chapters/two.xhtml"/><item id="pic" href="art.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>')
  zip.file('Book/nav.xhtml','<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="chapters/one.xhtml#start">窗前</a><a href="chapters/two.xhtml">归鸟</a></nav></body></html>')
  zip.file('Book/art.svg','<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32"><rect width="96" height="32" fill="green"/></svg>')
  const paragraphs = Array.from({length:155},(_,i)=>'<p>手记 '+(i+1)+'。'+'窗外的风轻轻翻动纸页。'.repeat(14)+'</p>').join('')
  zip.file('Book/chapters/one.xhtml','<html><body><h1 id="start">窗前</h1><img src="../art.svg" alt="窗景"/>'+paragraphs+'</body></html>')
  zip.file('Book/chapters/two.xhtml','<html><body><h2>归鸟</h2><blockquote>一只鸟落在窗边。</blockquote></body></html>')
  return {name:'窗边读本.epub',mimeType:'application/epub+zip',buffer:await zip.generateAsync({type:'nodebuffer'})}
}
