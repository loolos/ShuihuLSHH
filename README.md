# ShuihuLSHH

《水浒传之梁山好汉》（1999）网页版战棋 RPG 重制项目，技术栈 Phaser 4 + TypeScript。

本仓库为**私有**，仅供个人使用。`gamedata/shuihu/` 存放原版游戏文件（不含音效与片头），供开发时读取，版权归原出版公司所有

## 文档

- [docs/game-design.md](docs/game-design.md)：游戏设计。实现时以它为准，包括规则、内容、界面、架构和里程碑。
- [docs/binary-formats.md](docs/binary-formats.md)：原版文件格式和字段，以及 EXE 中的数据与代码地址。
- [docs/reference/](docs/reference/)：自动生成的参考资料，用 `npm run gen:docs` 生成，不要手改。包括：
  - 规则数据表、关卡简报；
  - 剧本（简体和繁体）；
  - 原版文件清单（含 SHA256）。

## 开发

```bash
npm install
npm run dev     # 打开 http://localhost:5173 ，开发模式直接读取 gamedata/shuihu
npm test
npm run build
```

发布版（GitHub Pages）首次打开时，会从本仓库的 `gamedata/shuihu` 下载原版文件：启动时只下载几 MB 的基础文件，每关再下载本关用到的人物动画和图块，下载过的都缓存在浏览器里。下载失败时才需要选择本机的原版游戏目录。
