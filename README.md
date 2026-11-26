# PaperPocket（双端独立版：PC 端 + 安卓手机端）

本项目已按平台完整分类，PC 端与安卓手机端各自独立存放、独立运行、数据独立存储（不做多端互通），便于快速定位与维护文件。

## 目录结构分类

```text
EQUBreading/
├── pc/                       # PC 桌面端完整项目（双页纸质摊开 / 分册书架 / 书边批注）
│   ├── src/                  # PC 端源码
│   ├── sound/                # PC 端白噪音与翻页音效
│   ├── tests/                # PC 端 Playwright 测试
│   └── 启动PaperPocket.bat    # PC 端启动脚本
├── mobile-android/           # 安卓手机端完整项目（React + Vite + Capacitor Android）
│   ├── src/                  # 手机端专属 UI（三列书架 / 单页翻页 & 上下滚动 / 触屏批注）
│   ├── sound/                # 手机端独立音效资源
│   ├── android/              # Capacitor 生成的完整 Android 原生工程（可打 APK）
│   ├── tests/                # 手机视口 (390×844) 自动化测试
│   └── README.md             # 安卓端开发与 APK 打包指南
├── 启动PC端.bat               # 根目录快捷启动：运行 PC 端
└── 启动手机端预览.bat          # 根目录快捷启动：在浏览器中预览安卓手机端界面
```

## 快速启动

### PC 端
双击根目录 `启动PC端.bat`，或命令行运行：
```sh
cd pc
npm install
npm run build
npm run preview
```

### 安卓手机端
- **电脑浏览器快速预览**（建议打开 F12 切换手机模式）：双击根目录 `启动手机端预览.bat`，或在 `mobile-android/` 运行 `npm run dev`。
- **打包安装到安卓手机（APK）**：详见 [mobile-android/README.md](./mobile-android/README.md)。
