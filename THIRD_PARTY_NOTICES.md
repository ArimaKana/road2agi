# 第三方资源与许可

本仓库的源代码、脚本、配置、测试和文档采用仓库根目录 [LICENSE](LICENSE) 中的 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)。本文件列出不适用该许可的资源；分发、再发布或修改后再分发时，请保留本文件和对应的许可文件。

## 许可范围

Apache-2.0 适用于：

- `game/src/`、`game/scripts/` 中的源代码和脚本；
- `tools/` 中的美术管线脚本；
- `game/` 下的配置、测试文件与数据清单；
- `docs/` 中的文档。

以下资源按各自许可使用，不纳入 Apache-2.0：

- `art/` 与 `game/public/assets/` 中的美术、字体、音频和 3D 模型资源；
- 根目录的 `当然可以好问题.m4a` 和宣传视频；
- 通过 npm 安装、打包进构建产物的第三方库。

## 运行时依赖

构建产物（`game/dist/`）包含以下 npm 包中的代码，分别保留其 MIT 许可与版权声明：

| 组件 | 版本 | 许可 |
| --- | --- | --- |
| [three.js](https://threejs.org/) | 0.187.0 | MIT |
| [Vue](https://vuejs.org/) | 3.5.44 | MIT |

其余 npm 包只在开发、测试和构建时使用，不进入构建产物，许可仍以各自上游为准。

### three.js

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Vue

```text
The MIT License (MIT)

Copyright (c) 2018-present, Yuxi (Evan) You

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## 角色形象与角色美术

- 角色形象参考 [ai-chan-sheets](https://github.com/lmy414/ai-chan-sheets)，版本固定到提交 `1b741cdf729909e81f34e77fa1fd565226f36cd3`。
- 该仓库的设定补全内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)：要求署名、非商业使用与相同方式共享；其 LICENSE 明确把“参考原图”排除在该许可之外。原始形象主要归 ZipZipPipe，补全工作归该仓库作者。
- `art/` 中的角色立绘、表情、姿势、海报，以及 `game/public/assets/` 中的角色图集、卡牌和动画等角色衍生素材，不纳入本项目的 Apache-2.0 许可，需遵循上述上游授权要求；商用计划应分别确认原始角色和补全作品的授权。
- 本作的原创角色设定、敌人、Boss、技能、关卡和武器设计记录见[游戏设定与美术制作规范](docs/Road_to_AGI_游戏设定与美术制作规范.md)。不要把第三方角色图或品牌标记声明为本作独占原创。

## 字体

以下字体随游戏分发，均采用 [SIL Open Font License 1.1](https://openfontlicense.org/)，许可全文保留在对应文件中：

| 文件 | 上游字体 | 许可全文 |
| --- | --- | --- |
| `game/public/assets/fonts/r2a-display-serif.woff2` | Noto Serif SC | `game/public/assets/fonts/OFL.txt` |
| `game/public/assets/fonts/r2a-title-capitals.woff2` | Cinzel Decorative | `game/public/assets/fonts/title-capitals-OFL.txt` |
| `game/public/assets/fonts/r2a-title-script.woff2` | Great Vibes | `game/public/assets/fonts/title-script-OFL.txt` |

子集化后的字体已按 OFL 的保留字体名规则重命名，上游来源和重新生成方法见[字体说明](game/public/assets/fonts/README.md)。

## 第三方参考模型

`art/Xbot.glb` 是 three.js 示例中的 [Xbot](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Xbot.glb)（Mixamo X Bot），只用于本地姿势参考，不进入构建产物；使用和再分发遵循 Mixamo 与 three.js 的上游条款，不纳入 Apache-2.0。

## 音频与视频

- 背景音乐《当然可以好问题》及其重混版本（仓库根目录 `当然可以好问题.m4a`、`game/public/assets/audio/dangran-keyi-hao-wenti.mp3`）由项目作者制作或提供，不随 Apache-2.0 发布；版权和使用条件由作者与相应权利人决定。
- `art/Road_to_AGI_游戏介绍.mp4` 等宣传视频包含上述音乐与游戏画面，同样不在 Apache-2.0 范围内。

## 本项目自行制作的资源

`art/` 与 `game/public/assets/` 中由本项目制作的美术、模型和音效（包括界面图标、场景低模、粒子特效和宣传物料）版权归项目作者所有，不纳入 Apache-2.0。如需在本仓库之外单独使用，请通过仓库 Issue 联系作者确认。

## 名称与商标

游戏内出现的 AI 公司、产品和服务名称及其标识归各自权利人所有，本项目仅用于角色设定、致敬与说明，不声明所有权或关联关系。代码和文档中引用的第三方库、工具名称同样归其各自权利人所有。
