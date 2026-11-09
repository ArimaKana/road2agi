# 界面衬线字体

`r2a-display-serif.woff2` 是 Noto Serif SC 的 500 字重子集，用于金色按钮和标题。字体随游戏分发，运行时不依赖外部字体服务。许可见同目录的 `OFL.txt`。

上游来源：[Noto CJK，提交 985fa52c81c1d6692ccdd82bc3656e8fb932fd89](https://github.com/notofonts/noto-cjk/blob/985fa52c81c1d6692ccdd82bc3656e8fb932fd89/google-fonts/NotoSerifSC%5Bwght%5D.ttf)。

添加新的中文界面文案后，在仓库根目录重新生成子集：

```powershell
New-Item -ItemType Directory -Force qa/font-source, qa/font-tools | Out-Null
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/notofonts/noto-cjk/985fa52c81c1d6692ccdd82bc3656e8fb932fd89/google-fonts/NotoSerifSC%5Bwght%5D.ttf' -OutFile qa/font-source/NotoSerifSC.ttf
python -m pip install --target qa/font-tools 'fonttools[woff]==4.68.0'
$env:PYTHONPATH = (Resolve-Path qa/font-tools).Path
python game/scripts/subset-display-font.py qa/font-source/NotoSerifSC.ttf
```

脚本保留当前 `game/src` 中的界面及动态名称字符、ASCII、原始字体的授权信息。缺少的字符按 CSS 字体栈回退。字体处理工具仅用于更新资源，常规构建不需要 Python。

## 首页英文标题

金色 `ROAD / AGI` 使用 [Cinzel Decorative Regular](https://github.com/google/fonts/tree/main/ofl/cinzeldecorative) 的标题字母子集；白色连笔 `to` 使用 [Great Vibes Regular](https://github.com/google/fonts/tree/main/ofl/greatvibes) 的标题字母子集。两个子集分别重命名为 `R2A Title Capitals` 和 `R2A Title Script`，许可分别保留在 `title-capitals-OFL.txt`、`title-script-OFL.txt`。

复用上面的字体工具目录，重新生成标题字体：

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/google/fonts/main/ofl/cinzeldecorative/CinzelDecorative-Regular.ttf' -OutFile qa/font-source/CinzelDecorative-Regular.ttf
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/google/fonts/main/ofl/greatvibes/GreatVibes-Regular.ttf' -OutFile qa/font-source/GreatVibes-Regular.ttf
$env:PYTHONPATH = (Resolve-Path qa/font-tools).Path
python game/scripts/subset-title-fonts.py qa/font-source
```
