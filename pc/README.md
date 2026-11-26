# Paper_Reading
在本地网站给你带来纸质阅读感受，内置白噪音播放器

## 本地运行

使用 Node.js 22。首次安装依赖后，可断网使用。

```sh
npm install
npm run build
npm run preview
```

浏览器打开 http://127.0.0.1:4173 。开发时使用 `npm run dev`。同一浏览器使用同一地址，可以保留书架、阅读进度、折角和笔记。

点击「导入 EPUB」或将书拖入窗口。在分册书架选择薄册后，用方向键、空格或页边翻页。设置中可以切换纸张与每册页数。点右上角折角，选中文字添加笔记，点底部耳机调节声景。

## 浏览器验证

```sh
npx playwright install chromium
npm test
npm run build
node tests/production.mjs
```

也可运行 `node start.mjs` 启动已构建的 `dist/`。两者放在同一目录，即可在装有 Node.js 的电脑上离线阅读。
