# 原版文件清单（file-inventory）

> 对象：《水浒传之梁山好汉》（红蚂蚁工作室制作，智冠科技 1999 发行）本地副本
> 来源目录：`M:\game\卡牌&战棋\水浒传2\shuihu`（只读访问；全部文件复制到隔离的临时分析目录后离线分析，**未运行任何 EXE，未修改任何原文件，未把任何原版文件放进本仓库**）
> 生成日期：2026-11-11
> 置信度约定：**高** = 对全部样本做了程序化验证；**中** = 结构吻合、语义由旁证推断；**低** = 仅为假设，需进一步验证。

## 1. 总览

| 项 | 值 |
|---|---|
| 文件总数 | 528（`save\` 为空目录） |
| 总大小 | 98,520,479 B（约 94 MB） |
| 字节完全相同的重复组 | 33 组（见 §5） |
| 主程序 | `ShuiHu.exe`，PE32 i386 GUI，MSVC 6.0 链接器，链接时间戳 1999-06-21 02:24:52 UTC，MFC 程序 |
| 启动器 | `Autorun.exe`，PE32，时间戳 1999-06-17，光盘自动运行菜单（`AutoRun.inf` → `RUN=AutoRun.exe`） |
| 文本编码 | 程序本体与运行时数据为 **Big5**（繁体）；另附一套未被程序引用的 GB2312 副本（`.pas`、`Goods.dat/.big`） |

`readme.txt`（GBK）说明本副本是网友修正过"不能存盘"问题的重新打包版，`game.ini`、`readme.txt` 的修改时间（2005-01）晚于其它文件（1998-07），与此吻合。

## 2. 目录与类别统计

| 目录 | 扩展名 | 数量 | 字节数 | 类别 | 说明 |
|---|---|---:|---:|---|---|
| 根 | exe | 2 | 806,912 | 执行文件 | `ShuiHu.exe` 主程序、`Autorun.exe` 启动器 |
| 根 | ini/inf/txt | 4 | 1,423 | 配置/说明 | `game.ini` 选项、`music.ini` 141 项映射、`AutoRun.inf`、`readme.txt` |
| Data | lib | 5 | 59,471,461 | 图像/动画 | `Man.lib`（人物动画 26,021 帧）、`Effect.lib`（特效 998 帧）、`Panel.lib`（UI 112 帧）、`Head.lib`（头像 79 张）、`Object.lib`（道具图标 200 张） |
| Data | grp | 3 | 4,342,389 | 地图图块 | `Ground.grp` 758 块地表、`Upper.grp` 1018 个地上物、`Grid.grp` 5 个格子光标 |
| Data | att | 2 | 4,112 | 图块属性 | `Ground.att`、`Upper.att`，各 2048 个 u8 标志 |
| Data | 16f/24f | 2 | 1,453,192 | 字库 | Big5 全码位点阵字库，16×16 与 24×24 |
| Data | pal/tbl | 2 | 66,304 | 调色板/LUT | 256 色调色板；256×256 混色表 |
| Data | dab/dat/big | 3 | 118,833 | 道具数据 | 200 件道具；`.dab`=Big5（程序读取），`.dat/.big`=GB2312 副本 |
| Data | hum | 1 | 21,201 | 角色数据 | 72 个职业的成长值与技能表 |
| Data | map/act/pab/pas | 5 | 40,156 | 关卡（游离副本） | 与 `Map\` 下同名文件相同或为旧版本，程序不从 `Data\` 读取关卡 |
| Map | map | 63 | 498,102 | 地图 | 63 张战场格子图 |
| Map | act | 63 | 85,357 | 关卡单位 | 每张地图的单位/宝物配置 |
| Map | pab | 63 | 103,458 | 剧本 | Big5 事件脚本与对白（程序读取） |
| Map | pas | 63 | 103,462 | 剧本 | GB2312 版本（程序不读取） |
| Sound | wav | 245 | 29,863,896 | 音效/语音 | 全部为 PCM WAV，合计约 348 秒 |
| Title | flc | 2 | 1,540,222 | 过场动画 | `Logo.flc`（109 帧）、`Redants.flc`（150 帧），640×480×8，57 ms/帧 |

## 3. 识别结果（按用途）

| 用途 | 文件 | 识别依据 | 置信度 |
|---|---|---|---|
| 执行文件 | `ShuiHu.exe`、`Autorun.exe` | `MZ`/PE 头；导入表 | 高 |
| 资源包（图像） | `Data\*.lib`、`Data\*.grp` | 文件头魔数 `LIB\0`/`PIC\0`/`GRP\0`；`ShuiHu.exe` 中硬编码 `data\man.lib` 等路径 | 高 |
| 地图 | `Map\*.map` + `Data\Ground.grp/Upper.grp/*.att` | `MAP\0` 魔数；63 张图全部按同一结构解析到文件末尾；图层引用的最大图块号 < 图块库数量 | 高 |
| 图像 | `Head.lib`（头像）、`Object.lib`（道具图标）、`Panel.lib`（界面）、`Effect.lib`（特效） | 全部帧解码后像素数与宽×高完全一致，用 `Default.pal` 渲染画面正确 | 高 |
| 人物 Sprite | `Man.lib` | 同上；帧按 4 方向成组 | 高（结构）/ 中（动作语义） |
| 音乐 | **本副本中不存在** | `music.ini` 141 条映射值为 2..24；程序导入 `mciSendCommandA`；`Sound\` 内最长的 WAV（`s136.wav`）仅约 4.2 秒 | 中（推断 BGM 为光盘 CD 音轨） |
| 音效/语音 | `Sound\*.wav`（`s*`、`m*`、数字名、`tt*`、`Logo`） | RIFF/WAVE PCM | 高（格式）/ 低（各编号含义） |
| 文本 | `Map\*.pab`（对白 853 句）、`Goods.dab`（道具名与说明）、`ShuiHu.exe` 内字符串表（角色名 40、技能名 256、章节名） | Big5 解码成功；`%X` 为主角名占位符 | 高 |
| 角色属性 | `Data\Human.hum` | 72 条记录精确消耗整个文件；与 ChillWhiteDid/Shuihu-Editor 的解析一致 | 高（结构）/ 中（字段语义） |
| 技能数据 | `Human.hum` 子记录（技能 ID、学习等级、隐藏标志）+ `ShuiHu.exe` 技能名表 | 同上 | 高（名称/等级）/ 低（威力、范围等数值未定位） |
| 道具数据 | `Data\Goods.dab` | 11 B 头 + 200×198 B，精确吻合 | 高（结构）/ 中（部分字段） |
| 关卡单位 | `Map\*.act` | 11 B 头 + n×38 B，63 个文件全部精确吻合 | 高（结构）/ 中（字段） |
| 字库 | `Stdfont.16f/.24f` | 文件大小 = 13,973 字 × 32 B / 72 B，13,973 = Big5 0xA1–0xF9 共 89 行 × 157 列；渲染"水滸"正确 | 高 |

## 4. 程序引用但本副本缺失的文件

| 程序中的路径字符串（`ShuiHu.exe`） | 状态 | 影响 |
|---|---|---|
| `title\tigeravi.avi`、`title\tailavi.avi` | 缺失 | 片头/片尾 AVI 视频（程序导入 `AVIFIL32`、`MSVFW32`） |
| `tiger` + `.pcx` | 缺失 | 推测为与 tiger 视频配套的图片，用途未知 |
| CD 音轨（推断） | 缺失 | 背景音乐无法从本副本提取 |
| `ShuiHu.org`（Shuihu-Editor 引用的"原始未改 EXE"） | 本副本无此文件 | 不影响：Editor 的硬编码地址在本副本 `ShuiHu.exe` 上读出的角色名/技能名表完全正确（见 extraction-plan.md §1） |
| `save\save*.sav` | 目录为空 | 无存档样本，存档格式只能参考 Editor 的结论 |

## 5. 重复与变体

**字节完全相同（SHA256 相同）：**

- `Data\N-add14.map` = `Map\N-add14.map`；`Data\N12.map` = `Map\N12.map`；`Data\N01.act` = `Map\N01.act`
- 地图复用：`Act11-1/Act11-2`、`Act14-3/N14`、`Act2-2/N-add02`、`Act2-3/Act3-1`、`Act3-2/Act3-4`、`Act5-1a/N-add05`、`Act6-2/Act7-1`、`Act7-1a/N07`、`N-add06/N-add12`、`Train1/Train2`（`.map` 相同，`.act`/`.pab` 不同 → 同一场景不同关卡）
- 音效：21 个 29,356 B 的 `s*.wav` 完全相同（`s41, s75, s88–s90, s100, s124, s159, s168, s169, s174, s178, s182, s187, s193, s199, s200, s206, s207, s213, s214`），另有 19 组 2–6 个文件相同（详见下表备注列）

**内容变体（不同）：**

- `Goods.dab`（Big5）/ `Goods.dat`（GB2312）/ `Goods.big`（GB2312）：数值区完全相同，只有文字编码不同；`.big` 与 `.dat` 仅第 62 条记录（魔星草人）末尾 26 字节不同。
- `Map\*.pab`（Big5）/ `Map\*.pas`（GB2312）：62/63 对长度相同，`Act6-3` 不同（2561 vs 2565）。
- `Data\N14.pab/.pas`（2829 B）与 `Map\N14.pab/.pas`（2752 B）不同，`Data\` 下为另一版本（推测为开发残留）。
- `ShuiHu.exe` 只引用 `goods.dab`、`.pab`（字符串 `pab`、`PAS`），**不**引用 `.dat/.big/.pas`。

## 6. 关卡顺序（来自 `ShuiHu.exe` 0x430F0 处的 76 项指针表）

`ShuiHu.exe` 文件偏移 0x430F0（VA 0x4430F0）有一张 76 项的地图路径指针表，其中 13 项指向空串（推测为章节分隔或未用槽位，用 `·` 表示）。按表内顺序：

```
n01 n-add01 · n-add02 act2-2 act2-3 n02 n-add03 act3-1 act3-2 act3-3 n03 act3-4 ·
n-add04a n-add04b act5-1a n-add05 · act4-2 act4-3 n04 act5-1 n-add06 train1 n-add07
act5-2 act5-3 n05 · act6-1 act6-2 n-add08 act6-3 n06 · act7-1 act7-1a n07 · ·
n-add09a n-add09b act8-1 n-add10 n08 act9-1 n09 · n-add11 act10-1 act10-2 n-add12
act11-1a n10 act11-1 act11-2 n-add13 n11 · · n-add14 · n12 · act13-1 n-add15
act13-2 n13 act14-1 · n-add16 train2 act14-2 act14-3 n14
```

置信度：表的存在与内容为**高**；"表内顺序 = 游戏推进顺序"为**中**（与 `n01…n14` 递增一致，但尚未在游戏内核对）。

## 7. 完整文件表

格式列为本次分析的识别结果，各格式的详细结构见 [binary-formats.md](binary-formats.md)。

| 路径 | 大小(B) | SHA256 | 格式 | 类别 | 备注 |
|---|---:|---|---|---|---|
| `Autorun.exe` | 495616 | `792496021fbb4d2fe752ddee72149989eb1acfcf1efd47b5938be737a52a85bc` | PE32 可执行文件 (i386 GUI) | 执行文件 |  |
| `AutoRun.inf` | 44 | `7399d82c8511df9d3788ca0a98abaf62a136e9fb4530293489c7210468b15e9a` | INI 文本 (AUTORUN) | 配置 |  |
| `Data/Default.pal` | 768 | `e48cb32dcce16181bb6f06bb51538cae3fb3b2f2a5089c1d93efeb02938c730f` | 256 色调色板 (RGB888×256) | 调色板 |  |
| `Data/Default.tbl` | 65536 | `bc71a07362c73d524cf58c2a6d73a154c89102564078f00d40ee9504da998151` | 256×256 调色板混色查找表 | 渲染查找表 |  |
| `Data/Effect.lib` | 4353885 | `ed87e7df5498c1748defb9f344f8ba25cbed7d41e2090a6e6bb02afede9e9483` | LIB 动画帧库（帧+动作组表+索引） | 图像/动画 |  |
| `Data/Goods.big` | 39611 | `1f72a71d856af51440fbd56f7f46d26eab48081d146bb322c1d2a5e34dc681b0` | GOO 道具表（GB2312） | 道具数据 |  |
| `Data/Goods.dab` | 39611 | `7e8cc85b6fa9e870dc2a46d404b685278aa3bc6f30f17635a0840002f5d24440` | GOO 道具表（Big5） | 道具数据 |  |
| `Data/Goods.dat` | 39611 | `988f13cea808cdd1163713a42268f3c216965ed0dd5872872c158b309433ea3e` | GOO 道具表（GB2312） | 道具数据 |  |
| `Data/Grid.grp` | 9702 | `694519a518ed32e3973574e6fbeba6e4bf5e6adaea6bbf3053fcbefcfdb53140` | GRP 图块库（索引+PCX/PackBits RLE） | 地图图块 |  |
| `Data/Ground.att` | 2056 | `0d59dde147d610b6f72f618378bc9940262a23c12ba271fc21f77108e3191fa1` | 图块属性表（8B头+2048×u8） | 地图图块属性 |  |
| `Data/Ground.grp` | 1101075 | `e1c8d09165aaa9c9d7273f66152c0ded515910548a82a7ba5b63d991a0e8eea8` | GRP 图块库（索引+PCX/PackBits RLE） | 地图图块 |  |
| `Data/Head.lib` | 1228366 | `66ad21946647feb023549349aa7c3972ee8e696f9df2129d3fd40b5ef6fb313e` | PIC 图像库（索引+RLE） | 图像 |  |
| `Data/Human.hum` | 21201 | `0b463eda1208112c6239aeecb9a96bdf8057dfdb78f9ea19003531a12c1943ce` | HUM 职业/角色成长表 | 角色属性/技能 |  |
| `Data/Man.lib` | 51629103 | `b92f99873c04fc457bd67b81525b3826b1c97e4559671816bdd9729688c8d2d4` | LIB 动画帧库（帧+动作组表+索引） | 图像/动画 |  |
| `Data/N-add14.map` | 16749 | `c5c713398fffd9cb08ecdb2ef5bc5207cf00c31fa673f0552ed776fb4c367659` | MAP 战场格子图层 | 地图 | 与 Map/N-add14.map 字节相同 |
| `Data/N01.act` | 999 | `5edf91552e3490a0da033a32d60e5734f0cdd326ec9ef1444be5f93b7e33e987` | ACT 单位配置表（38B/条） | 关卡单位 | 与 Map/N01.act 字节相同 |
| `Data/N12.map` | 16749 | `9090a82de4c17fb2e9c3ff8bf921339a4b089ad64c28f398b5971dc713f53efa` | MAP 战场格子图层 | 地图 | 与 Map/N12.map 字节相同 |
| `Data/N14.pab` | 2829 | `38440a7f1247aa72ce3257b9967ceebec6df943f4c396de45d7705532988f856` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Data/N14.pas` | 2829 | `072cbde1323c43419625b61bff3c7970d07b5e0db8405bb72c5991ee5086e2cd` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Data/Object.lib` | 94564 | `79b63a6b517aeac97fe9fdda7e4766c328734c493d1b210dedd657af657c5798` | PIC 图像库（索引+RLE） | 图像 |  |
| `Data/Panel.lib` | 2165543 | `890788f0ec3ffb608584bdc06ac17f73d4f06700bc374d89a5d1dbd7f1a87823` | LIB 动画帧库（帧+动作组表+索引） | 图像/动画 |  |
| `Data/Stdfont.16f` | 447136 | `8d395791f14395b18f8afd98204856e3a836a1b4497de41e4bb701de2fc19c40` | Big5 点阵字库 16×16 1bpp | 字库 |  |
| `Data/Stdfont.24f` | 1006056 | `234d0bed3c6d6d8d7b2601a22a5e94dd65bd07b40d7498bcec207deda1238fb3` | Big5 点阵字库 24×24 1bpp | 字库 |  |
| `Data/Upper.att` | 2056 | `dbdceb73fc5528706808e1a1c860f5555bb94a92418a8c0191c7d248558bd02c` | 图块属性表（8B头+2048×u8） | 地图图块属性 |  |
| `Data/Upper.grp` | 3231612 | `4e12f621e7f9abc8d77a8d2b8e3712ec836a7621f6243a063cd43687cca7649c` | GRP 图块库（索引+PCX/PackBits RLE） | 地图图块 |  |
| `game.ini` | 101 | `b9e770956111cb9d7aa7f7ac30d9ffd938c364d2c67b953c463ff34205bdf261` | INI 文本 | 配置 |  |
| `Map/Act10-1.act` | 505 | `f710ce806aeff8a9b3ef837df298832a7e9ad56182aedefa2f3909415c95405c` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act10-1.map` | 2119 | `465a54486ccb17b7dd2ce83a4652e2abc7784faf34c2e6b1d5862a05ae6280d0` | MAP 战场格子图层 | 地图 |  |
| `Map/Act10-1.pab` | 3270 | `32a593da2e0ba5b4cd9c7816d21c49e51b62f9be3fdf040a60432100ed384a1f` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act10-1.pas` | 3270 | `d432261ec80a12054f328dbd8d0ff8449972c7d85d45a39df9d0b212451062db` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act10-2.act` | 467 | `e3b2261899f5d0b81b5320defa1a81c09b6e354c197ccf2f7cd62c27afe739da` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act10-2.map` | 2124 | `2a3bdd40144af667bd041d23051c14870e1808b3d6ff6661de0db852c72636ca` | MAP 战场格子图层 | 地图 |  |
| `Map/Act10-2.pab` | 1985 | `37dfc633378e642b2f5490107626cf63b29e3f796e96e719c9f86a57b212d9b1` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act10-2.pas` | 1985 | `816e2276bfb1a20d7c9b4823169e61c58880375735d76fa0e5f700c11cb050c1` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act11-1.act` | 277 | `e2ac61a6cdf7a6f2394811eb26d4f9d4b5d5f887cc57119f9e01771ea8bbdaa1` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act11-1.map` | 1844 | `b4e1aaea9e51869d3521a06ec902bc81faef4610619387baf6a448b629f35daf` | MAP 战场格子图层 | 地图 | 与 Map/Act11-2.map 字节相同 |
| `Map/Act11-1.pab` | 1778 | `f17021371d3cfc8b773c2b1f0b86b78a44e0d639a2ffdb01bcd7fdaeae8c1dad` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act11-1.pas` | 1778 | `dcb4bfe7704aae5efa4e884995b5f4ec34c898c8b0e365e73ef03f2b6bb5fecf` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act11-1a.act` | 1455 | `a799afdb05c0bd96863cbc8e53a8c620e5273144b7bedaa0126afb955fffb8c7` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act11-1a.map` | 8564 | `ee7f5947cda20f46f7b44372408f6b76ba3e20ada3757bd2a0cae7ad700e2c30` | MAP 战场格子图层 | 地图 |  |
| `Map/Act11-1a.pab` | 1442 | `5dc44909b6e2f2e83c9a4c10f7a71d64ad2dbfeba08992e2c2e83dbaeada8ef5` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act11-1a.pas` | 1442 | `4bd5ed987b10c8cdb3956020c920175b530a02b35d1f46dc05d6a1e63f960732` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act11-2.act` | 429 | `f85478722bf8258eab3f0c75cf92b387efb4d0852b856d4b2fafe5f493de7af3` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act11-2.map` | 1844 | `b4e1aaea9e51869d3521a06ec902bc81faef4610619387baf6a448b629f35daf` | MAP 战场格子图层 | 地图 | 与 Map/Act11-1.map 字节相同 |
| `Map/Act11-2.pab` | 1577 | `3caa1e9042dd570dc82d5d450794196833f2819ff9a8802bd06fbbacbb7137d4` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act11-2.pas` | 1577 | `99675ee5de68dd2e2669c6253df273cbd4260f9a40ca21db9761f4425d225ea2` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act13-1.act` | 619 | `6441a0eb1ca2601cf64c5740be1aeaa8233b01ac59e3ea8e6347c4936e7e652d` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act13-1.map` | 1864 | `bd2c5504cc2b15560408bffc7d273ac090f7db7b7d7efc4c725eaa78442481c5` | MAP 战场格子图层 | 地图 |  |
| `Map/Act13-1.pab` | 1316 | `df344a975d84ffa572bb3d729a084ec1b05c365aeff97a3695b5a8a3b910fd78` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act13-1.pas` | 1316 | `1946010c6bc37b546d2e41071474977d8710eb02c2de1df4145d773c4b5b77ce` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act13-2.act` | 467 | `1875765ed80a911602c2d424f06302e8a8c3a63d4711e8bbade47a5081a23a98` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act13-2.map` | 1939 | `cec9ed58f8c665b67a9b808cab8e5af0c957738bf7ab89a2eafec87932a0a089` | MAP 战场格子图层 | 地图 |  |
| `Map/Act13-2.pab` | 1068 | `c65520127d6adc66c8a75c3e07b241ed9bba329913d89897cfe8f1f678e49853` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act13-2.pas` | 1068 | `d1389e8fce1750b8c98dd3d42e03b82edecd42979aba49ccf86eaf2405d39d04` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act14-1.act` | 581 | `7bf27e5d97cf01163b35535fe9b9d0e0caa814360a40cee2d5a2dc343b663314` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act14-1.map` | 1914 | `9fd58dd96e762505c399a2bb6d03530371f9a2b27ab17f1be89c734d871b5920` | MAP 战场格子图层 | 地图 |  |
| `Map/Act14-1.pab` | 2687 | `732fe123412f40f9cbfd6dbf9b96ed346f2f7a4cdc999744c76468eaecb685c8` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act14-1.pas` | 2687 | `9ae0373368dfa689066e532c5c38fc807c53b445acf806e7e015852ec69fbc1b` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act14-2.act` | 1455 | `93173de391f33fb33c7fcce0a1d1603f08a2aa4844fe1456ba3f63ebe6fdb514` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act14-2.map` | 1849 | `420a86dfa6aa33e43fa6040368d28fc980223e80f4b71b9f28d97f2f30c083ab` | MAP 战场格子图层 | 地图 |  |
| `Map/Act14-2.pab` | 1717 | `b7e73d0092c7f68293feb4874989894e0c58ec0f44a8b11afacab03d5fb068c6` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act14-2.pas` | 1717 | `61abf47b3d9d7c01b2c8a8fbbec414182d2c40b677c274ab28f0a5903b772287` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act14-3.act` | 1303 | `b505a0a5dfa96bd811fa749b8e2baf8ce8bd7315dd236aa4ee420a34f1c0b3ad` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act14-3.map` | 17979 | `d3c99600bd5de7b95133d80ac888aeec3d402ae7f6e2dcc55cea48ae1a322cd4` | MAP 战场格子图层 | 地图 | 与 Map/N14.map 字节相同 |
| `Map/Act14-3.pab` | 1739 | `da8578c4d1a9de9feacedeaf98a8ceb3627027e160110a348fe7459c0dfbc4f4` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act14-3.pas` | 1739 | `be17ba6709e35ce37d4410c12d2ac3600251540b95060e73d46a2775cfe8aded` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act2-2.act` | 201 | `3cb49fc780f7cc679cb346d88802b26b320fffb76b5ef29aa32cae172b129f84` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act2-2.map` | 1874 | `1a2986a5f7fcadcae703bfa1b88ddf3e40aa91ce2680865232a3f218e10901ac` | MAP 战场格子图层 | 地图 | 与 Map/N-add02.map 字节相同 |
| `Map/Act2-2.pab` | 2101 | `35674838b619ed6b8c0af4b6554303a540756e8a27348703731439f01d5b23f9` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act2-2.pas` | 2101 | `bec82e126c12835ab0ee1786fb4c8580999b0d10d3ce635f153eb3da5fc5c038` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act2-3.act` | 581 | `9efa5e8b00ad50335d70565e3e16c1c67e3504d4e1065def8dd378400b6f5a44` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act2-3.map` | 1864 | `939a212efedf69ec91b3d9806d9926087d2f9b6026b36729f5bef89e8abbf8b2` | MAP 战场格子图层 | 地图 | 与 Map/Act3-1.map 字节相同 |
| `Map/Act2-3.pab` | 1366 | `12aed72010aaeb5b2ce8fb2dc40e9c69cc4aeb1f31dcf0935ecd11578bbbbbef` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act2-3.pas` | 1366 | `f38ca448bce57b9df5e3690c7591b19512d4d741345ce981ae879f0c59e3b333` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act3-1.act` | 581 | `75681ca1c0ec5420d4438da00f060adeb81e503a1728b3829ccacc59c19e8064` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act3-1.map` | 1864 | `939a212efedf69ec91b3d9806d9926087d2f9b6026b36729f5bef89e8abbf8b2` | MAP 战场格子图层 | 地图 | 与 Map/Act2-3.map 字节相同 |
| `Map/Act3-1.pab` | 815 | `ac364468c851f85ef9afd61a9090e869cf15d09077c2b34ae66bde258244a841` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act3-1.pas` | 815 | `98b0a69b1e24e595f4f22c5861e4a9b596b9c73826a5ec5022e677f1a978e5f2` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act3-2.act` | 695 | `af01b86c3d30605d643773086c3376860affe98104b1762f03413f110b461d70` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act3-2.map` | 1869 | `2990cd60b2f778e68043d595e6d37ccbb4a3e3360044bbe2b5b580e29698d3a5` | MAP 战场格子图层 | 地图 | 与 Map/Act3-4.map 字节相同 |
| `Map/Act3-2.pab` | 1906 | `2d296805152569a4d7fd5889bea8f25383f675668c67b4bf8ffdced76c48a8d8` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act3-2.pas` | 1906 | `6452c7a4f2db250e44657d4b0ebe1bd57937151085414c8945c731f5eabdb2aa` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act3-3.act` | 695 | `eb6e5416d7c8080954f172defce3ba38207ac079af63edfe812bcf7461767ac4` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act3-3.map` | 1849 | `a195aeebce431674a31e7cd05d1c6af5199b91bc1d2192b4e3ea3358e51d03a0` | MAP 战场格子图层 | 地图 |  |
| `Map/Act3-3.pab` | 805 | `02ede6d0815aa35edeb7164ee0c58cb8f2b66f8d569be862341d3c654433969c` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act3-3.pas` | 805 | `dcb2d754713ec970223bdd49619ed936b3700fac4b7b88b773ec1ceb29b16057` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act3-4.act` | 277 | `9eff2612f8728c09cf658166dcc21998e14533d93b0140b92d080ccb05ef48f6` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act3-4.map` | 1869 | `2990cd60b2f778e68043d595e6d37ccbb4a3e3360044bbe2b5b580e29698d3a5` | MAP 战场格子图层 | 地图 | 与 Map/Act3-2.map 字节相同 |
| `Map/Act3-4.pab` | 954 | `47c58768ae8076b882e60475267cc8e8dc372a000e220a40a2d21ba490c87ab6` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act3-4.pas` | 954 | `e3d4a4517fbc5618f79ad67f8ec32c59a7049b551cc0c0949f36e0bec5fa9749` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act4-2.act` | 201 | `07080e642795ccbc50f778733dc81596a5173600f07e2b6299ed2604a239e340` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act4-2.map` | 2019 | `3d7dbf20b782b45772a4b6e3e34f74dc7c431f486c43af718d185758a6971bf3` | MAP 战场格子图层 | 地图 |  |
| `Map/Act4-2.pab` | 789 | `f3489cf5442109cf89c39e8429339c2a32b0deee0829d9ebd4306b7052769835` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act4-2.pas` | 789 | `2ff830bd5ce55fd537ec393d76059921d3e47b30b46f593a8a773e9da6806fd9` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act4-3.act` | 353 | `0d8b2ad7daf73d40680653bbed10378c9c31443118e03133c51a1b6ed8bef228` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act4-3.map` | 1889 | `5a5c1d39cbd460eb7d894a1e22adf3ef98635858b80c2cf68cc917d7a1055b93` | MAP 战场格子图层 | 地图 |  |
| `Map/Act4-3.pab` | 1082 | `a26b80066cb126b7c313357af154c07781da9238f0737228ba3cd8dc2d422cd4` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act4-3.pas` | 1082 | `bece12dd1b3c9b631044e4136689df361a70ccd6d3b28eb4c3fb910a40d41af1` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act5-1.act` | 391 | `5fdfb17173311127eb71814d6c287134058b03863ae96113bcb3126605d7415b` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act5-1.map` | 1894 | `aea702722c61a2cf930a4ea058b8e9e0116f79deba6bdf7a19bc02239864321e` | MAP 战场格子图层 | 地图 |  |
| `Map/Act5-1.pab` | 2820 | `8f3184f34c772c419ee9fb5e937072e0475a0d7a976ad8f38c5931399b678a39` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act5-1.pas` | 2820 | `90e2dce42a9c635964decdbdc93d5e2c321d13f4535700e4cd3f4eb5f03182e4` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act5-1a.act` | 239 | `cfc2786de93c1f9eead8485d7533464f53ab427b66a0efaf8ca0f7c9a71725b8` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act5-1a.map` | 8714 | `b52c9d4498f2966b0678fbd84420cd582b40bb362f40df95c7770a42146d0597` | MAP 战场格子图层 | 地图 | 与 Map/N-add05.map 字节相同 |
| `Map/Act5-1a.pab` | 565 | `6d31f686117a6e48586bc94fc36560e5cd313c9911aa709260ed8c068f9f19c5` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act5-1a.pas` | 565 | `df544e48a81e8cf656c588083106f69a25d146ff42817e1487e5dc51e0a35298` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act5-2.act` | 353 | `a029237daf3935f06f303e0217af55b77b3cdb25c318880c7c0acc4f0d3292ed` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act5-2.map` | 2044 | `31097ccac9533831ac4a307e7900c4f42ae0c9bdddabb0fca1ca7a24f8895957` | MAP 战场格子图层 | 地图 |  |
| `Map/Act5-2.pab` | 2089 | `9f2b0cbbb48a5439989b8d9c1adca55b08c3102238a20f4e54d28707ce296450` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act5-2.pas` | 2089 | `cad1e8e3fb8cb214325f45ffb3ab584a071e5da136f4661cbf78f1ba7ae97127` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act5-3.act` | 391 | `bd421476ed67b5433b341faa6d6e892a8440270792b0c36118c42252b009c077` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act5-3.map` | 1949 | `7c3ddf2c7c32fd590448c62af9f8d528057e5b62922f13edf2637c181d695461` | MAP 战场格子图层 | 地图 |  |
| `Map/Act5-3.pab` | 1971 | `3bae4a575ae78e8541dbb4a7bf30e7ba2160276e3d63fee757a2fe71607e1d15` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act5-3.pas` | 1971 | `ebbb436cebbf73466cf9e781582a431cabb937b8e36e69a4e4e139ac992893cc` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act6-1.act` | 201 | `850c1e05037bd0ae7560dfb3923f1f668cddfec866871e8ae862f14d196e0585` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act6-1.map` | 2009 | `f21d38a77fe18c13706fdca14e58cf21c5ddc838dd629b71aa42a4c2a2c50cd8` | MAP 战场格子图层 | 地图 |  |
| `Map/Act6-1.pab` | 1008 | `04c82072a98740b067ec94de2db8ca5db9f85b505ad666a9a3a0740c7f46bc08` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act6-1.pas` | 1008 | `40e6d6b617db5b61a2878d03ba1d46b4e6b5ab9cc71dc7c813c6b754246e9778` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act6-2.act` | 315 | `3537dbb6cda5c5377d9145164f14d4756dad8150cabfc4d4e473433338253632` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act6-2.map` | 1974 | `bc4e7e65cd4223c421c408edb89cbebe383663446e699a337328dfe05f4ac27f` | MAP 战场格子图层 | 地图 | 与 Map/Act7-1.map 字节相同 |
| `Map/Act6-2.pab` | 897 | `c807a36f5495e58161ffd651c66ccc40578ad0d4487de84a28fff9fc85fdcdff` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act6-2.pas` | 897 | `4905aae2d76540a0637c14897eba05ed338b4c3d2b934abf546fa2aa672a0bb7` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act6-3.act` | 1075 | `af35b1697a19a8f86bfa575072a9f7b70cb146b1b6f0201f668b6cf6910f7cfd` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act6-3.map` | 1744 | `9c5f7684ddb05f64f1c75a0e55b3758323ff47a8c8bf0aca1c4e7b403677e42a` | MAP 战场格子图层 | 地图 |  |
| `Map/Act6-3.pab` | 2561 | `8398b7df3c90faa0ce2616bfb76b7bec271d270d67638cfe613bef69c9747237` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act6-3.pas` | 2565 | `82a72dc2f1869e90b9d188bb22260e6ba6d14d204545eb898e33eb4a05920b79` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act7-1.act` | 353 | `61cae392dd5066d74a5a86a7de7fe5b7c4425d6435eb9085cf36d8c21163b3b0` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act7-1.map` | 1974 | `bc4e7e65cd4223c421c408edb89cbebe383663446e699a337328dfe05f4ac27f` | MAP 战场格子图层 | 地图 | 与 Map/Act6-2.map 字节相同 |
| `Map/Act7-1.pab` | 1328 | `2acdd365e3303a03fb51160e383812758882023161911b24d4548b767ef0baa3` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act7-1.pas` | 1328 | `fc0d919b128c68f1b3bff3056eef16287213388bda5b5dc99117bf2c46459abb` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act7-1a.act` | 1265 | `398daa38852f148563fa03b6d1e77e4b1b177001ef30c3fb6d54f9f6275350e8` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act7-1a.map` | 22719 | `5f7c070930694edfbdb1acb9ddf020b9e6dd7ae69b7817bf4d801b1b94532508` | MAP 战场格子图层 | 地图 | 与 Map/N07.map 字节相同 |
| `Map/Act7-1a.pab` | 1612 | `b6498bc9e633d22c16b3d1a1a3b2236b2a82ea2202608447ab697dbf919ee24c` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act7-1a.pas` | 1612 | `0eeefcc69dc0df4054472add0ea9054bdab958474e7bc3a701ef0a6cd78d085e` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act8-1.act` | 429 | `53eafddee425b51452d5f47bba9273f10ced9102278eccb1a9ce1ef3ae603469` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act8-1.map` | 1969 | `d87634ec0bc9dcb0dc6b05c35f4059a2379be352fae2c1aad0c09af8091f026a` | MAP 战场格子图层 | 地图 |  |
| `Map/Act8-1.pab` | 2379 | `398f6334de55a2169a78cc137dddb28500bacca4a34cce803b720b3b3e3e4cc8` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act8-1.pas` | 2379 | `b9ce8d658e676eb60db35ec9a39d21a5a55924c26c9b10871a944131d16f2502` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Act9-1.act` | 467 | `fcbe866694a6533802c73283bb34d7ff5ac121cf170e7a89539a3a711b315257` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Act9-1.map` | 1944 | `0daefe5df8bf8b8a292f57ab98bbdbc05eca4c7222d1e2fdbe080d3e9bb6c754` | MAP 战场格子图层 | 地图 |  |
| `Map/Act9-1.pab` | 2030 | `8059745ae322ead5c91a579d3a9d9f46bd8748b10a529755b1d00b0094f7e7d8` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Act9-1.pas` | 2030 | `765489ab3f3254630be7e9a7117faa449046e486f6febab537cf07f10da4dc6d` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add01.act` | 429 | `20f77f87e72bd091e71cccce9937bf5193791e57890625c8bcae68aaf9c67545` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add01.map` | 2359 | `de933c376e2c2562095420e8efbf4b20761d10055f274817decd7e8481039882` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add01.pab` | 2095 | `9f73a786399e6dd844ef6235b99fa7ab6f3a030171308c853317cc83eca805dc` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add01.pas` | 2095 | `017922928b8fc87e402a8a896fcb01ae202890f41f0e98d096ada355b9aa2b9a` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add02.act` | 163 | `232457107e0997bb54151c35552ec7f43e1824be436a4a369db89cf35828f7cd` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add02.map` | 1874 | `1a2986a5f7fcadcae703bfa1b88ddf3e40aa91ce2680865232a3f218e10901ac` | MAP 战场格子图层 | 地图 | 与 Map/Act2-2.map 字节相同 |
| `Map/N-add02.pab` | 905 | `477808151d34af5b084e559c9b64259126d68f44851650652580dab5d8c7647b` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add02.pas` | 905 | `0d190c86e8ca88edf04631b2d698f56133a1c9dd094816a1a6fb34b71c0a216a` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add03.act` | 315 | `766e2c8bb16b2399ad4f7fcb41ab6f9f40da569bc587f47f8abf46406c9f8ded` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add03.map` | 11664 | `da4bfa05c8f29545d2180888d6585863fa04c16d6cc51fab101e69c74cba324c` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add03.pab` | 3381 | `6ff7264d573c9098c41ad74962221149194c29ca1104aca6419f3ec2a015cc21` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add03.pas` | 3381 | `1bdc481d6d16cdfeb090a5d401b86930918738912f64a9bf020a3bd9c769c01b` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add04a.act` | 1645 | `e2ce601da134bae6c7fb1772342623109adf412635e263254734f05eb5e3ed37` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add04a.map` | 10339 | `f48c61db9aefe81ba40e0ed66def30fbd898d3824cfa46b7c425b07883e56c4c` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add04a.pab` | 637 | `0bf0a2494fbef1f916c3e9b701006f229997836448305b73cc73d0d8732b31e0` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add04a.pas` | 637 | `bff225d14896da0af4292ea078529d9ee480d43a636196f9aa96d56217669f0a` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add04b.act` | 1493 | `a47e1da5cbed4007f2a87c6740cd9aa7c45026dd442e30394600827b1691bbdd` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add04b.map` | 11679 | `80e46bd66082c343cb6712ad60867d2dd1eb1a9fb9561df17fdf340e39e415ae` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add04b.pab` | 535 | `df40385042ab95c24a3f59adc2801970c0669541bf0db39df6ca2a5a313c88f3` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add04b.pas` | 535 | `6ab38fc64449763800bc0dfb513e2f464660550bafa8fa69e39af863006e14e9` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add05.act` | 1189 | `6e9804fef51fe31087a8f0d8c055d2325bba3bb8fa2ac4a1a56f541b629012ca` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add05.map` | 8714 | `b52c9d4498f2966b0678fbd84420cd582b40bb362f40df95c7770a42146d0597` | MAP 战场格子图层 | 地图 | 与 Map/Act5-1a.map 字节相同 |
| `Map/N-add05.pab` | 2680 | `1a783ec1cba10815e49aa3cb0050c417d7f062c60ddeb8f4672c2e075efb37c9` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add05.pas` | 2680 | `17898a90ed77d6700921655e26de5a0649d842e81f8c8d6d0d26620a5a20dd2d` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add06.act` | 1645 | `9660415c5110fa6f216eb7de3aacc8cfef012a4414f9fcc5f01a5ab5eb0b4969` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add06.map` | 10089 | `39cb55cff7fdbd8e59b3dc284a46ccd2e0b7240fd0ac71d60d187064023a3039` | MAP 战场格子图层 | 地图 | 与 Map/N-add12.map 字节相同 |
| `Map/N-add06.pab` | 462 | `d85a4bda35d87d7ddf230d93534378023bbf732845dc14d97a45c9b58f47261d` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add06.pas` | 462 | `3a327e0ed35d069fa1ff22b494354b58938df38a9c2940bb1b01bee151a30dcf` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add07.act` | 1341 | `8cb8fe475456ec70fc16d2372801439dcdd291088c6e9e83c6872dcedd50cefb` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add07.map` | 11624 | `fd274622674b985d2ee743a41ced303c8f12aec777c26db083d60a9ae634cbe3` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add07.pab` | 562 | `9651b35eea92289f6737dbe305e8a6a227d349bf9345b23fd6f2a0017e282652` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add07.pas` | 562 | `ea3145ba8f22d450c89c984ffeec3af324fe6eafa72bd74f07cb2964486d3050` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add08.act` | 2139 | `5a16cd0e632d2d27b90791920abf43ce9fef59f7a55cfe2d87c4b4ae09630b35` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add08.map` | 10299 | `5b9f5beeccc93ca16f0187dd4e9a0d2f79d048998faa27e8c5396d74e9532b9b` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add08.pab` | 681 | `66b49b755aa8e8968d847fa8a4a27d18ee221738221d22e7487f019be5879ab6` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add08.pas` | 681 | `872791aec9f5b021b120900bb24066bf7cc208a8f52208422b3281cb772b89b2` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add09a.act` | 1417 | `4752f728ce04df1758abf840b0661e488944bc158f72b84f15bb5f3eeaf11cec` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add09a.map` | 9629 | `94e1956fe10d31461e13db9bfdd9583c470b5b16734a8fcd5327e9147d899dd0` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add09a.pab` | 1008 | `75c640d53d89308e557cc70162a042fe2002744117b2ecdde3128c26cf60e53a` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add09a.pas` | 1008 | `9564245683a5876932851551e1614b344cea3ec4d87d8b1eb93441b29d8c6d22` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add09b.act` | 1341 | `d1ff581d476897ada11ad9072a826770bb4e698c7bcaaab6577b589fafc60074` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add09b.map` | 11684 | `f818816c4018baf8d94eeb29db8cabbb015565179e014c3b910fa2514fdb77ee` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add09b.pab` | 905 | `dce58f44482d256f5941d787b33d4ac4abf4357a5ff26ede2954f425b579b3eb` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add09b.pas` | 905 | `5b5562cd7e51eef5bdd8bf739e363ed10e73e0e3db7802e526e074fcb42c94f3` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add10.act` | 2747 | `a93e2dd6cf5090ac838ea570cac5c45fa105b28d79b64cf591928ed5ae207c25` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add10.map` | 7934 | `fe79fd8cac80e5062734247d5e2b8187e4a7c79ca56adaf6edd91f1df1073d6d` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add10.pab` | 1124 | `8b4ee71c656f30c44010bd66b37ea94d43916e302a21b2196786914ffca093b5` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add10.pas` | 1124 | `76de91c879c72afe8466849b8da404f97e7caa6af489356888c3cbf6c9c55548` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add11.act` | 1607 | `57e257011e0cf65e4e7ab8ae00672f195ab2916b126b21b51d6bd6b151474b87` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add11.map` | 9639 | `84d5e527f6214324f641c95e486a683668a073a8da43d6975d2628adf84be20c` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add11.pab` | 888 | `c6e720dd29a550c9248819a27ca12e193b106fbb09e96a4d5738ca08dab0f156` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add11.pas` | 888 | `2cf718335fc404869fae0ec2a5fca041a215b879ab5a364cf3faa9cc2f7bc340` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add12.act` | 1949 | `31706a912df7d3f0df808adaf74e60019f883dfbad0bb9885382fcada620bd25` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add12.map` | 10089 | `39cb55cff7fdbd8e59b3dc284a46ccd2e0b7240fd0ac71d60d187064023a3039` | MAP 战场格子图层 | 地图 | 与 Map/N-add06.map 字节相同 |
| `Map/N-add12.pab` | 806 | `1c1e1af45b7b7a590b4342c634a8dae6a319b8767657b03d75278361dcf93f2c` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add12.pas` | 806 | `512a863e69e65926ddd2f5a4f1d9677e8ef20534e9ac4101ba2cbfe2fd68e7ce` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add13.act` | 2595 | `3aa5194d982d5d6c90f7658777f19447e673d937b9602730eebb5c4bbaf5cb11` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add13.map` | 19004 | `efe7cd6a6b6073d385221b9828bef88def46db8377853e590754864b9f3629f6` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add13.pab` | 621 | `f388e4118067b802f3253ce52cd1dd3d4e933ed5821908360da84dd6f2644b81` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add13.pas` | 621 | `114d005bbed902afd501afef25c89025c9867099a011dc7002642d7943f5e3b5` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add14.act` | 2595 | `3e74f59afc5ee6552e01caa1e3d2d6ca0f1c3fe01882ac14b858b828dbd15648` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add14.map` | 16749 | `c5c713398fffd9cb08ecdb2ef5bc5207cf00c31fa673f0552ed776fb4c367659` | MAP 战场格子图层 | 地图 | 与 Data/N-add14.map 字节相同 |
| `Map/N-add14.pab` | 2297 | `8fbdd6b15b0009513066a06635e032ef7390f549469a7049f433978b9cbce4d2` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add14.pas` | 2297 | `795cdeee7a6430e1530d1149fa1dd97d171cf1d2536bb633a7c3710fe8f45111` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add15.act` | 1379 | `9575c16cb0a0ebd1fb101e7ec6cbb53574d4f29b71a26e60554be785890b52b2` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add15.map` | 11044 | `1d22fb740aac177865a812bad915c0264d8f32f68a985abe24cd2ff1ce51eb7b` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add15.pab` | 879 | `c49f71654a009ac23a0b97feb50062418f236a1d6fc1b93d35ab37fb99a4fa85` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add15.pas` | 879 | `b5fb2b172ca46da827e45a35532f37e266a53d38218ab64f626f29e9403e1eb0` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N-add16.act` | 2557 | `0fd11bcaec5ce06246b5f2565c82dbdc7204aed1592712367d999f48593e4889` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N-add16.map` | 11414 | `bd68447e83d9975f5ccb873c569f984953272152b4376d919f563a47a6121c27` | MAP 战场格子图层 | 地图 |  |
| `Map/N-add16.pab` | 847 | `32ac8a5db02b99cc42e21fced32862a9f6ee48d5c658bad24233de511e41375d` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N-add16.pas` | 847 | `918d6840aded515cc3d8ecd6b1ade01edd905cc4e00bad326ca3359694cffe3a` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N01.act` | 999 | `5edf91552e3490a0da033a32d60e5734f0cdd326ec9ef1444be5f93b7e33e987` | ACT 单位配置表（38B/条） | 关卡单位 | 与 Data/N01.act 字节相同 |
| `Map/N01.map` | 22234 | `a6b6c92a27a5a5687705cd953162acdd1a388dde3f36e45051c2fc1df384dcca` | MAP 战场格子图层 | 地图 |  |
| `Map/N01.pab` | 2514 | `07c38a64ecd2086afaeac6fdaf5960ecffcf1cb1d54ce5de84f28fcad7172e47` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N01.pas` | 2514 | `57c1cf6c1071456a30fe7571a5b583687f44fd29144bcc36463e724854215c0f` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N02.act` | 1949 | `01a446dd616002ca632fa43a9d344a3758fc95dd0639d1a47bb0743f5928d74c` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N02.map` | 8329 | `accb1bded48d32c4c0f1f90b7e98be4fa14e1da103863dfe758cb844855963f8` | MAP 战场格子图层 | 地图 |  |
| `Map/N02.pab` | 2026 | `27cb1ece12db0b88af67f1b407e566973cc24224f9e9fe7c49dc37c76839d9a6` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N02.pas` | 2026 | `8121de88c6ae182a5a1db2a3a7673fe86b6ca15e8a2eb9da7c2526c2fb7b5016` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N03.act` | 2785 | `8302400f3be653d2e8d9fe42c4bcd43f2bbec74daa52bfb62feafc66687e700e` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N03.map` | 13269 | `95f6665d4d0bce2da08d148767af01dc326fa4d3545a974a8ddab2661481137d` | MAP 战场格子图层 | 地图 |  |
| `Map/N03.pab` | 2850 | `2834cfdf64f7daf97946a2042e02617452e49920a70b87d4dba587cbc901310c` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N03.pas` | 2850 | `569a7d45bac57d19b2413520628f7b320cfd98600360ea019e8e1d44c6d06c22` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N04.act` | 1721 | `b106f14f9c6fe3f88c980ac8b8c69bb80ba43385240800f100f7748270ab1435` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N04.map` | 20739 | `36ddd76e72c57154ecc3f11ea33d1b605a8996e44a65ed0358546610f67462a4` | MAP 战场格子图层 | 地图 |  |
| `Map/N04.pab` | 771 | `b66f85c3a30f003d718555a759ae0429029ce9f896d62ab48b09cf633bf8b196` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N04.pas` | 771 | `a08efada7d5f595014a0facec20ffa07ab69590c10629eba5bef1594218ac337` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N05.act` | 3203 | `d02c551da0858e7980b4d13f6abffc70dfbc6b3ed71e248b3218ff5c944db600` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N05.map` | 20634 | `c111a457f114242d9151b59cb09358d29a738dfdf1ede678ef42c4ba593dbe81` | MAP 战场格子图层 | 地图 |  |
| `Map/N05.pab` | 2007 | `7302efe3936bb2b8fcb357a1af2d375be96efd73d1063335e7fc16aa945467e5` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N05.pas` | 2007 | `03ac349b50a31367a8f3b27be7bae633c17ba24ac0653f05f74de87a0a0fea14` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N06.act` | 3355 | `22c45a8d1a4ba6fbb0e9ec9e6c9fd6f817d037d6a2f8d3a0432b54b4c83cdbf1` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N06.map` | 7619 | `50310d977c35079083b828d961755f59286e31ea182955a0dd1a172f520497c3` | MAP 战场格子图层 | 地图 |  |
| `Map/N06.pab` | 1350 | `cbfe0dfb13fc514b9c096a0869d943abdb651e1a63f22248e8dab7df3abb5afe` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N06.pas` | 1350 | `fc0e103482386281c25f446c01edbb48d42e119aef363f1953930baf2a6c1930` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N07.act` | 2101 | `4ea57f8b2d577eb4f9d023d8c8e216dc3d3e5934a85cef865409f59ed7cc6bff` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N07.map` | 22719 | `5f7c070930694edfbdb1acb9ddf020b9e6dd7ae69b7817bf4d801b1b94532508` | MAP 战场格子图层 | 地图 | 与 Map/Act7-1a.map 字节相同 |
| `Map/N07.pab` | 950 | `630d1bc8b3e0dc69bcf4fd0a4886121a86a54fb17184bc8d007db8b5aebd1f09` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N07.pas` | 950 | `6d051a0157ba259f3574fbe290f87fc2daf78779dd39acf37848abc47eb1e27f` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N08.act` | 3621 | `730352469bd2e67b360546115a3143640282ce036748b6545a7c2ddb0901fd70` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N08.map` | 7924 | `f609ef5669fd5d1d20c42838f23fccf909b999c171e3dc819a145a502dc9beab` | MAP 战场格子图层 | 地图 |  |
| `Map/N08.pab` | 2023 | `2f968521492f816c5e8f31991c5fdb0f4679aa92fd5e62f49f6492ccc45cff50` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N08.pas` | 2023 | `b9881fe5cf20a2a1922524727cd8a052f75f114711d4da28893174599b6f23dc` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N09.act` | 1379 | `e25a41177bf71c93c7e852833126a9ff508c4977320aac1235ce87de98525838` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N09.map` | 8659 | `b33e346196920cbd11bacdfbb0a31a717d1475b27e05f2f8b65a1f8ac15a5105` | MAP 战场格子图层 | 地图 |  |
| `Map/N09.pab` | 2512 | `1cbf3fc7da37f778adb51870e4a660f37a2e2806e922c6311cfdcd5c29c6f040` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N09.pas` | 2512 | `e6289b68af2f0182d507f3d587e30874435c41f5216c0f292c76f86950b61655` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N10.act` | 2823 | `93da6d0ebe323cc0aa548b65f2781b9cecf6aed36ede221a1b6f08a44df1042b` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N10.map` | 8599 | `fa3d5cfb9e150c2115905f6cfafd0c8e64d56e7dc57dc07038974d566f6fd6fc` | MAP 战场格子图层 | 地图 |  |
| `Map/N10.pab` | 1388 | `d04f0110e78ed5cc4a96e6569f52fa769df07fb47dbed5f92d4e84fec4c06bce` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N10.pas` | 1388 | `68ff4ba6b42466aa8db7af54f1d27201e6c78ee68e7d0d52f273702fb46b5ff4` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N11.act` | 3165 | `f7e9f78072d51683dfc5db5e853720145d990d72c390c0fde3969d4fb55e99c2` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N11.map` | 7884 | `0fee59a1d622e50cf2752182fadcf615f21024c61285d1f68f101eeeb0ddafe8` | MAP 战场格子图层 | 地图 |  |
| `Map/N11.pab` | 4340 | `01c29069cc49651fdfbf000ba472b36f9c0ded5879a8b19b8e84eb5f60760d22` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N11.pas` | 4340 | `e46242e40d4200eae37fc5356d4992b77c4d1eef7b35acf77c24c8afe1a26d43` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N12.act` | 3089 | `fb9111d6cc7dac7640eb1b147df4ed295a6f0e35f9b9a8ea23f5cf19365891ad` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N12.map` | 16749 | `9090a82de4c17fb2e9c3ff8bf921339a4b089ad64c28f398b5971dc713f53efa` | MAP 战场格子图层 | 地图 | 与 Data/N12.map 字节相同 |
| `Map/N12.pab` | 1811 | `241517200198ac95052c6d0e095ea89be1eee78a0cd0804a9c91be77eb42d799` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N12.pas` | 1811 | `8bd995e1d7dc139812121c19434821d167c6a869384181a883a01fd7030f69de` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N13.act` | 3127 | `3e3a5d6b6df0a298434340bdc877c0375c01c254c4af2056f59f2aed0caa3e36` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N13.map` | 19299 | `cfd05934bdc9043b7d56a7da556d92045c14ef8469d53a2bbd3b82cc166a51f5` | MAP 战场格子图层 | 地图 |  |
| `Map/N13.pab` | 2092 | `d199fda07cfba1dc08218704e09e70be228c8196da6b2107f41edb1062b785e8` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N13.pas` | 2092 | `d96c744df6291fa0d581c8a0983d8612e39c43baeb159297bef0736133554b5a` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/N14.act` | 3925 | `a3186fb48bb582267eb76641f08c4bdeac38cbe12ac5c96bd5845273598d52a5` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/N14.map` | 17979 | `d3c99600bd5de7b95133d80ac888aeec3d402ae7f6e2dcc55cea48ae1a322cd4` | MAP 战场格子图层 | 地图 | 与 Map/Act14-3.map 字节相同 |
| `Map/N14.pab` | 2752 | `4568f92c6233ab23850e224a42ad26180bfe6fb1d5da9a9c4b4f49c9743dfd78` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/N14.pas` | 2752 | `935da870c89e0e1f8c035030cdbdf024a8e7b2530bf95ab618a0176e8799c426` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Train1.act` | 1303 | `5ba3a864af8509175f237cf22643331cbeeceac3bd4c8980c94d3e85e99c3eee` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Train1.map` | 1784 | `921c6e22bc4e8014ee0b446ed9b1e850253868ba6f9806633bb2dbccdf693155` | MAP 战场格子图层 | 地图 | 与 Map/Train2.map 字节相同 |
| `Map/Train1.pab` | 2314 | `4ecfbf3b596304119f87feab4f9ea3de338c9f3d673e08d124be51a241aa6cbb` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Train1.pas` | 2314 | `0293e523b466cd174de72d1a9ab904989e63852f45f410f8f861c90d7f28c964` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `Map/Train2.act` | 1645 | `da7b595a48ac99c26c39d97513146d94ba3a1cbaeb117a94d538285420eb7f6b` | ACT 单位配置表（38B/条） | 关卡单位 |  |
| `Map/Train2.map` | 1784 | `921c6e22bc4e8014ee0b446ed9b1e850253868ba6f9806633bb2dbccdf693155` | MAP 战场格子图层 | 地图 | 与 Map/Train1.map 字节相同 |
| `Map/Train2.pab` | 2788 | `56273325f378905d668d379a208d170faf62d6ad0cb59dafb915d2569b80ddb8` | PAS 剧本/事件脚本（Big5） | 剧情文本/事件 |  |
| `Map/Train2.pas` | 2788 | `fe9c17e337f8f983083e408058b57c7736f7d4523295270dffa7400372cf5fd0` | PAS 剧本/事件脚本（GB2312） | 剧情文本/事件 |  |
| `music.ini` | 886 | `91f751a9582cbbc078eddf9b869fb039b511eaa4e46fb3a726c06b93c0952bc4` | INI 文本 | 配置 |  |
| `readme.txt` | 392 | `5d248636259cadf72aef1187382c7b232ff46440809ebbe2358a416395c36bdc` | 文本 (GBK) | 说明 |  |
| `ShuiHu.exe` | 311296 | `f892318bd6119b42d2b9111298dc3055a02135c29329f80cb835387240b31787` | PE32 可执行文件 (i386 GUI) | 执行文件 |  |
| `Sound/1.wav` | 109868 | `4b56b4f1df10b32b8dd2bd6de61d380cf61779685a54e3214c535d727c24448d` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/10.wav` | 145964 | `77f9b379296c13228751fca36bb6cf12140c9a265cc1ee22a6739ccaa00c31a5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/11.wav` | 88244 | `3b2bbb12b5e53abbc1ebabcc33a5ee789c2782bb3f4e2ae742f01e69fd207828` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/12.wav` | 82476 | `039e2ddb61450d2b9df7b3317479d2c96050fe148167c6d146486e1b7142064e` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/13.wav` | 188460 | `c1f686430deb33207e1f1ef92ecf06eb6a07755abec340da8fb4e60941c0fdc2` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/14.wav` | 135484 | `ebc868c6339bba294550f9a00b716a6cf19ecfa430ca7792bd9cee76796a9382` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/15.wav` | 226424 | `87545e0bf6e4ec147716d6bff07d93bc4bee8640e73cde62472757b579346b73` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/16.wav` | 73516 | `e6215f7598b2256a8237a9ebb4c6e21da2ee0c944bffc18ceb60bab13cefa2b1` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/17.wav` | 265260 | `8d7dcef1fb2af79ab658ed5aa08f41d8f217de6a880c593d2e03a3d0b9289b53` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/18.wav` | 204332 | `3cacb5519e078570ff6b794335dbe953f47f91eecd7629919e9b54492c622705` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/19.wav` | 185352 | `6f99304e670c23d31f4c084be4f12cf1ffe0e20a003493c10e32fd26a6334cdf` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/2.wav` | 113836 | `64085a30d59c8d86e67a63626beeffa997443308345b8cdf067b9872cc13b914` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/20.wav` | 179384 | `a3272ecc0d7b2be5b286cd8cacca5795453730701a35e1efaaaa223f218842b5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/21.wav` | 157740 | `88ed7447f2ce85ec4f5ed8203cffc714accf784d26a457d5f06e19debcd7fbf4` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/22.wav` | 139820 | `794073004200350b7f11315d429b35d60786c88cee5762a0d821c505e0a8fe50` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/23.wav` | 106284 | `72c4717aa5ae4f71eb39a631f442c860ab868f61b95dc13a0089c2c190878e6a` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/24.wav` | 288660 | `318a34733fd5114a3e722caff92e63aab84058ab2fa637dd7ef2b133b3730d29` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/25.wav` | 121884 | `1a4ca91408cce7d5b411b6862aa9aa9a8e067bf516eb68ef3be8ef5054ddae52` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/26.wav` | 132908 | `3a14ed9074cfe23976c8938184997c2a6170829fb7ce9a2a662f29d9a0a7d322` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/27.wav` | 138468 | `f03e76a62ad14bc3a42fc92c52a09dc7e39a3cd4e56530180f8de9bf72c70294` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/28.wav` | 330796 | `0f9c76b141643c8adc72a8a090e639c01c380917b9ab15c648b6ec560c9bc40b` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/29.wav` | 173504 | `5e9498278f1f673c7decf3a474400e0b88e3948a58fef028f699c8430109fac5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/3.wav` | 144428 | `fd084125cce1c3b582989eb60591670e60b3e8ee3351e5356d4b1febfe32e4b0` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/30.wav` | 63532 | `1c869ddb01552d340a0db090a6d04d3e2af4e68ebb33b5604ec24d3ea0c91394` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/31.wav` | 97436 | `62440f18b5ba88476a96d5e7e64bdc69400d8ce6d765e9b11147c9e32377f6e6` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/32.wav` | 97436 | `665248896724c4c36f37156980df5b14f68954ae000ef4ed4d3c9b2d318ed6f8` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/33.wav` | 48172 | `7e1c3a9f20a2a6e5eab5360fb26dbc5684b3f5a6a5f2a827e3baaac676d1e529` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/34.wav` | 180268 | `c82bf6e5cadffe0a7ad199dbcb1e52ad69fbd106094c81d532ebb61131646ef9` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/35.wav` | 215084 | `809465a4e0e0615e8ad672ee6eda122bc918f8ad998175c3ae0d50d8712c8228` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/36.wav` | 69420 | `e154213be0c63ca74c549de193828259dd823024fac218ec9a7639da2d7b141a` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/37.wav` | 81196 | `97a2fc90458bcdddccfdff08ee656584957f9f2000e65efc0277017a47bc7d37` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/38.wav` | 60236 | `05ad6ce6604f13f6800ae3c95fbcfc114c7baad7b85ff4233a1bb624ebc60c77` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/39.wav` | 80172 | `c28a27d1c517200f7ed2109c9ebca53db4dc346c2a9a2651ef4f9954c800db8d` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/4.wav` | 164908 | `e224041ec6444829cfc8b26fa1d73b339a419a8cc71fdaeed2de3bcef3e3c3b8` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/40.wav` | 62508 | `3b87820c16501d9be0d5d1a88feb486e145d51b70c1b183503330c9896a170ea` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/41.wav` | 136092 | `37880437bbe81e5536e77a4ca28293f1b80c58667e057e248cfd48ba4dd23199` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/42.wav` | 137088 | `604797747218e974a91a352c0fd1e8d528201bd8d85640cf8408055277ef67e5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/43.wav` | 38828 | `6cbd5def672eaf0f8199a0f94b8a1f5695821af46c035cb9bdc989c6c21274de` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/44.wav` | 41004 | `ee4d32f75c198ffc028f43aed8db7d07d725f391d35b852203aec21b636f0157` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/45.wav` | 341468 | `5e98220a4fcd68ba225870b0a3d0e21c3ed1bed2c6a31eb84727c6fbfb237ba5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/46.wav` | 26504 | `c54b6036340eb4cdc0704e4001855a8f53da2aafceb31930fc357f29b94ba07b` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/47.wav` | 49966 | `204a38e8fbaaf493c8feb153ec39ca434bbd40a9417e97da7eeda694c0e4b8d7` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/48.wav` | 89900 | `6dac1bfa1315f7bd7be61af79cb2023382fc82704357b54ce9bbca3fb4b33fdf` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/49.wav` | 60716 | `d07dc82c568135c81387fe3f46ea042cd0dd5e74d8940a67b1fed17b35d57743` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/5.wav` | 150396 | `3f59ce8216924afe4c7ba994ff1dabe6ed5b6e1f70854d3e042b6c9205a2042c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/50.wav` | 60332 | `c2c866d5968f1d0ff7b796c8bbc7e90542eb58b200328b86de6dd5ef180de790` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/51.wav` | 51116 | `89dc82554b51920b4d3218ff3b8431f6a876026a602ff7187f9f2697f4c33911` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/52.wav` | 98604 | `1e304ec17644125c5be99f4f7080dd2c1dc1acfb9f9fb68af296ee2378bfff2c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/53-1.wav` | 24548 | `403c1fdbe4af7842ab75d6e7141b209ec6a4d97036fec9a98cfcfcd673b6a6c3` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/53.wav` | 24548 | `e2f142b68b4edc05753700758653796c8984cd39c54716968bf8fa54b9d48ac8` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/54.wav` | 5420 | `22db38cf684240e96e3d95e8dbd44d27a34ab9f04e824cfae5497b2a870d8b87` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/55.wav` | 11114 | `38dab68ec77456ca30ef039a5c624c14ad0f923c6ff9885562c920dfbefae724` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/56.wav, Sound/57.wav 字节相同 |
| `Sound/56.wav` | 11114 | `38dab68ec77456ca30ef039a5c624c14ad0f923c6ff9885562c920dfbefae724` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/55.wav, Sound/57.wav 字节相同 |
| `Sound/57.wav` | 11114 | `38dab68ec77456ca30ef039a5c624c14ad0f923c6ff9885562c920dfbefae724` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/55.wav, Sound/56.wav 字节相同 |
| `Sound/6.wav` | 61224 | `f52d4d1659826bcc955ab24e2f48b95d23002ebb4d4d01bc7d2e71c3869e21eb` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/7.wav` | 111764 | `4dc50236ccc42c8de76c93d5a23ddea094cef4883c9bf39eb0d7805aebffb697` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/8.wav` | 89124 | `f3e44d03f2118c920fcba19b7dc7d29e5a754eb4fc84d0d8e22ef0b038e82295` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/9.wav` | 211724 | `0030d9982ceb3b0ea5972119e75e39b3d552c927305dc28ff33e80ca712528b4` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/Logo.wav` | 41984 | `f591b41ba0c14b8d9857295d5da614791ed8fea4e2e1f554a8beefec9dc0977a` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m01.wav` | 23028 | `6476118ddb448971c6e70e22475b2266f2855142f5f24ebe09ccdc34e9683d96` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m03.wav` | 4716 | `bbdc4de5a771ffbc441d23dde9cee519a397536f46c67d80df2b9e6dd83fa139` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m04.wav` | 60716 | `69f267696b200580cfb1cc487c1451f952331124b8286f42811c3144bc2ce09d` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m05.wav` | 83756 | `3add8ba4f7b729ba3dbc078d7a3893bc591ea316bddb761552e81a2559a8ae9c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m06.wav` | 100396 | `cf596d9c24d85a266e3aae40c067d0992f0d0489a978585b952e4f3ecf72071a` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m07.wav` | 97580 | `e06db22730eb28a6ea6c1841f5c8f72e43828c5344f864d9b2d30b1333c26965` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m08.wav` | 86316 | `632e42358ade4435af20d8b6d17d0b3e7b965b558a81ee1e727882cabbd23a59` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m09-1.wav` | 5644 | `4279c81fc9976393ce4270cf9ce08f9d02b045856693e97529aa5a2a17e0cc4d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/m15.wav 字节相同 |
| `Sound/m09-2.wav` | 148166 | `ead2189a22a92c0deb7010d3fb58aaad2d4d1d53f9515ad0d0e0d36e02bc3099` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m09.wav` | 53440 | `8bb493ce3ed7b4437a0d1406cd334e0741c2ece72888d9e270f2242e8b197116` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m10.wav` | 114736 | `d1b818ac5976de3b751fe8478ce9a7d2ddc4a4b9cc4c29a7abb5fb361f461957` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m11.wav` | 4892 | `feb3115ca2af3297e03cbf3c52966a7a248aa56e32803922aa62d830c733e8e7` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m12.wav` | 528636 | `959b21569141eda575d32945e8e7e7a38329626b9250d1ccf89014d31be197dc` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m13.wav` | 83340 | `340aac0c0d6da3c22c934b015006e70c8e324685e4ddae9edcf035ff4b55492c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m14.wav` | 150072 | `221ecf642ac0ff2089bc07d2315cb8c7db122ea15ffdafead108c7e0159ece47` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/m15.wav` | 5644 | `4279c81fc9976393ce4270cf9ce08f9d02b045856693e97529aa5a2a17e0cc4d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/m09-1.wav 字节相同 |
| `Sound/s0.wav` | 170564 | `769c2fbb06a99ac8d791aefd564bbb2c5e220cd0f17cf4b7a2860dd9ad2baa6a` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s10.wav` | 152924 | `848f3a87f8a4b620db618045ce597ddee21841cf89b8ac2521b6db50175b425d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s11.wav, Sound/s12.wav 字节相同 |
| `Sound/s100.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s101.wav` | 176444 | `98c522a2e24ae98672efccc27000fab48023fd34109aad066f8d76cd3956bd39` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s102.wav, Sound/s103.wav 字节相同 |
| `Sound/s102.wav` | 176444 | `98c522a2e24ae98672efccc27000fab48023fd34109aad066f8d76cd3956bd39` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s101.wav, Sound/s103.wav 字节相同 |
| `Sound/s103.wav` | 176444 | `98c522a2e24ae98672efccc27000fab48023fd34109aad066f8d76cd3956bd39` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s101.wav, Sound/s102.wav 字节相同 |
| `Sound/s104.wav` | 117644 | `756e0c60d1f1de0bcd73eea9d1a6ad7fe91f6cd0a9b77f730103a21e150cd0b8` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s106.wav` | 141164 | `dd99d06a542d06ed74053af8d7a20c8a25b470823151849a113a7dc82fcb43d1` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s107.wav` | 176444 | `09cae515dfa0fa643e85eafb4d03ff40f6c99537ef3dc5c6a5bec0e8cfc3ce50` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s108.wav, Sound/s109.wav, Sound/s110.wav, Sound/s111.wav 字节相同 |
| `Sound/s108.wav` | 176444 | `09cae515dfa0fa643e85eafb4d03ff40f6c99537ef3dc5c6a5bec0e8cfc3ce50` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s107.wav, Sound/s109.wav, Sound/s110.wav, Sound/s111.wav 字节相同 |
| `Sound/s109.wav` | 176444 | `09cae515dfa0fa643e85eafb4d03ff40f6c99537ef3dc5c6a5bec0e8cfc3ce50` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s107.wav, Sound/s108.wav, Sound/s110.wav, Sound/s111.wav 字节相同 |
| `Sound/s11.wav` | 152924 | `848f3a87f8a4b620db618045ce597ddee21841cf89b8ac2521b6db50175b425d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s10.wav, Sound/s12.wav 字节相同 |
| `Sound/s110.wav` | 176444 | `09cae515dfa0fa643e85eafb4d03ff40f6c99537ef3dc5c6a5bec0e8cfc3ce50` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s107.wav, Sound/s108.wav, Sound/s109.wav, Sound/s111.wav 字节相同 |
| `Sound/s111.wav` | 176444 | `09cae515dfa0fa643e85eafb4d03ff40f6c99537ef3dc5c6a5bec0e8cfc3ce50` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s107.wav, Sound/s108.wav, Sound/s109.wav, Sound/s110.wav 字节相同 |
| `Sound/s113.wav` | 61788 | `784a606083d990fc20b828b054f98defd03ed7ccce1164000d974b128babe233` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s115.wav` | 195292 | `d386f399e455cf74c5c5c5cfeaf90d596bb6daf8ed1f3f5927c4402eee7abf37` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s119.wav` | 120588 | `fe8538afdf2feaa7aa6c024ea0d32ee45212539bd0b2920b502637c8f422e7d5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s12.wav` | 152924 | `848f3a87f8a4b620db618045ce597ddee21841cf89b8ac2521b6db50175b425d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s10.wav, Sound/s11.wav 字节相同 |
| `Sound/s122.wav` | 132348 | `0028b93e6c928897cee882b89c1b13d113f1725606d973dd5ddd4eb4c816705a` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s123.wav` | 226428 | `7d2fd918d518796eee1c7982aa9bc17fb674bc612ba04736c35d06f52478a9f7` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s124.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s125.wav` | 144108 | `9b54519061ff6c24b0b203677ee92868295c525bccea3634499053e49b149935` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s126.wav, Sound/s127.wav 字节相同 |
| `Sound/s126.wav` | 144108 | `9b54519061ff6c24b0b203677ee92868295c525bccea3634499053e49b149935` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s125.wav, Sound/s127.wav 字节相同 |
| `Sound/s127.wav` | 144108 | `9b54519061ff6c24b0b203677ee92868295c525bccea3634499053e49b149935` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s125.wav, Sound/s126.wav 字节相同 |
| `Sound/s128.wav` | 111764 | `98798471d7b9032f4a75c8e262ccaefcdfce40a7edd7d41ccfdd0057a4301105` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s133.wav` | 167628 | `61c9c7cd39bf0b4db497e65df9b5631aae25a20a03321b9b10315a82ea51fece` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s135.wav` | 161748 | `7ac14679750925809795378d51dd1ac879345c1d64aa1f8e6ad76056593b95a0` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s136.wav` | 370484 | `dcf26c22b30bb246f75909e46d03112c51076b7964b0b7a5b799d71402e15431` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s137.wav` | 147044 | `de8c03f3c81b2d2d960dd4d0c3855b8b44cfe3fe6c306c45f6b28270d4f80e84` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s138.wav` | 229364 | `8efb02318f3d2ea0fb92f3af91d592b7802f25344667bff49a910aaa12e6c0c8` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s14.wav` | 154688 | `4c5d8d80af3ddf9d3c8053862f45923085797afac816976d0a296f5986c4cb82` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s143.wav` | 105884 | `ab3b3e476e190d7b223a30eba1d0b9c53cded13092fd1b1d8bd2dbde68b6cdf9` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s145.wav` | 105884 | `2249a295a5fe999edfb71490fe12d1a18ca76ea27f196d794a584ef39ad8d355` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s146.wav` | 152924 | `81f422f886bac74f29377b26617e91fa9527ae1ecd1b76984cc5eb0365b91508` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s15.wav` | 105884 | `79e7c314e20de39dba01a297da2e79a596d279d649d448729148ac3080a13edb` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s151.wav` | 88244 | `adfab2e651cf4fa800df7a767bf9ddea68f3e50ae03b0f2276305447b17894fd` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s153.wav` | 55908 | `d4d1afa92c54ab83cc7cab51a5124c66e3ff926500b9689437449989ee881b4f` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s154.wav` | 105884 | `080311e4c790117138b871f6cd8d8f2d5229769edd3e9b67c54611c2471ea364` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s155.wav` | 85308 | `7918f64da8dfcd26bbb1edb2aa1328838451432ebf7a9d52999696c06b63e565` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s157.wav` | 213780 | `446a51acd71ad5174f8741b45b64a52da8084ab7d2db605418b129f426a9b1b4` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s158.wav` | 100004 | `28bbc3969d2308731e8e7b5f6b8ec448398625afa3888dc52072d064525004f2` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s159.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s16.wav` | 129304 | `fe9e336dd2c1bf2af5f6b456510c28bc3bbfc67426f944aed804efbef26c4e81` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s160.wav` | 112560 | `914fa682f0ba01985270b8e592c90e91ea523bfcc1282fd02b930ac1342f9b1d` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s162.wav` | 157052 | `8402eb8bb1d90cf203f2bb9d671f1447775c4f9385fa74c72a1f371cd5795d1e` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s164.wav` | 120588 | `484f6c71d905b608efe31a8d81402bfdd778c9c8f3d4094bafc75b02e8d03992` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s166.wav` | 179388 | `c662ea222e4f0c5d3c55050c5178ea198ae38f76c6a8fa6fbeb7cac767e25e57` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s167.wav` | 136012 | `cd58e118f08fbe9c5358b38bb2977a5e624913fddbbece4576e648fbc808536c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s168.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s169.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s17.wav` | 154688 | `ca819723bd6a6b5101e326951e15431bcc4576fbdcf5724bf844dadaf02be374` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s170.wav` | 76484 | `51c844b261e67e85b1c343276e19ebd221add9281f6e88ac41a04322dccc0a10` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s172.wav` | 144108 | `ef7fb81e2ab9eb73681dfc65ed743a92d83e07f78339016a90adf0e57aa97ceb` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s173.wav` | 191148 | `3f1c7d17bd3ca893047406bfd52f69dcbc3fdb3e585b5146d0ea56b48d846a1d` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s174.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s175.wav` | 123660 | `88f69054b81c8919a4b840cdcde115abc1239b985f678104be11558f46513f25` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s178.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s179.wav` | 88884 | `d301a7139859fcad0f6deace9058c1b934ad0391f0f4007bc55d4b6a3f0ffe0c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s18.wav` | 105884 | `f2d6796d886e09d6a228f73e429495c6b9aeab20d6c43362275c39926fde3c3c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s181.wav` | 100004 | `efabbb8879a3ab73479b58c502eb64b116c7780f851d0f23b39d031d246efb01` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s182.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s183.wav` | 167628 | `77a9082c84d65ded5a2576abf74d1418a34e5658d177ed5d8949a7d8ae7b65ff` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s185.wav` | 108828 | `0d3f5dca17dfb0594bc81258dd7fa53dd7184a05662d94e77f4e9d6768997aff` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s186.wav` | 105884 | `4dc1f9fae3fdc2bda626cc422b7d220aa7e2cf3ea0abd56ccee17c8d61a649db` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s187.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s188.wav` | 88244 | `093e9a90a7a79293f8d0e13b7241f19d85cf1680bd9590ca2cb651cdcfbf59b2` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s190.wav` | 114708 | `5a6f511f1b079ab8f2aade3cb3eb7e05da213a151853bd4b0eba3777da2b1677` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s191.wav` | 129404 | `ef53323022633902c04873e8e1cc0c1731dbc05314a988411f9fe26a4144e0b3` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s192.wav` | 144108 | `9914b254818a5e47d605c52f5f053e7c01ab8b23f7565dc59685881e63c14b16` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s193.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s194.wav` | 91188 | `2e3af06f716da19d76df0b537a6119b07f9009e04d2b295bf78943376c2a64be` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s196.wav` | 167628 | `f5d77f6afa9fbbc4d4f07fc45feb935be4f31b7376e3d494f92efef5ff31c09f` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s197.wav` | 111764 | `04b571fe76ac86c31d5603e59117cafa3b6011835097456147211dcd574970e5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s198.wav` | 202908 | `36f66ec7c9e57d5f24b75b3707fbf8a64e983925b343e0f642ef2b450e5c7a34` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s199.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s2.wav` | 173508 | `1a86701a78f0630f685c14dbc3d5109da635bcf7213274482b774f9529aca824` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s20.wav` | 191148 | `c791fe34f12712ea76def0f4bb97cc532680b9b31c4efa425dcbc9a46649e6f5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s200.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s201.wav` | 126468 | `c430e10d10a50fea774cc0b63f9535e8ca86c87fd1ac92adf2da2eec2290057a` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s203.wav` | 152924 | `e6e9d3b9699e50867fc6f4de5e659ac341afd385cdd2cca0b0f572f25fea7a19` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s204.wav` | 152924 | `90ade840777129a877bbf0a8e9bd375f041e526846bef6b5cc0d1a26bcea1914` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s205.wav` | 120588 | `290c0dc86bfdb6e2306a0d8e38a4f77f988860f7641bc46fd61a5326191767d4` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s206.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s207.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s208.wav` | 64724 | `ab988fed5ab8ed6b61dba130e526221bc47bc8d2e2f3ceef8f605551c556e3ad` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s21.wav` | 176444 | `14cc2fb5c26105818a7931fed912b12bb66cb955816cb6173551c3d46e084c92` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s210.wav` | 170564 | `1e4368561fd66944da7df74fa908a9186b2f72ef5b2c05623d7991738850c3e2` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s211.wav` | 179388 | `aa73ebaa7989fe41fe8a9eaf37560bea6e8d297b2bcf065cab384e6e89915911` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s212.wav` | 100004 | `a5a738384dab78ecee49860b0e7ee096f146023996536fdd822be3aa38a9d6b0` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s213.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s214.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s215.wav` | 105884 | `f61c140143c5099d29c9bdce44b2dc580c4a743225d5b397c1195bf0b5a7bf7c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s217.wav` | 91188 | `a3e5a8750112c8efd9d947ac5810fb9aa86f280351e8e595a4d3b8a98e06e676` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s218.wav` | 199964 | `59b9e7686bcdb512478d8e454243db878400b68bc57ba350a7e3a5faabbc8cbc` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s219.wav` | 129404 | `1335075503ab2e921dff30f9f82bf769ea6e1f5e867d7a0785b51234a163bc0b` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s22.wav` | 111764 | `450bf54d9b597121961fde08ea2c5071e948482d82fee31992560d5c5f7bba54` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s221.wav` | 2996 | `44f5f6e7f79bbc311730d76eb91e6c98f41178411a360615bb9c3adeee42d8cd` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s222.wav` | 18420 | `cd4e9c7a9591151996dc143dd86e1486a2dc8afa1a9bf426428995463f8ba9dd` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s224.wav` | 17318 | `d726c676f65fe8ed29fdd4190b37fb8c29ec504b9f2901ba6d66594c56805188` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s225.wav` | 12256 | `d6fa2c886437f0bef6ede468c738263d9e6aa9037e9ae5225da1bf2ed6fab87d` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s23.wav` | 141164 | `6da26e8b34a11fcc7f9d9d573aee3de6f5dcf890fefee6a12bf1df8e064021f9` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s24.wav` | 144108 | `c69629a3d300b6b5006c6e645643496ad4a3675868bd73cc199d309976a66831` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s25.wav, Sound/s26.wav 字节相同 |
| `Sound/s25.wav` | 144108 | `c69629a3d300b6b5006c6e645643496ad4a3675868bd73cc199d309976a66831` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s24.wav, Sound/s26.wav 字节相同 |
| `Sound/s26.wav` | 144108 | `c69629a3d300b6b5006c6e645643496ad4a3675868bd73cc199d309976a66831` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s24.wav, Sound/s25.wav 字节相同 |
| `Sound/s27.wav` | 141492 | `66497375260493d6c94c23fcff0154d9d07f44ecfce1a2cdc9eb2f3d7b264c11` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s28.wav` | 144108 | `d965f000795f590c4c7e9174057ba122d1b541ff013bfb320123c8458d5986ed` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s29.wav 字节相同 |
| `Sound/s29.wav` | 144108 | `d965f000795f590c4c7e9174057ba122d1b541ff013bfb320123c8458d5986ed` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s28.wav 字节相同 |
| `Sound/s3.wav` | 135284 | `48daa937828a6ee62a88419bad018bb7b609e75ff2bb02de5ffbe8828305d41b` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s30.wav` | 143504 | `45406898efe7fea0adc1a6f76323cd5159ab020a68ebfe47949cb288164a6b17` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s31.wav` | 85308 | `a7b43a3c0e5b970017bfc1d6c0df3a6d1ffc2afa2fa6379de3787a503fafc270` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s33.wav` | 155868 | `b979479ea3d04a644930fc65de34f46a26998a53f309c8375e6fc7d4fe637a80` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s34.wav` | 155868 | `6c5d9f3788b169f9bbaa337f48bc4264a1fa4131b7d8fc2a59fe00baf6c376ad` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s35.wav 字节相同 |
| `Sound/s35.wav` | 155868 | `6c5d9f3788b169f9bbaa337f48bc4264a1fa4131b7d8fc2a59fe00baf6c376ad` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s34.wav 字节相同 |
| `Sound/s36.wav` | 176444 | `391c24e0891ec74beb266cc1255ba791ea70893a635ff7def99e995165c18bda` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s42.wav, Sound/s43.wav, Sound/s44.wav 字节相同 |
| `Sound/s37.wav` | 152924 | `8cc17e386ca8269f942e4afe979d28e66d9db4b03536a1da1dc32946f242268d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s38.wav, Sound/s39.wav 字节相同 |
| `Sound/s38.wav` | 152924 | `8cc17e386ca8269f942e4afe979d28e66d9db4b03536a1da1dc32946f242268d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s37.wav, Sound/s39.wav 字节相同 |
| `Sound/s39.wav` | 152924 | `8cc17e386ca8269f942e4afe979d28e66d9db4b03536a1da1dc32946f242268d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s37.wav, Sound/s38.wav 字节相同 |
| `Sound/s4.wav` | 112184 | `cac33660f9fa411f786ec7651730601d0a629880eaf45e8483ffecf017f11637` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s6.wav 字节相同 |
| `Sound/s40.wav` | 100004 | `3399259adcfdc12f3d7073f00658e25dc6b0e013c464d742d5e5cbc56d8dc26e` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s41.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s42.wav` | 176444 | `391c24e0891ec74beb266cc1255ba791ea70893a635ff7def99e995165c18bda` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s36.wav, Sound/s43.wav, Sound/s44.wav 字节相同 |
| `Sound/s43.wav` | 176444 | `391c24e0891ec74beb266cc1255ba791ea70893a635ff7def99e995165c18bda` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s36.wav, Sound/s42.wav, Sound/s44.wav 字节相同 |
| `Sound/s44.wav` | 176444 | `391c24e0891ec74beb266cc1255ba791ea70893a635ff7def99e995165c18bda` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s36.wav, Sound/s42.wav, Sound/s43.wav 字节相同 |
| `Sound/s45.wav` | 123524 | `8d5c4ba3ab03767b30cd94c9503bc710c2dcbc1d02e039a355004748d147d686` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s47.wav` | 252884 | `155fc2c7797406ffd48fed38df06527a4f0015451892156efdaf637fcc76ea8e` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s48.wav` | 173508 | `6dd8173109c982fd5e8ec915b6e0ab3e027fd83a60b282f2e69157838f957917` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s49.wav, Sound/s50.wav, Sound/s51.wav, Sound/s52.wav, Sound/s53.wav 字节相同 |
| `Sound/s49.wav` | 173508 | `6dd8173109c982fd5e8ec915b6e0ab3e027fd83a60b282f2e69157838f957917` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s48.wav, Sound/s50.wav, Sound/s51.wav, Sound/s52.wav, Sound/s53.wav 字节相同 |
| `Sound/s5.wav` | 112708 | `a59031152b7ee7f02912769856dfa9d469d7bc1eedf2ed23a4f8b6cbff5f7e6c` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s50.wav` | 173508 | `6dd8173109c982fd5e8ec915b6e0ab3e027fd83a60b282f2e69157838f957917` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s48.wav, Sound/s49.wav, Sound/s51.wav, Sound/s52.wav, Sound/s53.wav 字节相同 |
| `Sound/s51.wav` | 173508 | `6dd8173109c982fd5e8ec915b6e0ab3e027fd83a60b282f2e69157838f957917` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s48.wav, Sound/s49.wav, Sound/s50.wav, Sound/s52.wav, Sound/s53.wav 字节相同 |
| `Sound/s52.wav` | 173508 | `6dd8173109c982fd5e8ec915b6e0ab3e027fd83a60b282f2e69157838f957917` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s48.wav, Sound/s49.wav, Sound/s50.wav, Sound/s51.wav, Sound/s53.wav 字节相同 |
| `Sound/s53.wav` | 173508 | `6dd8173109c982fd5e8ec915b6e0ab3e027fd83a60b282f2e69157838f957917` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s48.wav, Sound/s49.wav, Sound/s50.wav, Sound/s51.wav, Sound/s52.wav 字节相同 |
| `Sound/s54.wav` | 100004 | `d995f524cac8ca453d42bab40eaa9cf857d9307c9296eb48581483f75f2ab27a` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s56.wav` | 179388 | `9d29e20d33ebc728745a83e52714427fa1275519d74af53c4d186dc07b70f1a1` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s6.wav` | 112184 | `cac33660f9fa411f786ec7651730601d0a629880eaf45e8483ffecf017f11637` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s4.wav 字节相同 |
| `Sound/s63.wav` | 138228 | `2e715b8e12c770cb5ee8de587c1e09890112429ab4cd00999f8fc1d94b253a8d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s71.wav 字节相同 |
| `Sound/s65.wav` | 205844 | `63c0cbbaf53d7e18625ec0c78605664b93701046afff4aaa6a815a813ab56ac9` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s66.wav, Sound/s67.wav 字节相同 |
| `Sound/s66.wav` | 205844 | `63c0cbbaf53d7e18625ec0c78605664b93701046afff4aaa6a815a813ab56ac9` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s65.wav, Sound/s67.wav 字节相同 |
| `Sound/s67.wav` | 205844 | `63c0cbbaf53d7e18625ec0c78605664b93701046afff4aaa6a815a813ab56ac9` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s65.wav, Sound/s66.wav 字节相同 |
| `Sound/s69.wav` | 138228 | `2942504715f1ca8ce071f067b50d77f4949b9228e863c7777db4af74c51f661e` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s70.wav 字节相同 |
| `Sound/s7.wav` | 205844 | `2b18b189038d35a8c78984a2a035fedee3f6b77fa0f9e872fd5f33bada7941b6` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s70.wav` | 138228 | `2942504715f1ca8ce071f067b50d77f4949b9228e863c7777db4af74c51f661e` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s69.wav 字节相同 |
| `Sound/s71.wav` | 138228 | `2e715b8e12c770cb5ee8de587c1e09890112429ab4cd00999f8fc1d94b253a8d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s63.wav 字节相同 |
| `Sound/s72.wav` | 117644 | `15c6b1cc8bcb1d2ed7ec56fb7b054ee1054e11b50d7284ebb3c2cdec4a1300cc` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s74.wav` | 152924 | `488cd8a49b970bfa99b50f2d8247cbddf73c9004c4deb86002a6217e6779d6bf` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s75.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s88.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s76.wav` | 117644 | `77a5344e096bca50e315961f377626108e642f02f9f3c3d409bd6bd8ee45da04` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s77.wav, Sound/s78.wav 字节相同 |
| `Sound/s77.wav` | 117644 | `77a5344e096bca50e315961f377626108e642f02f9f3c3d409bd6bd8ee45da04` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s76.wav, Sound/s78.wav 字节相同 |
| `Sound/s78.wav` | 117644 | `77a5344e096bca50e315961f377626108e642f02f9f3c3d409bd6bd8ee45da04` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s76.wav, Sound/s77.wav 字节相同 |
| `Sound/s79.wav` | 141164 | `a20558af9716f6d3acf69554e89f1faf780e12a5cbdf4bbc44142bb736ab6aa0` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s84.wav, Sound/s85.wav 字节相同 |
| `Sound/s8.wav` | 152924 | `394926067b2d5367fcd9cad8e3a4bb3a12334d20260d927e516a2117652dbcaf` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s81.wav` | 179388 | `1e231da5df4d7748e3266ba0ab8a2fadd85230e8ee9fac7e2f9157446a67884f` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s83.wav` | 141164 | `8458539137af41ae9c6550fccbcdf11f50c983f5107f65e3cd39382e32b055cb` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s84.wav` | 141164 | `a20558af9716f6d3acf69554e89f1faf780e12a5cbdf4bbc44142bb736ab6aa0` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s79.wav, Sound/s85.wav 字节相同 |
| `Sound/s85.wav` | 141164 | `a20558af9716f6d3acf69554e89f1faf780e12a5cbdf4bbc44142bb736ab6aa0` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s79.wav, Sound/s84.wav 字节相同 |
| `Sound/s86.wav` | 64724 | `998591eb92a2a381271caf2ef315592f7abdab13c4ec7921a2de156dae144e2d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s91.wav, Sound/s92.wav, Sound/s93.wav 字节相同 |
| `Sound/s88.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s89.wav, Sound/s90.wav 字节相同 |
| `Sound/s89.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s90.wav 字节相同 |
| `Sound/s90.wav` | 29356 | `993eb506ec71671c0c2e9e2b8ca79243fb7c53ecc8d0acb87cd4a35b05608768` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s100.wav, Sound/s124.wav, Sound/s159.wav, Sound/s168.wav, Sound/s169.wav, Sound/s174.wav, Sound/s178.wav, Sound/s182.wav, Sound/s187.wav, Sound/s193.wav, Sound/s199.wav, Sound/s200.wav, Sound/s206.wav, Sound/s207.wav, Sound/s213.wav, Sound/s214.wav, Sound/s41.wav, Sound/s75.wav, Sound/s88.wav, Sound/s89.wav 字节相同 |
| `Sound/s91.wav` | 64724 | `998591eb92a2a381271caf2ef315592f7abdab13c4ec7921a2de156dae144e2d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s86.wav, Sound/s92.wav, Sound/s93.wav 字节相同 |
| `Sound/s92.wav` | 64724 | `998591eb92a2a381271caf2ef315592f7abdab13c4ec7921a2de156dae144e2d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s86.wav, Sound/s91.wav, Sound/s93.wav 字节相同 |
| `Sound/s93.wav` | 64724 | `998591eb92a2a381271caf2ef315592f7abdab13c4ec7921a2de156dae144e2d` | RIFF WAVE / PCM | 音效/语音 | 与 Sound/s86.wav, Sound/s91.wav, Sound/s92.wav 字节相同 |
| `Sound/s94.wav` | 144108 | `590ba5bc76878c07efa3a24de597cf2512781ccd8c7c4d938eca504ab1d2e106` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s96.wav` | 88244 | `c5f9e186c8caf06c07ecc432806c014e38d5d8845e99654cd5b4d787204acb23` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s97.wav` | 147044 | `38bced5a3bd733a6c2c8b6774cb99e0fe1d8473fba08317b1842dd572c914b80` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s98.wav` | 158804 | `ab054622f2bf864f52fda99dd67b02f3fd21e4a771b0fcb05cad7c01f579d15b` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/s99.wav` | 157548 | `2bc47674c47c88446d00aa2434280038ea5790834255ba905ef60a21e45e1527` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/tt.wav` | 43244 | `f4c079a5c2a495b14640be9633f4ced2c85f18cdf16d0a49b52665ed1077f0c5` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/tt2.wav` | 170364 | `686c029f9b7581620552347374273bf1731bfe99181a3aebb21904542b6808ee` | RIFF WAVE / PCM | 音效/语音 |  |
| `Sound/tt3.wav` | 177988 | `40199beacac5504b5e11b8bd40350824c1a63433295a68306b85afd842925efa` | RIFF WAVE / PCM | 音效/语音 |  |
| `Title/Logo.flc` | 1083430 | `c01d8a5061738af823c6b84f87c6e0f4203a1d49072bb6eb45dfe92e08ea2a29` | Autodesk FLC 640×480×8bpp | 过场动画 |  |
| `Title/Redants.flc` | 456792 | `05eab0c802b93dcfd7fe482189a5eed2e1f5e628a6e240a874fb243608d5b54b` | Autodesk FLC 640×480×8bpp | 过场动画 |  |
