"""Draw the web layout mock-ups as editable SVG: python tools/ui_mocks.py
Writes art/ui/*.svg for the phone HUD at both sizes, touch casting, the landscape and portrait rules, the loading and recovery screens and the awakening gauge. Sizes are CSS pixels and touch targets start at 48 (spec section 2).
"""
import os

OUT = 'art/ui'
BG, LINE, INK, ACCENT, WARN, DIM = '#0f1a26', '#a9d3e6', '#e8f2f8', '#6fd0e0', '#ff6a3d', '#4a5a6c'


def rect(x, y, w, h, label='', stroke=LINE, fill='none', r=6, size=12):
    text = f'<text x="{x + w / 2}" y="{y + h / 2}" fill="{INK}" font-family="Segoe UI,Microsoft YaHei,sans-serif" font-size="{size}" text-anchor="middle" dominant-baseline="central">{label}</text>' if label else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>{text}'


def circle(x, y, radius, label='', stroke=LINE, fill='none', size=12):
    text = f'<text x="{x}" y="{y}" fill="{INK}" font-family="Segoe UI,Microsoft YaHei,sans-serif" font-size="{size}" text-anchor="middle" dominant-baseline="central">{label}</text>' if label else ''
    return f'<circle cx="{x}" cy="{y}" r="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>{text}'


def note(x, y, text, fill=DIM, size=12, anchor='start'):
    return f'<text x="{x}" y="{y}" fill="{fill}" font-family="Segoe UI,Microsoft YaHei,sans-serif" font-size="{size}" text-anchor="{anchor}">{text}</text>'


def page(w, h, inner):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"><rect width="{w}" height="{h}" fill="{BG}"/>{inner}</svg>\n'


def phone_hud(w, h):
    safe = 28
    parts = [rect(safe, 6, w - safe * 2, h - 12, stroke=DIM, r=2), note(safe + 6, h - 12, f'安全区：左右各 {safe}，手势条和刘海不压按钮')]
    parts += [rect(safe + 8, 12, 190, 16, '生命 100', stroke='#ff6b6b', r=8, size=10), rect(safe + 8, 32, 150, 12, 'Token 60', stroke='#3dd6c8', r=6, size=9), rect(safe + 8, 48, 120, 10, '觉醒', stroke='#6fb7ff', r=5, size=8), circle(w - safe - 22, 26, 18, '暂停', size=10)]
    stick_y, right = h - 92, w - safe
    parts += [circle(safe + 88, stick_y, 62, '移动摇杆'), circle(safe + 88, stick_y, 24, fill='#20364d')]
    parts += [circle(right - 72, h - 84, 56, '攻击瞄准区', stroke=ACCENT), circle(right - 168, h - 54, 30, '滑步'), circle(right - 72, h - 182, 30, '大招', stroke='#6fb7ff'), circle(right - 168, h - 136, 24, '交互', size=10)]
    mid = w / 2
    for i in range(3):
        parts.append(rect(mid - 118 + i * 82, h - 92, 72, 84, f'卡 {i + 1}', stroke=ACCENT))
    parts.append(note(mid, 20, f'{w} × {h}', fill=INK, anchor='middle'))
    return page(w, h, ''.join(parts))


def cast_preview():
    w, h = 844, 390
    parts = [rect(300, 298, 72, 84, '卡牌', stroke=ACCENT), f'<path d="M336 298 C340 220 400 170 470 150" fill="none" stroke="{ACCENT}" stroke-width="3" stroke-dasharray="8 6"/>']
    parts += [f'<path d="M458 138 L482 146 L464 164 Z" fill="{ACCENT}"/>', note(500, 140, '只决定方向，没有落点'), note(400, 280, '点按：用当前瞄准范围内的智能目标'), note(400, 300, '拖动：决定方向，松手释放')]
    parts += [note(300, 400 - 12, '拖回卡牌上取消，不扣费')]
    parts += [circle(610, 215, 30, stroke=DIM), f'<path d="M592 197 L628 233 M628 197 L592 233" stroke="#8a93a0" stroke-width="4"/>', note(610, 266, '目标无效：变灰并加叉号，不扣费', anchor='middle')]
    return page(w, h, ''.join(parts))


def orientation():
    w, h = 844, 460
    parts = [rect(20, 40, 400, 190, '横屏：战斗'), note(20, 30, '手机以横屏战斗为基准', fill=INK), rect(480, 40, 150, 320, '竖屏：只能进菜单', size=11), note(480, 30, '竖屏', fill=INK), rect(650, 120, 170, 120, '请把手机横过来\n', stroke=ACCENT), note(652, 262, '进入战斗时提示旋转，并暂停')]
    parts += [note(20, 262, '切到后台、失焦、手柄断开或旋转时：暂停战斗并清除按下状态'), note(20, 282, '浏览器地址栏显隐时：按新的可视高度重新布局，不跳动'), note(20, 302, '验证尺寸：844×390、960×540，以及刘海和手势条')]
    return page(w, h, ''.join(parts))


def loading():
    w, h = 844, 300
    parts = []
    states = [('首次加载', '只下载据点和教学战斗', '进度条 + 当前文件组'), ('分区加载', '进入下一大区前按需下载', '可重试，弱网显示剩余大小'), ('轻触以开启声音', '浏览器要求首次交互', '不挡战斗，可跳过'), ('图形恢复', '设备丢失时自动重建', '暂停并提示，恢复后继续'), ('手柄重新连接', '断开时暂停', '连上后按任意键继续')]
    for i, (title, line, sub) in enumerate(states):
        x = 16 + i * 165
        parts += [rect(x, 40, 150, 200, stroke=ACCENT if i == 0 else LINE), note(x + 75, 74, title, fill=INK, size=14, anchor='middle'), note(x + 75, 120, line, size=10, anchor='middle'), note(x + 75, 142, sub, size=10, anchor='middle'), rect(x + 16, 190, 118, 10, stroke=DIM, r=5)]
    parts.append(note(16, 26, '加载和恢复界面', fill=INK, size=14))
    return page(w, h, ''.join(parts))


def awaken():
    w, h = 844, 200
    parts = [note(16, 26, '觉醒槽，HUD 独立层', fill=INK, size=14)]
    for i, (fill, label, state) in enumerate(((.25, '蓄积中', LINE), (.75, '蓄积中', LINE), (1, '已满：常亮描边和按钮外环，不闪全屏，不挡战场', '#6fb7ff'))):
        y = 44 + i * 48
        parts += [rect(16, y, 300, 18, stroke=state, r=9), f'<rect x="18" y="{y + 2}" width="{296 * fill}" height="14" rx="7" fill="#6fb7ff" opacity=".7"/>', note(330, y + 14, label, fill=INK if fill == 1 else DIM)]
    return page(w, h, ''.join(parts))


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, content in (('phone-hud-844x390', phone_hud(844, 390)), ('phone-hud-960x540', phone_hud(960, 540)), ('touch-cast', cast_preview()), ('orientation', orientation()), ('loading-recovery', loading()), ('awaken-gauge', awaken())):
        with open(f'{OUT}/{name}.svg', 'w', encoding='utf8', newline='\n') as fh:
            fh.write(content)
    print('mock-ups written')


main()
