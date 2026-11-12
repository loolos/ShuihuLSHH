# ShuihuLSHH

《水浒传之梁山好汉》（1999）网页版战棋 RPG 重制项目，技术栈 Phaser 4 + TypeScript。

## 试玩

在线试玩：<https://loolos.github.io/ShuihuLSHH/>（电脑浏览器体验最佳，手机也能打开浏览）

> **声明：本项目仅供个人学习与试玩，不做任何商业用途。**
> 《水浒传之梁山好汉》的游戏内容、美术、文字等版权归原出版公司所有。请勿将本项目或其中的原版文件用于销售、收费或其他商业目的。如有侵权，请联系删除。

`gamedata/shuihu/` 存放原版游戏文件（不含音效与片头），供开发和网页试玩时读取。

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

发布版（GitHub Pages）首次打开时，会从本仓库的 `gamedata/shuihu` 下载原版文件（约 65 MB），之后缓存在浏览器里。下载失败时才需要选择本机的原版游戏目录。
