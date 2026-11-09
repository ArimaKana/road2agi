/**
 * 19-slide video retrospective, synchronized with road2agi-video-script-v1.txt.
 * Import loadScriptScenes() locally, then pass its result as input.scenes to
 * artifactSession.run(authorRetrospective, { artifactRef, input }).
 * Use mode: 'update' to retain the existing slides and reuse text/image objects.
 * The one-time reorderFromOriginal flag migrates the pre-2026-11-09 outline.
 * Author or update in small, sequential fromSlide/toSlide batches.
 */
export const slideCount = 19;

export async function loadScriptScenes(root = 'D:/workspace/road2agi') {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(`${root}/docs/presentations/road2agi-video-script-v1.txt`, 'utf8');
  const scenes = [...source.matchAll(/【(\d+)｜P(\d+)｜([^】]+)】\s*口播：\s*([\s\S]*?)\s*分镜：\s*([\s\S]*?)\s*素材：([^\n]+)/g)]
    .map((m) => ({ number: Number(m[1]), slide: Number(m[2]), title: m[3], narration: m[4].trim(), shots: m[5].trim(), sources: m[6].trim() }));
  if (scenes.length !== slideCount || scenes.some((s, i) => s.number !== i + 1 || s.slide !== i + 1)) {
    throw new Error('Expected 19 sequential script scenes with matching PPT page numbers');
  }
  return scenes;
}

export async function authorRetrospective({ presentation, input = {} }) {
  const root = (input.root ?? 'D:/workspace/road2agi').replaceAll('\\', '/');
  const first = input.fromSlide ?? 1, last = input.toSlide ?? 19;
  const update = input.mode === 'update';
  const scenes = input.scenes;
  if (first < 1 || last > 19 || first > last) throw new Error('Invalid slide range');
  if (!Array.isArray(scenes) || scenes.length !== 19) throw new Error('Pass the latest loadScriptScenes() result as input.scenes');
  if (update && presentation.slides.items.length !== 19) throw new Error('Update expects the existing 19-slide deck');
  if (!update && presentation.slides.items.length !== first - 1) throw new Error(`Expected ${first - 1} existing slides`);
  if (input.reorderFromOriginal) {
    if (!update || first !== 1 || !presentation.slides.items[1].shapes.items.some(s => s.text.toString() === '目录')) {
      throw new Error('Legacy reorder only applies to the original deck, once');
    }
    const ids = presentation.slides.items.map(s => s.toSnapshot().aid);
    presentation.slides.reorder([1, 3, 2, 5, 9, 6, 7, 4, 11, 8, 10, 12, 13, 14, 15, 16, 17, 18, 19].map(n => ids[n - 1]));
  }
  const C = { bg: '#08182D', text: '#EDF2F7', muted: '#ADC1D4', gold: '#F0D59A', blue: '#15324C', border: '#304B63' };
  const font = 'Microsoft YaHei';
  let currentNumber, owned;
  const txt = (s, value, x, y, w, h, size = 26, color = C.text, bold = false) => {
    const position = { left: x, top: y, width: w, height: h };
    const t = owned.shapes.shift() ?? s.shapes.add({ geometry: 'textbox', position, fill: 'none', line: { fill: 'none', width: 0 } });
    t.position = position;
    t.name = value.slice(0, 40);
    // Replace runs, so a reused textbox cannot retain a link from the old copy.
    t.text = value.split('\n').map(run => ({ runs: [{ run, style: { underline: 'none' } }] }));
    t.text.style = { typeface: font, fontSize: size, color, bold, insets: 0, autoFit: 'none', wrap: 'square', verticalAlignment: 'top' };
    return t;
  };
  const img = (s, source, x, y, w, h, alt) => {
    const options = { path: `${root}/${source}`, position: { left: x, top: y, width: w, height: h }, fit: 'contain', alt };
    const existing = owned.images.shift();
    if (!existing) return s.images.add(options);
    // During this migration the unchanged image files can keep their cloud assets.
    // Omit reuseImages when regenerating a source file under the same alt text.
    if (!input.reuseImages || existing.alt !== alt) existing.replace(options);
    existing.position = options.position;
    existing.fit = 'contain';
    return existing;
  };
  const asset = (s, name, x, y, w, h, alt = name, ext = 'webp') => img(s, `docs/presentations/assets/${name}.${ext}`, x, y, w, h, alt);
  const link = (s, label, url, x, y, w, size = 20) => {
    const t = txt(s, label, x, y, w, 34, size, C.muted);
    t.text.get(label).link = { uri: url, isExternal: true };
    return t;
  };
  const notes = (s, sources) => {
    const scene = scenes[currentNumber - 1];
    s.speakerNotes.text = `${scene.narration}\n\n来源与素材：\n${scene.sources}\n${sources}\n\n口播源：docs/presentations/road2agi-video-script-v1.txt，第 ${scene.number} 段（2026-11-09）。游戏行为按当前 game/README.md、cards.ts 与相关实现核对。`;
  };
  const createSlide = () => {
    const s = update ? presentation.slides.items[currentNumber - 1] : presentation.slides.add({ width: 1280, height: 720 });
    owned = { shapes: [...s.shapes.items], images: [...s.images.items], tables: [...s.tables.items] };
    return s;
  };
  const base = (number, title) => {
    const s = createSlide(); s.background.fill = C.bg;
    txt(s, title, 56, 42, 1168, 82, 42, C.text, true);
    txt(s, String(number).padStart(2, '0'), 1192, 679, 40, 24, 15, C.muted);
    return s;
  };
  const para = (s, heading, body, x, y, w, bodyHeight = 76) => {
    txt(s, heading, x, y, w, 44, 28, C.gold, true);
    txt(s, body, x, y + 49, w, bodyHeight, 24, C.text);
  };
  const table = (s, values, widths, y = 157, h = 430, size = 23, x = 56) => {
    const previous = owned.tables.shift();
    if (previous) presentation.delete(previous.toSnapshot().aid);
    const t = s.tables.add({ rows: values.length, columns: values[0].length, left: x, top: y, width: widths.reduce((a, b) => a + b, 0), height: h, columnWidths: widths, values });
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
    currentNumber = n;
    let s;
    switch (n) {
      case 1:
        s = createSlide(); s.background.fill = C.bg;
        img(s, 'art/Road_to_AGI_横版海报.png', 0, 0, 1280, 720, 'Road to AGI 项目海报');
        txt(s, '游戏制作复盘', 46, 30, 490, 70, 48, C.gold, true);
        txt(s, '从大肥鱼的短视频，到自己的动作肉鸽', 48, 104, 760, 64, 25);
        notes(s, '灵感视频：https://www.bilibili.com/video/BV164nS68EwU/；作者 @大运的奇妙冒险：https://space.bilibili.com/zh-Hans/3546715219036947。');
        break;
      case 2:
        s = base(2, 'Road to AGI：单人动作肉鸽');
        para(s, 'DeepSeek 刺剑近战', '攻击积累 Token，\n再召唤伙伴释放技能', 56, 164, 338);
        para(s, '9 位召唤伙伴', '最多装备 3 张卡，\n安排控制、支援与爆发', 56, 321, 338);
        para(s, '4 个大区，28 间房', '4 位 Boss，另有无尽试炼\n键鼠、手柄与手机横屏', 56, 478, 338);
        asset(s, 'combat', 420, 155, 804, 452, '缓存废港战斗实机');
        link(s, '源码 github.com/ArimaKana/road2agi', 'https://github.com/ArimaKana/road2agi', 420, 628, 804, 24);
        notes(s, 'game/README.md；game/src/game/cards.ts；game/src/game/level.ts。');
        break;
      case 3:
        s = base(3, '角色设定的起点：ai-chan-sheets');
        asset(s, 'ai-chan-sheets-page', 56, 153, 760, 428, 'ai-chan-sheets GitHub 仓库首页实拍，2026-11-09', 'jpg');
        para(s, '已有参考', '三视图、表情、服装和道具\n帮助统一角色外观', 856, 160, 368, 100);
        para(s, '原始角色形象', '本作使用的形象主要来自\nZipZipPipe（胖次狐）', 856, 322, 368, 100);
        para(s, '本作补充', '游戏身份、武器与技能\n角色如何参与战斗', 856, 484, 368, 100);
        link(s, 'github.com/lmy414/ai-chan-sheets', 'https://github.com/lmy414/ai-chan-sheets', 56, 617, 760, 25);
        notes(s, '来源仓库 README 与逐项署名：https://github.com/lmy414/ai-chan-sheets；截图保留原页面内容，未改动网页。');
        break;
      case 4:
        s = base(4, '多角色游戏与前期阵营构思');
        [['cover-ff-type0', '最终幻想零式'], ['cover-ff-dissidia012', '最终幻想纷争 012'], ['cover-yggdra-union', '公主同盟']].forEach(([cover, label], i) => {
          asset(s, cover, 56 + i * 170, 163, 145, 218, label);
          txt(s, label, 56 + i * 170, 397, 160, 64, 21);
        });
        txt(s, '秩序与混乱的对立感\n引出开源与闭源的阵营联想', 56, 501, 520, 104, 27, C.gold);
        const groups = [
          [['DeepSeek', null], ['GLM', 'glm'], ['Kimi', 'kimi'], ['Qwen', 'qwen'], ['MiniMax', 'minimax']],
          [['Seed', 'seed'], ['GPT', 'gpt'], ['Claude', 'claude'], ['Gemini', 'gemini'], ['Grok', 'grok']],
        ];
        groups.forEach((group, row) => {
          txt(s, row === 0 ? '第一组' : '第二组', 618, 151 + row * 236, 586, 36, 25, C.gold, true);
          group.forEach(([name, id], i) => {
            const x = 618 + i * 121, y = 195 + row * 236;
            const path = id ? `game/public/assets/cards/${id}.webp` : 'game/public/assets/deepseek-figure-v001.webp';
            img(s, path, x, y, 105, 153, `${name} 角色卡面或立绘`);
            txt(s, name, x, y + 160, 110, 32, 20);
          });
        });
        txt(s, '前期角色分组，用于说明创作联想', 618, 646, 586, 32, 21, C.muted);
        notes(s, '阵营为作者的前期创作构思，不是现实模型的授权分类。封面来源及原图地址见 docs/presentations/assets.json。');
        break;
      case 5:
        s = base(5, '一位可操作主角，九位召唤伙伴');
        para(s, '多角色操作的制作负担', '每位角色都要有完整动作，\n还要分别打磨手感与平衡。', 56, 158, 720, 94);
        para(s, '完整操作集中在 DeepSeek', '先把移动、刺剑连招、闪避\n和资源循环做顺。', 56, 330, 720, 94);
        para(s, '伙伴通过召唤卡参与战斗', '用卡面、立绘和技能效果保留特点，\n用费用、冷却与组合形成取舍。', 56, 502, 720, 94);
        asset(s, 'partners', 850, 142, 374, 526, '九位召唤伙伴的正式卡面');
        notes(s, 'game/src/game/cards.ts；game/src/components/CardCutIn.vue；game/README.md。');
        break;
      case 6:
        s = base(6, 'SWOT 与肉鸽玩法的选择');
        const swot = table(s, [
          ['S  优势', 'W  短板'],
          ['善用工具，愿意搭建制作流程\n喜欢琢磨规则与玩法组合\n能够在玩法和素材规模之间做取舍', '编剧经验不足\n动画、导演与演出衔接需要练习\n不适合一开始就铺开大量剧情'],
          ['O  机遇', 'T  挑战'],
          ['已有角色形象与设定参考\nAI 工具帮助尝试代码和素材制作\n角色话题为项目提供创作起点', '同类内容多，需要靠实际体验区分\n许多环节尚未做过\n需要留出学习、试作和返工的空间'],
        ], [584, 584], 150, 446, 25);
        [54, 169, 54, 169].forEach((height, row) => { swot.rows[row].height = height; });
        for (const row of [0, 2]) for (const column of [0, 1]) {
          const cell = swot.getCell(row, column); cell.fill = C.blue;
          cell.text.style = { typeface: font, fontSize: 28, color: C.gold, bold: true, insets: 14, verticalAlignment: 'middle' };
        }
        txt(s, '清楚的基础规则，加上技能、奖励和房间组合，形成玩法变化', 56, 627, 1168, 42, 28, C.gold);
        notes(s, '作者个人 SWOT 自评，按 2026-11-09 视频脚本整理；不包含外部市场统计。');
        break;
      case 7:
        s = base(7, 'DeepSeek 鲸鱼娘与单手刺剑');
        para(s, '冒险的起点', '在“语义之海”苏醒，救出沿途伙伴，\n阻止“归零协议”无差别删除记忆。', 56, 158, 620, 94);
        para(s, '武器与动作灵感', '《最终幻想零式》的 Queen\n《北欧女神：极乐世界》的持剑形象', 56, 324, 620, 94);
        para(s, '单手刺剑“澄潮”', '以直刺、连刺和弓步为主。\n右手持剑，左手展牌召唤。', 56, 490, 620, 94);
        asset(s, 'hero-standing-rapier', 704, 36, 520, 636, 'DeepSeek 鲸鱼娘全身站立持剑图，游戏同风格，透明背景');
        link(s, '形象：ZipZipPipe    设定补全：ai-chan-sheets', 'https://github.com/lmy414/ai-chan-sheets', 56, 648, 644, 18);
        notes(s, '游戏设定文档第 1、3、4 节；武器灵感来自作者本次记录；原始角色形象 ZipZipPipe，设定补全 ai-chan-sheets。');
        break;
      case 8:
        s = base(8, '卡牌召唤与 Token 循环');
        txt(s, '灵感：《王国之心：记忆之链》的卡牌战斗', 56, 124, 1168, 40, 25, C.muted);
        para(s, '01  近身攻击', '主角命中和亲手击杀积累 Token', 56, 195, 440, 56);
        para(s, '02  选择释放时机', '花 Token 召唤伙伴或发动蓄力刺', 56, 338, 440, 56);
        para(s, '03  清房后调整', '通过奖励、升级和换卡改变打法', 56, 481, 440, 56);
        asset(s, 'loop', 522, 185, 702, 395, '刺剑战斗与三卡配置实机');
        txt(s, '主角的动作与伙伴的技能，\n围绕同一份资源相互配合', 522, 604, 702, 72, 27, C.gold);
        notes(s, '游戏灵感来自作者本次记录；本作规则见 game/src/game/cards.ts、simulation.ts、rewards.ts。');
        break;
      case 9:
        s = base(9, '把角色印象做成可用的技能');
        txt(s, '策划整理：DeepSeek Harness + DS 4.1 Flash', 56, 122, 1168, 40, 25, C.muted);
        asset(s, 'gpt-skill', 56, 181, 560, 315, 'GPT 技能施放实机');
        asset(s, 'qwen', 664, 181, 560, 315, 'Qwen 技能施放实机');
        txt(s, 'GPT：重置会话', 56, 520, 560, 42, 30, C.gold, true);
        txt(s, '补满闪避充能，\n刷新另外两张卡的冷却', 56, 576, 560, 86, 26);
        txt(s, 'Qwen：千问无界', 664, 520, 560, 42, 30, C.gold, true);
        txt(s, '获得一次零消耗机会，\n用于蓄力刺或其他召唤卡', 664, 576, 560, 86, 26);
        notes(s, 'game/src/game/cards.ts、summons.ts。Qwen 为 I 级基础效果，零消耗本房间内保留至用完。模型梗与角色印象是创作表达。工具名称按作者 2026-11-09 记录。');
        break;
      case 10:
        s = base(10, '技术方案：角色采用 2D 序列帧');
        txt(s, '最初考虑：3D 追尾、3D 俯视、2D 横版', 56, 127, 1168, 40, 27, C.muted);
        para(s, 'Tripo 图生 3D 试作', '大幅动作中，衣服、身体与武器\n容易出现需要修正的穿模。', 56, 211, 600, 100);
        para(s, '动作越多，修正也越多', '模型起步快，后续还要反复处理\n每个动作里的细节。', 56, 382, 600, 100);
        txt(s, '最后选择：角色用 2D 序列帧', 56, 588, 640, 50, 31, C.gold, true);
        img(s, 'game/public/assets/deepseek-light1-v005.webp', 710, 184, 514, 405, '最终采用的 DeepSeek 轻击图集');
        txt(s, '最终角色图集', 710, 613, 514, 40, 25, C.muted);
        notes(s, 'Tripo 试作与穿模体验来自作者本次记录。图集为当前真实资源，未用示意图冒充早期试作结果。game/README.md。');
        break;
      case 11:
        s = base(11, '固定斜俯视：2D 角色与 3D 房间');
        asset(s, 'environment', 56, 160, 790, 444, '镜像书库的二维角色与三维房间');
        asset(s, 'cover-hades', 900, 154, 264, 264, '《黑帝斯》封面');
        txt(s, '《黑帝斯》带来的视角启发', 880, 436, 344, 72, 26, C.gold, true);
        txt(s, '房间中自由走位\n保留清楚的空间关系\n固定镜头控制素材规模', 880, 527, 344, 123, 25);
        txt(s, '角色用二维动画，房间与机关保留低模 3D', 56, 627, 790, 40, 27, C.gold);
        notes(s, 'game/README.md；game/src/game/engine.ts；作者本次视角选择记录。Hades 封面来源 https://store.steampowered.com/app/1145360/。不声称本作与参考游戏使用相同管线。');
        break;
      case 12:
        s = base(12, '动画方向按表现需要分配');
        table(s, [
          ['对象', '方向', '制作重点'],
          ['主角', '8 向', '持续操作，保证出招与转向'],
          ['精英怪', '4 向', '保留更清楚的朝向变化'],
          ['普通怪与多数 Boss', '2 向', '左右方向分别制作'],
          ['固定朝向物件与演出图', '固定', '按画面需要决定是否转向'],
        ], [300, 126, 390], 172, 380, 24);
        img(s, 'game/public/assets/deepseek-run-v005.webp', 916, 167, 308, 394, '主角八向跑动图集');
        txt(s, '主角八向动作', 916, 581, 308, 40, 25, C.gold);
        txt(s, '房间本身仍是 3D 场景，贴图方向与空间结构分开处理', 56, 633, 1120, 40, 26, C.gold);
        notes(s, 'game/README.md 朝向等级；游戏设定第 2 节。过拟合圣像固定朝镜头。固定物件不代表所有场景物品均由单向渲染制作。');
        break;
      case 13:
        s = base(13, '工具分工与游戏工程');
        table(s, [
          ['环节', '工具', '产出'],
          ['开发', 'Claude + DeepSeek', '玩法、界面与资源处理脚本'],
          ['图片', 'GPT Image', '角色、卡面、场景与特效素材'],
          ['动画', 'MiniMax H3 r2v + ComfyUI', '本地工作流生成角色动作视频'],
          ['音乐', 'Suno', '重混《当然可以好问题》作为 BGM'],
        ], [150, 490, 528], 157, 402, 24);
        txt(s, 'Vue + TypeScript + Three.js\nWebGPU 优先，兼容 WebGL 2', 56, 589, 1168, 77, 28, C.gold);
        notes(s, 'game/package.json；game/README.md；tools/comfy-r2v.mjs。工具名称按作者 2026-11-09 制作记录，未添加未确认的具体版本。');
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
        notes(s, `${xbotUrl}；game/README.md 动画管线；tools/reference3d/build_reference.py；tools/make_h3_refs.py；tools/comfy-r2v.mjs；tools/matte_frames.py；tools/pack-r2v.mjs；assets.json。`);
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
        notes(s, 'docs/Road_to_AGI_游戏设定与美术制作规范.md 的 E11 设定及第 8.10、11 节；tools/reference3d/creatures.py 的 SPIDER；tools/reference3d/build_creature.py；tools/pack_enemies.py 的 PICKS 与 SPECIALS；game/public/assets/enemies.json 的 e11；game/public/assets/enemies/e11.webp；参考帧与生成帧来源见 docs/presentations/assets.json。');
        break;
      case 16:
        s = base(16, '动画质量取决于对齐与校验');
        asset(s, 'keyposes', 56, 152, 534, 514, '主角八方向关键姿势表');
        para(s, '起始姿势与脚底要对齐', '站位差会导致开头滑向人偶，\n定位图姿势也会影响持剑方向。', 638, 154, 586, 90);
        para(s, '动作要覆盖全部方向', '用共同枢纽姿势进入与离开动作，\n每个方向单独检查，不靠镜像替代。', 638, 326, 586, 90);
        para(s, '动画与战斗规则共用时间点', '挑出蓄力、出手、接触与收势。\n命中和可取消时刻与代码一致。', 638, 498, 586, 91);
        notes(s, 'game/README.md 的 H3 参数与定位图经验；tools/fit_pose.py；tools/reference3d/actions.py；tools/pack-r2v.mjs；tools/validate-art.mjs；game/src/game/simulation.ts。');
        break;
      case 17:
        s = base(17, '当前不足与打磨顺序');
        table(s, [
          ['方面', '当前基础', '继续打磨'],
          ['音效', '已有战斗合成音效', '强化力度层次、技能辨识与混音'],
          ['操作手感', '已有缓冲、取消、软锁和顿帧', '围绕键鼠、手柄、触屏分别试玩调参'],
          ['多武器', '目前围绕刺剑与三类改造', '先验证一把动作差异明显的新武器'],
          ['卡牌构筑', '已有分支升级与伙伴组合', '增加改变战斗节奏的流派与联动'],
          ['更多模型角色', '目前有九位召唤伙伴', '沿用角色定位、卡牌规则与素材规范'],
        ], [176, 440, 552], 150, 468, 23);
        txt(s, '先打磨手感与声音，再扩展武器、构筑和角色。', 56, 641, 1120, 37, 25, C.gold);
        notes(s, '作者 2026-11-09 修订脚本第 17 段；game/src/game/sfx.ts；game/src/game/simulation.ts；game/src/game/rewards.ts；game/src/game/cards.ts。');
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
        notes(s, '作者 2026-11-09 修订脚本第 18 段；game/README.md；游戏设定第 2、3.3、4 节；tools/pack-r2v.mjs；tools/scene/build_region.py。');
        break;
      case 19:
        s = base(19, '下一步：新增内容带来什么选择');
        txt(s, '先想清楚新增内容的玩法，\n再决定要制作多少素材', 56, 159, 1168, 158, 52, C.gold, true);
        para(s, '先让战斗循环成立', '把操作、资源消耗和奖励\n串成可重复体验的流程', 56, 429, 348, 119);
        para(s, '把素材用在关键体验上', '主角动作、伙伴登场与大招\n分别采用适合它们的做法', 456, 429, 348, 119);
        para(s, '扩展要有可复用的规则', '新增武器、卡牌和角色时，\n沿用明确的产线与接入规范', 856, 429, 368, 119);
        link(s, '源码 github.com/ArimaKana/road2agi', 'https://github.com/ArimaKana/road2agi', 56, 650, 800, 22);
        notes(s, '作者 2026-11-09 修订脚本第 18、19 段；前述项目实现与资源管线的综合归纳。');
        break;
    }
    const obsolete = [...owned.shapes, ...owned.images, ...owned.tables].map(item => item.toSnapshot().aid);
    if (obsolete.length) presentation.delete(obsolete);
  }
  return { authored: [first, last], totalSlides: presentation.slides.items.length, scriptRevision: '2026-11-09' };
}
