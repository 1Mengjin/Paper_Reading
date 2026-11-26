import { exec } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./dist/', import.meta.url))
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
}
const port = Number(process.env.PAPERPOCKET_MOBILE_PORT || 4174)
createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
  }
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const filename = resolve(root, '.' + (requested === '/' ? '/index.html' : requested))
    if (!filename.startsWith(resolve(root) + sep)) {
      res.writeHead(404).end()
      return
    }
    const bytes = await readFile(filename)
    res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream' })
    res.end(req.method === 'HEAD' ? undefined : bytes)
  } catch {
    res.writeHead(404).end()
  }
}).listen(port, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + port
  console.log('PaperPocket Mobile  ' + url)
  if (process.argv.includes('--open')) {
    const cmd =
      process.platform === 'win32'
        ? `cmd /c start "" "${url}"`
        : process.platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`
    exec(cmd)
  }
})
