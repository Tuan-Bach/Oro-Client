import os
import math
import numpy as np

def generate_round_svg(size=512, bg_hex="#1c90ed"):
    cx, cy = size / 2.0, size / 2.0
    R_disc = size * 0.455
    scale = R_disc * 0.77
    P = lambda x, y: (cx + x * scale, cy + y * scale)

    svg = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">')

    # 1. Pure solid color circle base (like Docker Desktop)
    svg.append(f'  <circle cx="{cx:.2f}" cy="{cy:.2f}" r="{R_disc:.2f}" fill="{bg_hex}" />')

    w_outer = size * 0.030
    w_spiral = size * 0.026
    c_white = "#ffffff"
    c_ice = "#f0f8ff"

    # 2. Outer Cranial Perimeter (4-lobed continuous boundary)
    cranial_pts = []
    for t in np.linspace(0, 2 * math.pi, 240):
        r = 0.88 * (1.0 + 0.13 * math.cos(4 * t) - 0.025 * math.cos(8 * t))
        cranial_pts.append(P(r * math.cos(t), r * math.sin(t)))
    d_cranial = " ".join([f"{'M' if i == 0 else 'L'} {p[0]:.2f} {p[1]:.2f}" for i, p in enumerate(cranial_pts)]) + " Z"
    svg.append(f'  <path d="{d_cranial}" fill="none" stroke="{c_white}" stroke-width="{w_outer:.2f}" stroke-linecap="round" stroke-linejoin="round" />')

    # 3. 4 Spiral Arms
    for k in range(4):
        ang_k = k * (math.pi / 2.0)
        cos_k = math.cos(ang_k)
        sin_k = math.sin(ang_k)

        def rot(x, y):
            return x * cos_k - y * sin_k, x * sin_k + y * cos_k

        sp_pts = []
        for t in np.linspace(0.12, 1.30 * math.pi, 60):
            r_sp = 0.72 * math.exp(-0.38 * t)
            th = t + 0.18
            lx = r_sp * math.cos(th)
            ly = -r_sp * math.sin(th)
            rx, ry = rot(lx, ly)
            sp_pts.append(P(rx, ry))

        d_sp = " ".join([f"{'M' if i == 0 else 'L'} {p[0]:.2f} {p[1]:.2f}" for i, p in enumerate(sp_pts)])
        svg.append(f'  <path d="{d_sp}" fill="none" stroke="{c_ice}" stroke-width="{w_spiral:.2f}" stroke-linecap="round" stroke-linejoin="round" />')

    # 4. Constellation Nodes
    for k in range(4):
        ang_k = k * (math.pi / 2.0)
        cos_k = math.cos(ang_k)
        sin_k = math.sin(ang_k)

        def rot(x, y):
            return x * cos_k - y * sin_k, x * sin_k + y * cos_k

        # Outer crest node
        r_peak = 0.88 * (1.0 + 0.13 - 0.025)
        nx, ny = P(*rot(0, -r_peak))
        nr = size * 0.030
        nr_in = size * 0.015
        svg.append(f'  <circle cx="{nx:.2f}" cy="{ny:.2f}" r="{nr:.2f}" fill="{c_white}" />')
        svg.append(f'  <circle cx="{nx:.2f}" cy="{ny:.2f}" r="{nr_in:.2f}" fill="{bg_hex}" />')

        # Spiral origin star node
        t_start = 0.12
        r_start = 0.72 * math.exp(-0.38 * t_start)
        th_start = t_start + 0.18
        sx, sy = P(*rot(r_start * math.cos(th_start), -r_start * math.sin(th_start)))
        sr = size * 0.022
        svg.append(f'  <circle cx="{sx:.2f}" cy="{sy:.2f}" r="{sr:.2f}" fill="{c_white}" />')

    # 5. Central 4-point Diamond Star Singularity
    star_r = scale * 0.20
    star_pts = []
    for t in np.linspace(0, 2 * math.pi, 80):
        sx = star_r * (math.cos(t) ** 3)
        sy = star_r * (math.sin(t) ** 3)
        star_pts.append((cx + sx, cy + sy))
    d_star = " ".join([f"{'M' if i == 0 else 'L'} {p[0]:.2f} {p[1]:.2f}" for i, p in enumerate(star_pts)]) + " Z"
    svg.append(f'  <path d="{d_star}" fill="{c_white}" />')

    # Central nucleus
    cn_r = size * 0.025
    cn_in = size * 0.013
    svg.append(f'  <circle cx="{cx:.2f}" cy="{cy:.2f}" r="{cn_r:.2f}" fill="{bg_hex}" />')
    svg.append(f'  <circle cx="{cx:.2f}" cy="{cy:.2f}" r="{cn_in:.2f}" fill="{c_white}" />')

    svg.append('</svg>')
    return "\n".join(svg)

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    svg_content = generate_round_svg(512, bg_hex="#1c90ed")
    svg_path = os.path.join(base_dir, "resources", "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"Saved: {svg_path}")

if __name__ == "__main__":
    main()
