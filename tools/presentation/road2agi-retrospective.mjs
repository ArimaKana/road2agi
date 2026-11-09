/**
 * Editable 19-slide retrospective in six chapters: game → playstyle → characters → workflow → gaps → takeaways.
 * In Artifact Session, import this module and pass authorRetrospective to run().
 * Author in separate batches using input { root, fromSlide, toSlide }.
 * Start with an empty presentation; this callback never clears existing slides.
 * To insert one slide into an existing deck, pass a zero-based insertAfter index.
 * Source baseline: main at 1512a12, plus the author's 2026-11-05 retrospective.
 */
export const slideCount = 19;

export async function authorRetrospective({ presentation, input = {} }) {
  const root = (input.root ?? 'D:/workspace/road2agi').replaceAll('\\', '/');
  const first = input.fromSlide ?? 1, last = input.toSlide ?? slideCount;
  if (first < 1 || last > slideCount || first > last) throw new Error('Invalid slide range');
  const insertAfter = input.insertAfter;
  if (insertAfter === undefined) {
    if (presentation.slides.items.length !== first - 1) throw new Error(`Expected ${first - 1} existing slides`);
  } else if (first !== last || !Number.isInteger(insertAfter) || insertAfter < 0 || insertAfter >= presentation.slides.items.length) {
    throw new Error('Insertion requires one slide and an existing zero-based insertAfter index');
  }
  const C = { bg: '#08182D', text: '#EDF2F7', muted: '#ADC1D4', gold: '#F0D59A', blue: '#15324C', border: '#304B63' };
  const font = 'Microsoft YaHei';
  const txt = (s, value, x, y, w, h, size = 26, color = C.text, bold = false) => {
    const t = s.shapes.add({ geometry: 'textbox', name: value.slice(0, 28), position: { left: x, top: y, width: w, height: h }, fill: 'none', line: { fill: 'none', width: 0 } });
    t.text = value;
    t.text.style = { typeface: font, fontSize: size, color, bold, insets: 0, autoFit: 'none', wrap: 'square', verticalAlignment: 'top' };
    return t;
  };
  const img = (s, source, x, y, w, h, alt) => s.images.add({ path: `${root}/${source}`, position: { left: x, top: y, width: w, height: h }, fit: 'contain', alt });
  const asset = (s, name, x, y, w, h, alt = name, ext = 'webp') => img(s, `docs/presentations/assets/${name}.${ext}`, x, y, w, h, alt);
  const notes = (s, narration, sources) => { s.speakerNotes.text = `${narration}\n\n依据：${sources}\n项目代码口径：main / 1512a12。制作经历与工具版本按作者 2026-11-05 的复盘记录。实机图来自项目已有宣传片原始录像，具体帧见 docs/presentations/assets.json。`; };
  const createSlide = () => {
    const options = { width: 1280, height: 720 };
    return insertAfter === undefined ? presentation.slides.add(options) : presentation.slides.insert({ ...options, after: insertAfter }).slide;
  };
  const base = (number, title) => {
    const s = createSlide();
    s.background.fill = C.bg;
    txt(s, title, 56, 42, 1168, 82, 42, C.text, true);
    txt(s, String(number).padStart(2, '0'), 1192, 679, 40, 24, 15, C.muted);
    return s;
  };
  const para = (s, heading, body, x, y, w, bodyHeight = 76) => {
    txt(s, heading, x, y, w, 44, 28, C.gold, true);
    txt(s, body, x, y + 49, w, bodyHeight, 24, C.text);
  };
  const table = (s, values, widths, y = 157, h = 430, size = 23) => {
    const t = s.tables.add({ rows: values.length, columns: values[0].length, left: 56, top: y, width: 1168, height: h, columnWidths: widths, values });
    t.borders.assign({ fill: C.border, width: 0.6, style: 'solid' });
    for (let r = 0; r < values.length; r++) {
      t.rows[r].height = h / values.length;
      for (let c = 0; c < values[0].length; c++) {
        const cell = t.getCell(r, c);
        cell.fill = r === 0 ? C.blue : C.bg;
        cell.text.style = { typeface: font, fontSize: size, color: r === 0 ? C.gold : C.text, bold: r === 0, insets: 14, verticalAlignment: 'middle', autoFit: 'none' };
      }
    }
    return t;
  };
  for (let n = first; n <= last; n++) {
    let s;
    switch (n) {
      case 1:
        s = createSlide(); s.background.fill = C.bg;
        img(s, 'art/Road_to_AGI_横版海报.png', 0, 0, 1280, 720, 'Road to AGI 项目海报');
        txt(s, '游戏制作复盘', 46, 30, 490, 70, 48, C.gold, true);
        txt(s, '玩法选择、角色设计与工作流', 48, 104, 470, 64, 25);
        notes(s, '这次复盘围绕一个问题展开：如何让玩法深度、角色表现和可承受的制作成本同时成立。先展示当前作品，再回看方向选择、资源管线与仍然不足的地方。', '作者制作复盘；README.md；art/Road_to_AGI_横版海报.png。');
        break;
      case 2:
        s = base(2, '目录');
        txt(s, '六个部分：从成品，到玩法、角色、工作流，再回到不足与收获。', 56, 122, 1168, 40, 26, C.muted);
        const chapters = [
          ['做了什么游戏', '先看成品：一位主角、九位伙伴、\n四个大区的浏览器动作游戏，再交代制作过程。'],
          ['玩法定型', '灵感来自一条短视频，用 SWOT 判断能做多大，\n再决定哪些玩法留下、哪些砍掉。'],
          ['角色设计', '把模型的梗变成技能：GPT 重置会话、\nClaude 封禁裁决、MiniMax 胶片列车，\n以及伙伴组合带来的选择。'],
          ['工作流搭建', '技术栈怎么选；图片、动画、音乐怎么生产，\n生成结果又怎么接进游戏。'],
          ['当前不足', '音效、手感、内容体量：\n哪些现在就能改，哪些要往后排。'],
          ['收获', '这次真正学到的方法：\n让玩法、表现和产线互相约束。'],
        ];
        chapters.forEach(([heading, body], i) => {
          const x = i % 2 === 0 ? 56 : 668;
          const y = 186 + Math.floor(i / 2) * 152;
          txt(s, String(i + 1).padStart(2, '0'), x, y, 60, 46, 30, C.gold, true);
          txt(s, heading, x + 62, y - 1, 494, 48, 28, C.gold, true);
          txt(s, body, x, y + 52, 556, 84, 22);
        });
        txt(s, '重点在第 2、3、4 部分：玩法为什么这样选、角色怎么设计、工作流怎么搭。', 56, 640, 1168, 40, 24, C.gold);
        s.speakerNotes.text = [
          '这次分享按六章推进：先给成品，再讲玩法怎么定、角色怎么设计、工作流怎么搭，最后回到不足与收获。每一步尽量给出代码或素材能验证的细节，避免只讲感受。',
          '1. 做了什么游戏：一位主角、九位伙伴、四个大区 28 间房的浏览器动作 Roguelite。先让观众建立印象，再引出制作过程。',
          '2. 玩法定型：灵感来自一条短视频；用 SWOT 判断自己能做多大，再决定共斗、横版、多角色操作三个方向怎么处理，最后收敛到单主角、召唤卡与混合 3D。',
          '3. 角色设计：把模型梗变成技能，九位伙伴共用同一条设计路径，再通过升级与组合让阵容真的有差别。',
          '4. 工作流搭建：技术栈选择，图片、动画、音乐三条素材产线，以及生成结果如何接进游戏。',
          '5. 当前不足：音效、手感、多武器、构筑与更多角色，按依赖关系排出先后。',
          '6. 收获：让玩法、表现和产线互相约束；扩展时先问新增内容如何改变玩家的选择。',
          'B 站视频版仍沿用八段结构：开场成品 → 创作起点 → 玩法定型 → 角色设计 → AI 分工 → 动画制作 → 体验打磨 → 收获与下一步。',
          '依据：作者于 2026-11-07 确认的六章大纲。',
        ].join('\n\n');
        break;
      case 3:
        s = base(3, '最近做的游戏：单人动作 Roguelite');
        para(s, '1 名可操作主角', 'DeepSeek 的刺剑连击、\n蓄力突刺与滑步', 56, 166, 338);
        para(s, '9 位召唤伙伴', '最多装备 3 张卡牌，\n提供控制、支援和爆发', 56, 330, 338);
        para(s, '4 个大区，28 间房', '主线推进、伙伴解锁\n与无尽试炼', 56, 494, 338);
        asset(s, 'combat', 420, 161, 804, 452, '缓存废港战斗实机');
        txt(s, '浏览器运行，支持键鼠、手柄和手机横屏', 420, 628, 804, 39, 24, C.muted);
        notes(s, '先用成品帮助观众建立印象：这是一款以 DeepSeek 为唯一可操作主角的浏览器动作 Roguelite。角色阵容通过召唤卡参与战斗。主线已经包含四个大区、28 间房和四位 Boss，另有无尽试炼。不要把这些内容规模等同于完成商业级打磨。', 'game/README.md；game/src/game/level.ts；game/src/game/cards.ts；game/package.json。');
        break;
      case 4:
        s = base(4, '核心循环：近身攒费，卡牌释放');
        para(s, '01  近身命中', '用刺剑连击与走位争取机会', 56, 154, 410, 55);
        para(s, '02  积累 Token', '命中与主角亲手击杀带来资源', 56, 278, 410, 55);
        para(s, '03  选择释放时机', '蓄力突刺与召唤卡共用资源', 56, 402, 410, 55);
        para(s, '04  清房后调整', '奖励、升级、换卡与武器改造', 56, 526, 410, 55);
        asset(s, 'loop', 506, 171, 718, 404, '刺剑战斗与三卡配置实机');
        txt(s, '即时操作和资源调度，\n共同决定这一场战斗怎么打。', 506, 599, 718, 69, 27, C.gold);
        notes(s, '核心不是不停等待技能冷却。近身攻击负责赚取 Token，召唤与蓄力负责消耗，玩家因此需要在操作风险和技能收益之间切换。清房后再通过卡牌、补给、改造改变下一场的选择。召唤造成的伤害不会反过来增加 Token 或觉醒，确保主角本人的战斗仍有价值。', 'game/src/game/cards.ts 的 TOKEN；game/src/game/simulation.ts 的 gainToken、attackHit；game/src/game/rewards.ts；game/src/game/summons.ts。');
        break;
      case 5:
        s = base(5, '灵感来源与游戏联想');
        const inspirationCredit = txt(s, '灵感来源\n@大运的奇妙冒险', 56, 166, 320, 92, 28, C.gold, true);
        inspirationCredit.text.get('@大运的奇妙冒险').link = { uri: 'https://space.bilibili.com/zh-Hans/3546715219036947', isExternal: true };
        txt(s, '先有想把角色做成游戏的\n创作冲动', 56, 288, 320, 86, 24);
        const inspirationLink = txt(s, '原视频\nhttps://b23.tv/rB1WOi2', 56, 400, 320, 72, 20, C.muted);
        inspirationLink.text.get('https://b23.tv/rB1WOi2').link = { uri: 'https://b23.tv/rB1WOi2', isExternal: true };
        txt(s, '联想到的游戏', 400, 166, 824, 44, 28, C.gold, true);
        [
          ['cover-ff-type0', '最终幻想\n零式', '《最终幻想零式 HD》封面'],
          ['cover-ff-dissidia012', '最终幻想\n纷争 012', '《Dissidia 012 最终幻想》PSP 封面'],
          ['cover-yggdra-union', '公主同盟', '《公主同盟》封面'],
          ['cover-valkyrie-elysium', '北欧女神\n极乐世界', '《北欧女神：极乐世界》封面'],
          ['cover-hades', '黑帝斯', '《黑帝斯》封面'],
        ].forEach(([cover, label, alt], i) => {
          const x = 400 + i * 168;
          asset(s, cover, x, 240, 152, 228, alt);
          txt(s, label, x, 488, 152, 80, 24);
        });
        notes(s, '创作灵感来自 B 站 UP 主 @大运的奇妙冒险 发布的视频：https://b23.tv/rB1WOi2（BV164nS68EwU）。这段视频让作者萌生了把角色做成游戏的想法。作者由此联想到《最终幻想零式》《最终幻想纷争 012》《公主同盟》《北欧女神：极乐世界》《黑帝斯》。这一页交代灵感来源与游戏联想，后续再展开玩法取舍。配图使用对应游戏的封面；《最终幻想零式》采用 HD 版封面，《最终幻想纷争》按作者指定采用 012 版封面。', '原视频：https://www.bilibili.com/video/BV164nS68EwU/；UP 主主页（@大运的奇妙冒险）：https://space.bilibili.com/zh-Hans/3546715219036947；作者于 2026-11-09 指定的五款游戏及 012 封面。封面来源：https://store.steampowered.com/app/340170/；https://www.thevideogamecompany.com/products/dissidia-012-duodecim-final-fantasy-sony-psp；https://store.steampowered.com/app/2107860/；https://store.steampowered.com/app/1963210/；https://store.steampowered.com/app/1145360/；下载地址与本地文件对应关系见 docs/presentations/assets.json。');
        break;
      case 6:
        s = base(6, 'SWOT：先判断自己能做多大');
        const swot = table(s, [
          ['S  优势', 'W  短板'],
          ['善用工具解决问题\n打通生成、处理与接入流程\n策划能力较强\n平衡玩法深度与制作成本', '编剧能力仍需提升\n角色动机与剧情冲突还需打磨\n动画与导演经验不足\n加强动作节奏、镜头与演出衔接'],
          ['O  机遇', 'T  挑战'],
          ['网络迷因 IP 有热度与现成设定\n有机会借助关注，降低创作起步成本\nAI 能力提升\n为素材质量和迭代效率打开空间', '赛道拥挤，同类内容竞争较多\n需要通过玩法体验形成辨识度\n仍有未知领域\n新制作环节带来学习与试错成本'],
        ], [584, 584], 150, 446, 24);
        [54, 169, 54, 169].forEach((height, row) => { swot.rows[row].height = height; });
        for (const row of [0, 2]) for (const column of [0, 1]) {
          const cell = swot.getCell(row, column);
          cell.fill = C.blue;
          cell.text.style = { typeface: font, fontSize: 28, color: C.gold, bold: true, insets: 14, verticalAlignment: 'middle' };
        }
        txt(s, 'SWOT 的结论直接落成选型：工具是优势，编剧与导演是短板。', 56, 627, 1168, 42, 28, C.gold);
        notes(s, 'S 与 W 是个人能力自评，O 与 T 是对项目外部环境的判断。工具优势具体体现在把图片生成、动画参考、抠图、打包和游戏接入串成管线；策划优势体现在单主角、召唤卡和混合 3D 等取舍。短板集中在编剧、动画与导演能力，需要继续练习角色动机、剧情冲突、动作节奏和镜头衔接。网络迷因提供热度与既有设定，AI 能力提升带来迭代机会，但关注能否转成作品辨识度仍需验证。面对拥挤赛道和未知领域，可以通过小规模试作、试玩与反馈逐步积累经验。', '作者于 2026-11-05 补充的 SWOT 自评；本演示稿的玩法取舍、AI 工具分工与动画管线部分。机会与挑战按作者判断整理，未引入市场规模或热度统计。');
        break;
      case 7:
        s = base(7, '主角设定：DeepSeek 鲸鱼娘');
        para(s, '角色与目标', 'DeepSeek 鲸鱼娘，唯一可操作主角。\n在语义之海苏醒，救出伙伴、守护记忆。', 56, 164, 620, 90);
        para(s, '视觉设定', '蓝白女仆装、鳍耳与鲸尾，\n保留围裙鲸鱼纹和多层长裙。', 56, 326, 620, 90);
        para(s, '武器与动作', '单手刺剑“澄潮”：直刺、连刺与弓步。\n右手持剑，左手展牌召唤伙伴。', 56, 488, 620, 90);
        asset(s, 'hero-standing-rapier', 704, 36, 520, 636, 'DeepSeek 鲸鱼娘全身站立持剑图，游戏同风格，透明背景');
        const heroSource = txt(s, '形象：ZipZipPipe ｜ 设定补全：ai-chan-sheets', 56, 648, 644, 29, 18, C.muted);
        heroSource.text.get('ai-chan-sheets').link = { uri: 'https://github.com/lmy414/ai-chan-sheets', isExternal: true };
        notes(s, '主角是 DeepSeek 鲸鱼娘，也是唯一可操作角色。她在保存人类记忆的语义之海苏醒，携带礼剑“澄潮”，阻止归零协议无差别删除记忆，并救出沿途伙伴。角色形象沿用 ai-chan-sheets 中的 DeepSeek 原版设定，保留蓝白配色、鳍耳、鲸尾、女仆头饰、围裙鲸鱼纹和多层长裙。ai-chan-sheets 为设定补全项目，原始角色形象作者为 ZipZipPipe。游戏内身份、武器与动作体系来自本项目：澄潮是窄身直刃的单手刺剑，以直刺、连刺、弓步与蓄力贯潮刺为核心，右手持剑、左手展牌召唤。右侧为本次基于角色与武器参考生成的全身站姿插画，保留第一版站立持剑动作，画风参照游戏内角色帧，采用清晰线稿与柔和分层上色；实际文件保留透明 alpha。', 'docs/Road_to_AGI_游戏设定与美术制作规范.md 第 1、3.1、3.2、4 节；角色设定补全来源 https://github.com/lmy414/ai-chan-sheets；art-source/references/char03_views.jpg；art-source/references/DeepSeek_刺剑结构_v001.png；新图 art/hero/deepseek-standing-rapier-v002.png，由内置 image_gen 生成，完整提示词见同名 .prompt.txt；展示图处理见 docs/presentations/assets.json。');
        break;
      case 8:
        s = base(8, '由 SWOT 推出的三次取舍');
        table(s, [
          ['考虑的方向', '制作时的判断', '当前选择'],
          ['共斗', '实现与内容负担超出当前可承担范围', '单人完整战斗流程'],
          ['横版过关', '担心自己难以做出足够的战斗深度', '保留平面内走位与房间机关'],
          ['多角色操作', '每名角色都需要完整动作和操作体验', '一个主角，伙伴改为召唤卡'],
        ], [230, 478, 460], 166, 364, 24);
        txt(s, '最终用单人房间战斗承载动作与技能调度。', 56, 568, 1168, 60, 29, C.gold);
        notes(s, '这里讲的是个人项目条件下的判断，不是对共斗或横版类型的价值评价。作者最初认为共斗不现实，也担心自己做横版难以获得足够深度，于是联想到《最终幻想纷争》的角色战斗。实际项目进一步收敛到单主角、房间战斗与召唤卡。成本解释是结合现有实现对作者思路的整理。', '作者制作复盘第 4、8 点；game/src/game/simulation.ts；game/src/game/cards.ts；游戏设定第 1、4 节。');
        break;
      case 9:
        s = base(9, '单主角操作，伙伴通过卡牌登场');
        para(s, '动作深度集中在主角', '连段、蓄力、闪避、瞄准和大招，\n共用一套连续的操作体验', 56, 164, 740, 94);
        para(s, '角色差异集中在召唤效果', '半屏立绘、技能特效和短时造物，\n让九位伙伴分别承担不同战术角色', 56, 340, 740, 94);
        para(s, '阵容选择发生在三张卡之间', '开局选两张，第三槽通过奖励补齐。\n取舍来自费用、冷却、升级与组合。', 56, 516, 740, 94);
        asset(s, 'partners', 850, 142, 374, 526, '九位召唤伙伴的正式卡面');
        notes(s, '九名角色如果都能操作，就要承担九套连续动作和手感的制作与平衡。当前方案让主角提供稳定的操作底盘，伙伴用卡牌施放时机、效果和升级来区分。注意正常流程开局是两张卡，第三张在奖励中补齐；宣传片和调试入口可以展示完整三卡阵容。', 'game/src/game/cards.ts 的 SLOTS、START_SLOTS、UNLOCKS；game/src/components/CardCutIn.vue；游戏设定第 4 节。');
        break;
      case 10:
        s = base(10, '混合 3D：也是 SWOT 之后的取舍');
        asset(s, 'environment', 56, 162, 790, 444, '镜像书库的二维角色与三维房间');
        para(s, '3D 的前期优势', '多视角渲染、动作参考与绑定\n一次成型，起步更省事', 880, 160, 344, 76);
        para(s, '3D 的后期代价', '穿模、布料与挂点等琐碎问题\n随动作数量累积成维护成本', 880, 284, 344, 76);
        para(s, '场景仍走低模 3D', '承载碰撞、遮挡、机关\n与空间走位', 880, 408, 344, 76);
        para(s, '角色改用二维序列帧', '主角 8 向，精英 4 向，\n小怪与 Boss 通常 2 向', 880, 532, 344, 76);
        txt(s, '固定等距视角，把 3D 的自由度换回可控的素材规模。', 56, 628, 790, 36, 25, C.gold);
        txt(s, '《哈迪斯》带来视角与房间战斗的启发', 56, 672, 790, 26, 19, C.muted);
        notes(s, '这一页把混合 3D 放回第二章的取舍链条：它同样是 SWOT 的产物。3D 生成的角色在多视角渲染、动作参考和绑定复用上起步快，但穿模、布料与挂点这些琐碎问题会随动作数量累积，维护成本越来越高。最终选择是用二维序列帧承载角色表现，用低模 3D 承载空间与碰撞，再用固定等距视角收窄镜头与朝向的自由度，换取可控的素材规模。主角八向、精英四向、普通敌人与 Boss 以两向为主。此处只说《哈迪斯》给作者的启发，不声称本作与它采用相同技术。', '作者制作复盘第 4.3 点；game/README.md；游戏设定第 2 节；game/src/game/engine.ts；作者 2026-11-08 关于 3D 穿模与维护成本的补充。');
        break;
      case 11:
        s = base(11, '模型与角色意象，转译成技能');
        const examples = [
          ['gpt', 'GPT：重置会话', '会话重启的联想', '补满滑步充能，\n刷新另外两张卡的冷却'],
          ['minimax', 'MiniMax：万象片场', '影像与胶片的联想', '胶片列车冲撞，\n利用击退与撞墙创造机会'],
          ['claude', 'Claude：封禁裁决', '规则与裁决的联想', '延迟裁决、封印护盾，\n处决低血量的非 Boss 目标'],
        ];
        examples.forEach(([id, title, association, effect], i) => {
          const x = 56 + i * 400;
          asset(s, id, x, 143, 360, 322, `${id} 伙伴立绘`);
          txt(s, title, x, 475, 368, 46, 28, C.gold, true);
          txt(s, association, x, 527, 368, 38, 23, C.muted);
          txt(s, effect, x, 574, 368, 79, 24);
        });
        const characterSheetUrl = 'https://github.com/lmy414/ai-chan-sheets';
        const characterSheetCredit = txt(s, `大模型角色基础设定图来源：${characterSheetUrl}`, 56, 666, 1100, 31, 20, C.muted);
        characterSheetCredit.text.get(characterSheetUrl).link = { uri: characterSheetUrl, isExternal: true };
        notes(s, '作者提出要根据模型特征设计技能。这里挑三个在代码中能清楚对应的例子：会话重置转为冷却刷新，影像创作转为胶片列车，规则与封禁意象转为裁决。它们是角色化的创作表达，不是模型性能或服务行为的客观评测。其余伙伴在附录列出。游戏中大模型角色的基础设定图统一来自 ai-chan-sheets，基础形象作者及逐项署名见来源仓库；本项目在此基础上补充游戏内身份、武器与技能。', `作者制作复盘第 3 点；game/src/game/cards.ts；game/src/game/summons.ts；游戏设定第 5 节；大模型角色基础设定图来源：${characterSheetUrl}。`);
        break;
      case 12:
        s = base(12, '九位伙伴的基础技能');
        table(s, [
          ['伙伴', '技能', '费用 / 冷却', '主要作用'],
          ['GLM', '狐影渗透', '28 / 16 秒', '策反附近普通敌人，提供控场'],
          ['Qwen', '千问无界', '45 / 24 秒', '获得 1 次零消耗，用于贯潮刺或其他召唤卡'],
          ['Kimi', '月棱折光', '60 / 12 秒', '棱镜折射 3 次，优先攻击不同目标'],
          ['Seed', '豆包应援', '40 / 16 秒', '回复生命并放下替身，承担生存支援'],
          ['MiniMax', '万象片场', '20 / 12 秒', '胶片列车击退，撞墙追加伤害'],
          ['GPT', '重置会话', '65 / 28 秒', '补满滑步，刷新另外两张卡冷却'],
          ['Claude', '封禁裁决', '75 / 26 秒', '延迟裁决、溅射、封盾与非 Boss 处决'],
          ['Grok', '绯月惑心', '32 / 16 秒', '扇形魅惑，使普通敌人暂时无法攻击'],
          ['Gemini', '双星闪袭', '50 / 18 秒', '在多个目标间穿梭连击，追加终结一击'],
        ], [138, 196, 190, 644], 142, 510, 21);
        txt(s, '费用单位为 Token，表中为 I 级基础数值；升级与组合效果另计。', 56, 669, 1100, 26, 18, C.muted);
        notes(s, '这页用于现场问答，不必逐项朗读。所有费用与冷却来自当前 cards.ts，效果按基础等级概括，省略各角色针对精英和 Boss 的特殊结算。Qwen 已于 2026-11-09 按当前代码同步为一次零消耗，可用于贯潮刺或其他召唤卡，本房间内保留至用完。技能命名与联想是本作的角色设定，不代表对现实模型能力的评价。', 'game/src/game/cards.ts 的 CARDS、技能常量；game/src/game/summons.ts。');
        break;
      case 13:
        s = base(13, '工作流：技术栈与素材生产');
        table(s, [
          ['环节', '使用工具', '产出与接入'],
          ['开发', 'Claude Opus 5.5 + DeepSeek', '玩法规则、界面与资源处理脚本'],
          ['图片', 'gpt-image-2.5', '角色、卡面、场景贴图与特效素材'],
          ['动画', 'X Bot + MiniMax H3 r2v', '动作参考、角色视频与游戏图集'],
          ['音乐', 'Suno v6', '重混《当然可以好问题》作为 BGM'],
        ], [150, 490, 528], 157, 402, 24);
        txt(s, '工程落点：Vue + TypeScript + Three.js\nWebGPU 优先，兼容 WebGL 2', 56, 589, 1168, 77, 28, C.gold);
        notes(s, '工具名称与版本完全按作者这次提供的制作记录保留。仓库能验证资源管线和运行时接入，但不能独立确认每份素材具体由哪个模型版本生成，因此这里不添加速度、成本或质量对比。实际游戏采用 Vite、Vue、TypeScript 和 Three.js，模拟规则、渲染与资源脚本分别承担可检查的工程职责。', '作者制作复盘第 5、6、7 点；game/package.json；game/README.md；tools/reference3d、tools/comfy-r2v.mjs、tools/pack-r2v.mjs。');
        break;
      case 14:
        s = base(14, '动画管线：动作参考、角色生成、游戏图集');
        txt(s, '1  X Bot 动作参考', 56, 153, 360, 43, 29, C.gold, true);
        txt(s, '2  H3 r2v 角色生成', 456, 153, 360, 43, 29, C.gold, true);
        txt(s, '3  抠图、取帧与打包', 856, 153, 368, 43, 29, C.gold, true);
        asset(s, 'xbot', 56, 206, 360, 310, 'X Bot 的动作参考循环（动图）', 'gif');
        asset(s, 'generated', 456, 206, 360, 310, '对应动作的 H3 r2v 生成循环（动图）', 'gif');
        img(s, 'game/public/assets/deepseek-light1-v005.webp', 856, 206, 368, 310, '实际运行的轻击图集');
        txt(s, '确定姿势、节奏、位移\n按固定相机渲染多个方向', 56, 530, 360, 82, 24);
        txt(s, '结合人物设定与定位图\n把人偶动作转成角色表现', 456, 530, 360, 82, 24);
        txt(s, '去背景、挑动作峰值\n绑定脚底、剑尖与命中帧', 856, 530, 368, 82, 24);
        const xbotUrl = 'https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Xbot.glb';
        const xbotLink = txt(s, `X Bot 模型：${xbotUrl}`, 56, 632, 1168, 32, 20, C.muted);
        xbotLink.text.get(xbotUrl).link = { uri: xbotUrl, isExternal: true };
        notes(s, '前两格是循环播放的动图：同一段动作，左边是人偶参考，右边是 H3 r2v 生成的角色，两边逐帧对齐；第三格是运行时图集，静态。三张图都来自真实素材，不是流程示意图。X Bot 参考模型来自 three.js 的示例资产，项目内保存在 art/Xbot.glb。先定义动作，再由 H3 r2v 将人物设定套进相同的运动参考。后处理负责抠图、取帧、脚底与剑尖挂点，最后打包给游戏使用。角色设定图与定位图同时参与生成，固定镜头贯穿整条管线。', `${xbotUrl}；game/README.md 动画管线；tools/reference3d/build_reference.py；tools/make_h3_refs.py；tools/comfy-r2v.mjs；tools/matte_frames.py；tools/pack-r2v.mjs；assets.json。`);
        break;
      case 15:
        s = base(15, '非人形敌人的动画管线');
        txt(s, '以 E11 熵蚀编织者为例', 56, 120, 1168, 34, 24, C.muted);
        txt(s, '1  基本体动作参考', 56, 174, 360, 43, 28, C.gold, true);
        txt(s, '2  H3 r2v 外观生成', 456, 174, 360, 43, 28, C.gold, true);
        txt(s, '3  切帧与游戏接入', 856, 174, 368, 43, 28, C.gold, true);
        asset(s, 'enemy-reference', 56, 222, 360, 276, '熵蚀编织者的基本体攻击参考（动图）', 'gif');
        asset(s, 'enemy-generated', 456, 222, 360, 276, '熵蚀编织者的 H3 r2v 生成结果（动图）', 'gif');
        img(s, 'game/public/assets/enemies/e11.webp', 856, 222, 368, 276, '熵蚀编织者实际使用的左右两向动作图集');
        txt(s, '基本体搭出八条腿与线轴\n五类动作，分别渲染左右两向', 56, 510, 360, 87, 23);
        txt(s, '设定图决定外观\n参考片段约束姿势、节奏与位移', 456, 510, 360, 87, 23);
        txt(s, '同一攻击视频拆出\n准备、命中与收势，再打包图集', 856, 510, 368, 87, 23);
        txt(s, '换成适合体型的参考模型，后续仍复用生成、抠图和图集接入流程。', 56, 626, 1168, 44, 24, C.gold);
        notes(s, '以已经接入游戏的 E11 熵蚀编织者为例。它是腹部带线轴的机械蜘蛛，参考模型用方块、圆柱和多面体搭出八条腿、躯干与线轴，通过程序定义抬起前足、抽紧细线、甩出与回落等动作。普通非人形敌人准备待机、移动、攻击、受击、死亡五类动作，每类分别渲染左右两向参考，再结合设定图与定位图，经 H3 r2v 生成角色视频。前两格演示同一条左向攻击的基本体参考与生成帧；第三格是游戏实际使用的图集。绿幕抠图后，从同一攻击视频切出准备、攻击和收势，以保持动作衔接，再按 8 FPS 的运行时节奏打包图集与动作元数据，写入 enemies.json。E11 的运行时数据包含左右两向，除了待机、移动、准备、攻击、收势、受击和死亡，还有牵线状态。这里展示现有素材，参考模型不进入最终游戏。', 'docs/Road_to_AGI_游戏设定与美术制作规范.md 的 E11 设定及第 8.10、11 节；tools/reference3d/creatures.py 的 SPIDER；tools/reference3d/build_creature.py；tools/pack_enemies.py 的 PICKS 与 SPECIALS；game/public/assets/enemies.json 的 e11；game/public/assets/enemies/e11.webp；参考帧与生成帧来源见 docs/presentations/assets.json。');
        break;
      case 16:
        s = base(16, '动画质量取决于对齐与校验');
        asset(s, 'keyposes', 56, 152, 534, 514, '主角八方向关键姿势表');
        para(s, '起始姿势与脚底要对齐', '站位差会导致开头滑向人偶，\n定位图姿势也会影响持剑方向。', 638, 154, 586, 90);
        para(s, '动作要覆盖全部方向', '用共同枢纽姿势进入与离开动作，\n每个方向单独检查，不靠镜像替代。', 638, 326, 586, 90);
        para(s, '动画与战斗规则共用时间点', '8 FPS 取动作峰值。\n命中帧、可取消帧与代码一致。', 638, 498, 586, 91);
        notes(s, '这部分是管线最值得讲的具体经验。项目记录指出第一张定位图会强烈影响尺寸、站位和持剑姿势，跑动开始时没有从共同姿势过渡，会让某些方向继续沿用错误持剑姿态。最终验收要检查全部方向、角色尺度、鞋底和剑尖。8 FPS 的动画应该挑姿势峰值，而不能只均匀抽帧；画面的接触点必须与战斗判定同步。', 'game/README.md 的 H3 参数与定位图经验；tools/fit_pose.py；tools/reference3d/actions.py；tools/pack-r2v.mjs；tools/validate-art.mjs；game/src/game/simulation.ts。');
        break;
      case 17:
        s = base(17, '现在还有哪些不足');
        table(s, [
          ['方面', '当前基础', '下一步建议'],
          ['音效', '已有战斗合成音效', '强化力度层次、技能辨识与混音'],
          ['操作手感', '已有缓冲、取消、软锁和顿帧', '围绕键鼠、手柄、触屏分别试玩调参'],
          ['多武器', '目前围绕刺剑与三类改造', '先验证一把动作差异明显的新武器'],
          ['卡牌构筑', '已有分支升级与伙伴组合', '增加改变战斗节奏的流派与联动'],
          ['更多模型角色', '目前有九位召唤伙伴', '沿用角色定位、卡牌规则与素材规范'],
        ], [176, 440, 552], 150, 468, 23);
        txt(s, '建议先完善音效与手感，再扩大武器、构筑和角色内容。', 56, 641, 1120, 37, 25, C.gold);
        notes(s, '五个方向全部来自作者的不足清单。这里补充当前基础，避免把已完成的系统误写为尚未存在。“更全的模型支持”按本项目语境整理为更多模型角色与召唤伙伴。先手感和音效、再扩大内容是结合依赖关系给出的建议，不是已经确定的开发排期，也没有估算工期。', '作者制作复盘第 9 点；game/src/game/sfx.ts；game/src/game/simulation.ts；game/src/game/rewards.ts；game/src/game/cards.ts。');
        break;
      case 18:
        s = base(18, '制作成本花在玩家反复感知的地方');
        table(s, [
          ['想保留的体验', '当前资源做法', '得到什么，付出什么'],
          ['主角动作的连续感', '主角八向，敌人按重要性分档', '集中打磨主角，其他单位朝向更粗'],
          ['伙伴的角色辨识', '卡面、半屏立绘与技能特效', '角色可扩充，完整操作自由度更少'],
          ['房间的空间关系', '固定相机与模块化低模场景', '支持机关和走位，镜头自由度更少'],
          ['大招的冲击力', '法象立绘、巨拳图与程序动效', '保留演出重点，减少逐帧动画需求'],
        ], [246, 428, 494], 158, 430, 23);
        txt(s, '让玩法要求与素材能力互相适配，是这次项目最重要的取舍。', 56, 621, 1168, 44, 28, C.gold);
        notes(s, '这里讨论相对制作负担，没有项目工时或费用记录，因此不虚构节省比例。单主角、召唤卡、固定镜头和分档朝向彼此配合：持续操作的地方投入完整动作，短时出场的角色用立绘与效果，空间玩法交给模块化场景，大招用静态素材加运行时运动。每个选择同时带来收益和边界。', '作者制作复盘第 8 点；game/README.md；游戏设定第 2、3.3、4 节；tools/pack-r2v.mjs；tools/scene/build_region.py。');
        break;
      case 19:
        s = base(19, '收获：这次留下的三条判断');
        txt(s, '玩法、表现和制作管线\n需要一起设计', 56, 159, 1168, 158, 55, C.gold, true);
        para(s, '先让战斗循环成立', '把操作、资源消耗和奖励\n串成可重复体验的流程', 56, 429, 348, 119);
        para(s, '把素材用在关键体验上', '主角动作、伙伴登场与大招\n分别采用适合它们的做法', 456, 429, 348, 119);
        para(s, '扩展要有可复用的规则', '新增武器、卡牌和角色时，\n沿用明确的产线与接入规范', 856, 429, 368, 119);
        notes(s, '收尾回到作者的核心命题：平衡玩法和制作成本，发挥现有工具与资源的长处。这个项目的经验在于，让完整的战斗循环、角色表现形式和生产管线互相约束。后续扩展仍然应该先问新增内容如何改变玩家的选择，再决定需要生产多少素材。', '作者制作复盘第 8、9 点；前述项目实现与资源管线的综合归纳。');
        break;
    }
  }
  return { authored: [first, last], totalSlides: presentation.slides.items.length };
}
