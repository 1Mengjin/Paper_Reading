# PaperPocket Android 手机端

基于 React + TypeScript + Vite + Capacitor 构建的安卓端本地 EPUB 阅读器，与 PC 端完全独立（数据独立存储在本地 IndexedDB `paperpocket-android-*`）。

## 手机端专属体验设计

1. **双模式阅读（参考番茄小说 / 起点小说）**
   - **单页翻页模式（默认）**：支持左右跟手滑动翻页、左/中/右三区点击（左 30% 上一页、中 40% 呼出菜单、右 30% 下一页）、翻页音效与动态重新排版。
   - **上下滚动模式（可选）**：在「设置 -> 翻页方式」中一键切换，按章节流畅上下滚动，切换模式时自动保留当前段落位置。
2. **手机端书架改造**
   - 顶部「最近在读」卡片（带进度条与一键继续阅读）。
   - 三列封面书架 / 列表视图切换、书名作者搜索、置顶与删除管理。
3. **书签与批注触屏适配**
   - **书签**：呼出顶栏一键添加/取消书签，自动记录章节名、正文摘录与时间，支持底部抽屉统一跳转与删除。
   - **批注**：长按任意段落（约 0.4 秒）或直接选中文本，弹出底部触屏工具栏（高亮 / 划线 / 写批注 / 复制）；点击已标记文字可直接弹出底部批注卡片查看、修改或删除。
4. **阅读设置与声景**
   - 字号（14–28px）、行距（紧凑/适中/宽松）、字体（书版宋体/温润文楷/清爽黑体）、5 套护眼纸张主题（含一键日/夜切换）、内置雨声/棕噪音/翻页白噪音。

## 本地开发与手机视口测试

```sh
cd mobile-android
npm install
npm run dev       # http://127.0.0.1:4174
npm run build     # 类型检查 + 生产构建
npm run cap:sync  # 将 dist/ 同步到 android/ 原生工程
```

## 打包安卓 APK 的两种方式

> 注意：打包 `.apk` 需要 **Android SDK** 与 **JDK 17 或 JDK 21**（Gradle 8.x 暂不兼容 JDK 24）。

### 方式一：本地使用 Android Studio 打包（推荐）
1. 安装 [Android Studio](https://developer.android.com/studio)（内置 Android SDK 与兼容的 JBR/JDK 21）。
2. 在 `mobile-android/` 运行：
   ```sh
   npm run cap:sync
   npm run cap:open
   ```
3. 在 Android Studio 中等待 Gradle 同步完成，点击菜单 `Build -> Build Bundle(s) / APK(s) -> Build APK(s)` 即可生成安装包。

### 方式二：GitHub Actions 云端自动打包（无需本地安装 Android Studio）
将代码推送到 GitHub 后，仓库内置的 `.github/workflows/android-apk.yml` 会自动编译并上传 `PaperPocket-Android-debug.apk` 到 Actions Artifacts，直接下载安装到安卓手机即可。
