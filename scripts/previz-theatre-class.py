#!/usr/bin/env python3
"""
Previz «Театральный класс» — настоящий 3D-превиз без Blender (software render).

Итеративная практика: этот скрипт — черновик геометрии и камер для сборки
«Театральный класс» во Blender (см. docs/cinema-fmv.md, docs/studio-hybrid.md).
Он же — текущий «полноценный 3D-снимок» вместо AI-референсов: одна и та же
геометрия рендерится со всех камер (A — анфас по линии глаз, B — три четверти,
D — высокая 45°), чтобы владелец видел пространство, а не «фотографию коробки».

Запуск: .venv-3d/bin/python scripts/previz-theatre-class.py
Рендеры: design/3d/preview/previz-class-*.png
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'design' / '3d' / 'preview'
OUT.mkdir(parents=True, exist_ok=True)

# ---------- палитра «мягкий объём» + тёмный кабинет ----------
INK        = np.array([0x24, 0x1D, 0x31], dtype=float)   # чернила
CHARCOAL   = np.array([0x2E, 0x26, 0x3E], dtype=float)   # тёмные стены «чёрного кабинета»
CHARCOAL2  = np.array([0x3A, 0x30, 0x4C], dtype=float)   # стены чуть светлее
PAPER      = np.array([0xFD, 0xF4, 0xE9], dtype=float)   # бумага
WOOD       = np.array([0x6B, 0x46, 0x2A], dtype=float)   # паркет
WOOD_HI    = np.array([0x8A, 0x5D, 0x3B], dtype=float)
STAGE_WOOD = np.array([0x59, 0x3A, 0x22], dtype=float)
CHERRY     = np.array([0x5E, 0x1F, 0x28], dtype=float)   # вишнёвый бархат
CHERRY_HI  = np.array([0x8E, 0x35, 0x40], dtype=float)
BRASS      = np.array([0xB9, 0x8A, 0x4E], dtype=float)   # латунь
AMBER      = np.array([0xF2, 0xB5, 0x44], dtype=float)   # янтарь
TEAL       = np.array([0x2E, 0x9E, 0x80], dtype=float)   # акцент Миры

SS = 2  # суперсэмплинг

# ---------- примитивы ----------

def box(center, size, color, rotz=0.0):
    cx, cy, cz = center
    sx, sy, sz = size
    x0, y0, z0 = cx - sx / 2, cy - sy / 2, cz - sz / 2
    x1, y1, z1 = cx + sx / 2, cy + sy / 2, cz + sz / 2
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    if rotz:
        c, s_ = math.cos(rotz), math.sin(rotz)
        v = [(cx + (x - cx) * c - (y - cy) * s_, cy + (x - cx) * s_ + (y - cy) * c, z) for (x, y, z) in v]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (0, 4, 7, 3), (1, 2, 6, 5)]
    tris = []
    for quad in f:
        q = [v[i] for i in quad]
        tris.append((q[0], q[1], q[2], color))
        tris.append((q[0], q[2], q[3], color))
    return tris


def quad(v0, v1, v2, v3, color):
    return [(v0, v1, v2, color), (v0, v2, v3, color)]


def curtain(x_from, x_to, y_top, y_bottom, z, color, folds=7, amp=0.10, seed=7):
    rng = np.random.default_rng(seed)
    nx, ny = 26, 8
    grid = []
    for j in range(ny + 1):
        row = []
        y = y_top + (y_bottom - y_top) * j / ny
        sway = (j / ny) * 0.12  # снизу занавес откланяется чуть сильнее
        for i in range(nx + 1):
            x = x_from + (x_to - x_from) * i / nx
            u = i / nx
            zz = z + amp * math.sin(u * folds * math.pi * 2 + seed) * (0.6 + 0.4 * math.sin(j / ny * math.pi)) + sway
            row.append((x, y, zz))
        grid.append(row)
    tris = []
    for j in range(ny):
        for i in range(nx):
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            tint = 1.0 + 0.22 * math.sin((i / nx) * folds * math.pi * 2 + seed)
            col = tuple(np.clip(color * tint, 0, 255))
            tris.append((a, b, c, col))
            tris.append((a, c, d, col))
    return tris


def arch(cx, cz, col_top_y, width, arc_radius, thick, color):
    """Просцениум: две колонны до col_top_y + дуга радиуса arc_radius над ними."""
    tris = []
    col_h = col_top_y - STAGE_H
    tris += box((cx - width / 2, STAGE_H + col_h / 2, cz), (thick * 1.15, col_h, thick * 1.15), color)
    tris += box((cx + width / 2, STAGE_H + col_h / 2, cz), (thick * 1.15, col_h, thick * 1.15), color)
    r = arc_radius
    segments = 18
    for i in range(segments):
        a0 = math.pi * i / segments
        a1 = math.pi * (i + 1) / segments
        am = (a0 + a1) / 2
        seg_len = 2 * r * math.sin((a1 - a0) / 2) * 1.18
        px = cx + r * math.cos(am)
        py = col_top_y + r * math.sin(am)
        tris += box((px, py, cz), (seg_len + 0.06, thick, thick), color, rotz=am + math.pi / 2)
    return tris


def cylinder(center, radius, height, color, axis='y', sides=12):
    cx, cy, cz = center
    tris = []
    if axis == 'y':
        ring = [(cx + radius * math.cos(2 * math.pi * i / sides), cy, cz + radius * math.sin(2 * math.pi * i / sides)) for i in range(sides + 1)]
        for off, y in ((-height / 2, cy - height / 2), (height / 2, cy + height / 2)):
            ring = [(cx + radius * math.cos(2 * math.pi * i / sides), y, cz + radius * math.sin(2 * math.pi * i / sides)) for i in range(sides + 1)]
            for i in range(sides):
                tris.append(((ring[i][0], y, ring[i][2]), (ring[i + 1][0], y, ring[i + 1][2]), (cx, y, cz), color))
        ring_lo = [(cx + radius * math.cos(2 * math.pi * i / sides), cy - height / 2, cz + radius * math.sin(2 * math.pi * i / sides)) for i in range(sides + 1)]
        ring_hi = [(cx + radius * math.cos(2 * math.pi * i / sides), cy + height / 2, cz + radius * math.sin(2 * math.pi * i / sides)) for i in range(sides + 1)]
        for i in range(sides):
            tris.append((ring_lo[i], ring_hi[i], ring_hi[i + 1], color))
            tris.append((ring_lo[i], ring_hi[i + 1], ring_lo[i + 1], color))
    return tris

# ---------- сборка сцены ----------
TRIS = []
W, D, H = 9.0, 11.0, 3.6            # комната
BACK, FRONT = -D / 2, D / 2
STAGE_W, STAGE_D, STAGE_H = 6.4, 2.0, 0.42

# пол: доски «палубной» раскладкой с сдвигом, по тону теплее центра
plank_w, plank_l = 0.62, 1.55
row = 0
z = BACK
while z < FRONT:
    x = BACK_E = -W / 2
    off = (plank_w / 2) if row % 2 else 0.0
    x = -W / 2 - off
    while x < W / 2:
        x0, x1 = x, x + plank_l
        jitter = float(np.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1.0
        tone = WOOD * (0.82 + 0.28 * jitter)
        xa, xb = max(x0, -W / 2), min(x1, W / 2)
        if xb > xa:
            TRIS += quad((xa, 0.0, z), (xb, 0.0, z), (xb, 0.0, z + plank_w), (xa, 0.0, z + plank_w), tuple(tone))
        x += plank_l
    z += plank_w
    row += 1

# стены
TRIS += quad((-W/2, H, BACK), ( W/2, H, BACK), ( W/2, 0, BACK), (-W/2, 0, BACK), tuple(CHARCOAL))   # дальняя
TRIS += quad((-W/2, 0, BACK), (-W/2, 0, FRONT), (-W/2, H, FRONT), (-W/2, H, BACK), tuple(CHARCOAL2)) # левая
TRIS += quad(( W/2, 0, FRONT), ( W/2, 0, BACK), ( W/2, H, BACK), ( W/2, H, FRONT), tuple(CHARCOAL2)) # правая
# потолочные балки-ригель
TRIS += box((0, H - 0.09, -1.2), (W, 0.18, 0.32), tuple(INK))
TRIS += box((0, H - 0.09, -3.4), (W, 0.18, 0.32), tuple(INK))
# плинтусы
TRIS += box((0, 0.06, BACK + 0.03), (W, 0.12, 0.06), tuple(INK))
TRIS += box((-W/2 + 0.03, 0.06, 0), (0.06, 0.12, D), tuple(INK))
TRIS += box(( W/2 - 0.03, 0.06, 0), (0.06, 0.12, D), tuple(INK))
# пилястры на дальней стене + карниз
for sx in (-3.1, 3.1):
    TRIS += box((sx, H / 2, BACK + 0.06), (0.5, H, 0.12), tuple(CHARCOAL2))
TRIS += box((0, H - 0.35, BACK + 0.05), (W, 0.22, 0.10), tuple(BRASS * 0.55))

# мини-сцена и ступени
STAGE_Z = BACK + STAGE_D / 2 + 0.25
TRIS += box((0, STAGE_H / 2, STAGE_Z), (STAGE_W, STAGE_H, STAGE_D), tuple(STAGE_WOOD))
TRIS += box((0, STAGE_H - 0.02, STAGE_Z + STAGE_D / 2 + 0.12), (STAGE_W, 0.045, 0.24), tuple(WOOD_HI))
TRIS += box((0, 0.055, STAGE_Z + STAGE_D / 2 + 0.30), (2.6, 0.11, 0.30), tuple(STAGE_WOOD))
TRIS += box((0, 0.16, STAGE_Z + STAGE_D / 2 + 0.10), (2.6, 0.11, 0.24), tuple(STAGE_WOOD * 1.15))

# занавес (задняя полотна, два отклонённых панно по краям)
CURT_Z = BACK + 0.34
TRIS += curtain(-3.05, 3.05, H - 0.35, STAGE_H + 0.06, CURT_Z, CHERRY, folds=9, amp=0.16, seed=11)
TRIS += curtain(-3.75, -2.15, H - 0.35, STAGE_H + 0.02, CURT_Z + 0.30, CHERRY_HI, folds=4, amp=0.22, seed=23)
TRIS += curtain( 2.15,  3.75, H - 0.35, STAGE_H + 0.02, CURT_Z + 0.30, CHERRY_HI, folds=4, amp=0.22, seed=29)

# просцениум (латунная арка) — акцент над сценой
TRIS += arch(0, BACK + 0.55, STAGE_H + 1.18, 3.7, 1.85, 0.20, tuple(BRASS * 0.85))

# ряд рампы (янтарь) вплотную к авансцене
for i in range(7):
    x = -2.7 + i * 0.9
    TRIS += cylinder((x, STAGE_H + 0.055, STAGE_Z + STAGE_D / 2 + 0.02), 0.055, 0.11, tuple(AMBER), axis='y', sides=10)

# софтовые прожекторы на балках (цилиндры вниз)
for x, z, tilt in ((-1.9, -1.2, -0.35), (0.0, -3.4, 0.0), (1.9, -1.2, 0.35)):
    TRIS += cylinder((x, H - 0.34, z), 0.16, 0.42, tuple(INK), axis='y', sides=12)

# торшер с бумажным абажуром справа (практический тёплый источник)
TRIS += cylinder((3.55, 0.62, 0.6), 0.035, 1.24, tuple(BRASS * 0.6), axis='y', sides=10)
cylinder_tris = cylinder((3.55, 1.38, 0.6), 0.24, 0.34, tuple(PAPER * 0.96), axis='y', sides=14)
TRIS += cylinder_tris

# ковёр — акцент Миры (тихий, насыщенный) перед сценой
rug_pts = [(-1.25, 0.012, -1.25), (1.25, 0.012, -1.25), (1.6, 0.012, -2.95), (-1.6, 0.012, -2.95)]
TRIS += quad(rug_pts[0], rug_pts[1], rug_pts[2], rug_pts[3], tuple(TEAL * 0.42))

# ---------- камеры ----------
CAMERAS = {
    'A':  dict(pos=np.array([0.0, 1.30, 4.9]),  tgt=np.array([0.0, 1.05, -3.0]), w=1280, h=720),
    'B':  dict(pos=np.array([-3.35, 1.65, 3.0]), tgt=np.array([0.1, 0.9, -3.4]), w=1280, h=720),
    'D':  dict(pos=np.array([3.0, 3.15, 2.0]),  tgt=np.array([-0.3, 0.5, -4.0]), w=1280, h=720),
    'Av': dict(pos=np.array([0.0, 1.30, 5.4]),  tgt=np.array([0.0, 1.15, -3.0]), w=540, h=960),
}
FOCAL = 1.15  # ~35mm-эквивалент на 36mm матрице в относительных единицах

# источники света (dir, цвет, сила)
LIGHTS = [
    (np.array([-0.55, 1.0, 0.75]), PAPER * 1.05, 1.05),   # ключевой сверху-слева-спереди
    (np.array([0.7, 0.55, -0.6]), AMBER * 0.9, 0.55),     # тёплое заполнение от сцены/рампы
    (np.array([0.0, 1.0, -0.2]), PAPER * 0.55, 0.5),      # верхний рассеянный
]
AMBIENT = 0.34


def shade(n, base):
    col = base * AMBIENT
    for direction, color, power in LIGHTS:
        d = direction / (np.linalg.norm(direction) + 1e-9)
        ndotl = max(0.0, float(np.dot(n, d)))
        col = col + base * (color / 255.0) * power * ndotl
    return tuple(int(np.clip(c, 0, 255)) for c in col)


def main():
    for name, cam in CAMERAS.items():
        render(name, cam)
    print(f'Готово: {len(CAMERAS)} кадров в {OUT}')


def camera_basis(pos, tgt):
    forward = tgt - pos
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, np.array([0.0, 1.0, 0.0]))
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    return forward, right, up


def project(point, cam):
    forward, right, up = camera_basis(cam['pos'], cam['tgt'])
    rel = point - cam['pos']
    z = float(np.dot(rel, forward))
    x = float(np.dot(rel, right))
    y = float(np.dot(rel, up))
    sx = FOCAL * x / max(z, 1e-6)
    sy = FOCAL * y / max(z, 1e-6)
    px = (0.5 + sx * 0.78) * cam['w']
    py = (0.5 - sy * 0.78) * cam['h']
    return np.array([px, py]), z


NEAR = 0.08


def clip_near(p0, p1, p2, z0, z1, z2):
    """Отсечение треугольника плоскостью z=NEAR в камерном пространстве."""
    pts = [np.array(p0), np.array(p1), np.array(p2)]
    zs = [z0, z1, z2]
    out = []
    for i in range(3):
        cur, curz = pts[i], zs[i]
        nxt, nxtz = pts[(i + 1) % 3], zs[(i + 1) % 3]
        if curz >= NEAR:
            out.append((cur, curz))
        if (curz >= NEAR) != (nxtz >= NEAR):
            t = (NEAR - curz) / (nxtz - curz)
            out.append((cur + t * (nxt - cur), NEAR))
    if len(out) < 3:
        return None
    return out


def render(name, cam):
    w, h = cam['w'] * SS, cam['h'] * SS
    cam2 = dict(cam)
    cam2['w'], cam2['h'] = w, h
    forward, right, up = camera_basis(cam['pos'], cam['tgt'])
    items = []
    for a, b, c, color in TRIS:
        pa, pb, pc = map(np.array, (a, b, c))
        ra, rb, rc = pa - cam['pos'], pb - cam['pos'], pc - cam['pos']
        za, zb, zc = (float(np.dot(ra, forward)), float(np.dot(rb, forward)), float(np.dot(rc, forward)))
        n = np.cross(pb - pa, pc - pa)
        nl = np.linalg.norm(n)
        if nl < 1e-9:
            continue
        n /= nl
        cam_vec = cam['pos'] - pa
        if float(np.dot(n, cam_vec)) < 0:
            n = -n
        clipped = clip_near(pa, pb, pc, za, zb, zc)
        if clipped is None:
            continue
        # впуклые за NEAR — доорезать до одного треугольника (веер из 3 или 4 точек)
        pts, pts_z = zip(*clipped)
        if len(pts) == 4:
            faces = [(0, 1, 2), (0, 2, 3)]
        else:
            faces = [(0, 1, 2)]
        base = np.array(color, dtype=float)
        shade_col = shade(n, base)
        for fi in faces:
            tri = [pts[i] for i in fi]
            zs = [pts_z[i] for i in fi]
            proj = []
            ok = True
            for p, zz in zip(tri, zs):
                rel = p - cam['pos']
                x = float(np.dot(rel, right))
                y = float(np.dot(rel, up))
                sx = FOCAL * x / max(zz, 1e-6)
                sy = FOCAL * y / max(zz, 1e-6)
                proj.append(((0.5 + sx * 0.78) * w, (0.5 - sy * 0.78) * h))
            depth = sum(zs) / len(zs)
            items.append((depth, proj, shade_col))

    img = Image.new('RGB', (w, h), tuple(int(c) for c in (INK * 0.55)))
    draw = ImageDraw.Draw(img)
    items.sort(key=lambda it: -it[0])
    for _, poly, col in items:
        draw.polygon(poly, fill=col)

    # свечение рампы: аддитивные янтарные пятна + пул света на полу
    glow = Image.new('RGB', (w, h), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(7):
        x = -2.7 + i * 0.9
        p, zpos = project(np.array([x, STAGE_H + 0.12, STAGE_Z + STAGE_D / 2]), cam2)
        if zpos > NEAR:
            r = 26 * SS * (FOCAL / max(zpos, 0.5))
            gd.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(120, 90, 30))
    img = Image.blend(img, Image.composite(Image.new('RGB', (w, h), (255, 214, 140)), img, glow.convert('L').point(lambda v: v // 2)), 0.35)

    # мягкая виньетка
    vignette = Image.new('L', (w, h), 0)
    vd = ImageDraw.Draw(vignette)
    vd.ellipse([-w * 0.25, -h * 0.25, w * 1.25, h * 1.25], fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(radius=w / 6))
    img = Image.composite(img, Image.new('RGB', (w, h), (10, 8, 16)), vignette)

    img = img.resize((cam['w'], cam['h']), Image.LANCZOS)
    img.save(OUT / f'previz-class-{name}.png')


if __name__ == '__main__':
    main()
