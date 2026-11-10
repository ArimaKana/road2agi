# Road to AGI

DeepSeek 主角的浏览器游戏，以及游戏设定和宣传美术。

## 运行

需要 Node.js 22.18 或以上。技术栈是 Vite、Vue、TypeScript 和 Three.js，优先使用 WebGPU，浏览器不支持时自动回退到 WebGL 2。

```sh
cd game
npm install
npm run dev
```

打开 <http://localhost:4173>。操作说明、已实现功能和美术处理流程见 [游戏说明](game/README.md)。

```sh
cd game
npm test
```

## 项目文件

- [game/](game/)：游戏代码、运行资源和测试。
- [tools/](tools/)：美术管线脚本，都从仓库根目录运行。
- `art-source/`、`qa/`、`video-production/`：美术原料、检查脚本和视频工程，只在本机，不进版本库。
- [游戏设定与美术制作规范](docs/Road_to_AGI_游戏设定与美术制作规范.md)：游戏设计与角色、美术制作要求。
- [美术资源清单](docs/Road_to_AGI_美术资源清单.md)：资源规划表。
- [深蓝金横版海报](art/Road_to_AGI_横版海报.png)：1920×1080（16:9），角色面部参考游戏素材；DeepSeek 直视镜头、表情参考 Qwen 的平静神态。画面适度降低饱和度；Logo 保持游戏原色、字体和排版，并有深蓝晕影衬底。
- [4:3 海报](art/Road_to_AGI_海报_4比3.png)：1440×1080，由横版中央裁切，保留全部角色头部及 Logo。
- 横版素材：[无字底图](art/Road_to_AGI_横版海报_无字.png)、[游戏 Logo 透明图](art/ui/game-logo.png)、[生图提示词与制作记录](art/Road_to_AGI_横版海报_prompt.txt)；运行 `node tools/poster_exports.mjs` 可重新合成两个比例。
- [游戏图标](art/ui/game-icon-500.png)：500×500 PNG，基于 DeepSeek 人物头像制作；[生成提示词](art/ui/game-icon-500.prompt.txt)。
- [游戏介绍视频](art/Road_to_AGI_游戏介绍.mp4)：60 秒的 1080p 实机介绍；战斗开场，九位伙伴技能完整展示，对话后移，横版海报收尾。金色粗衬线字幕配柔和晕影，配乐为根目录的 `当然可以好问题.m4a`；[剪辑时间线与重建说明](docs/宣传片制作.md)。

![Road to AGI 横版海报](art/Road_to_AGI_横版海报.png)

Three.js 为 MIT 许可，由 npm 安装。角色参考来源及说明见游戏设定文档。
