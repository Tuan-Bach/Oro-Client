import math
import os
import struct
from io import BytesIO
import numpy as np
from PIL import Image, ImageDraw

def build_perfect_windows_ico(master_img, sizes=[256, 128, 64, 48, 32, 24, 16]):
    """
    Builds a Windows-standard ICO file compatible with csc.exe, Windows Explorer,
    and all legacy / modern Windows shell versions:
      - 256x256 is saved as PNG-compressed stream (like Docker Desktop)
      - Sub-256 sizes (128, 64, 48, 32, 24, 16) are saved as uncompressed 32bpp DIBs
        with BITMAPINFOHEADER and bottom-up BGRA pixel arrays.
    """
    entries = []
    data_blobs = []
    
    for sz in sizes:
        resized = master_img.resize((sz, sz), Image.Resampling.LANCZOS)
        if sz == 256:
            buf = BytesIO()
            resized.save(buf, format='PNG')
            raw = buf.getvalue()
        else:
            w, h = sz, sz
            # Windows DIB rows are bottom-to-top, BGRA format
            flipped = resized.convert('RGBA').transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            pixel_bytes = flipped.tobytes('raw', 'BGRA')
            
            # 1-bit AND mask (row size padded to 32-bit boundary)
            row_bytes_and = ((w + 31) // 32) * 4
            and_mask = bytearray(row_bytes_and * h)
            
            # BITMAPINFOHEADER (biHeight must be 2 * h for ICO format to account for XOR + AND masks)
            bih = struct.pack(
                '<IIIHHIIIIII',
                40,             # biSize
                w,              # biWidth
                2 * h,          # biHeight
                1,              # biPlanes
                32,             # biBitCount
                0,              # biCompression (BI_RGB)
                len(pixel_bytes) + len(and_mask), # biSizeImage
                0, 0, 0, 0      # XPels, YPels, ClrUsed, ClrImportant
            )
            raw = bytes(bih) + bytes(pixel_bytes) + bytes(and_mask)
            
        data_blobs.append(raw)
        b_w = sz if sz < 256 else 0
        b_h = sz if sz < 256 else 0
        entries.append({
            'w': b_w, 'h': b_h,
            'colors': 0, 'reserved': 0,
            'planes': 1, 'bpp': 32,
            'size': len(raw)
        })
        
    out = BytesIO()
    # ICO Header: 2 reserved, 2 type (1=ICO), 2 count
    out.write(struct.pack('<HHH', 0, 1, len(entries)))
    
    offset = 6 + len(entries) * 16
    for e in entries:
        out.write(struct.pack(
            '<BBBBHHII',
            e['w'], e['h'], e['colors'], e['reserved'],
            e['planes'], e['bpp'], e['size'], offset
        ))
        offset += e['size']
        
    for raw in data_blobs:
        out.write(raw)
        
    return out.getvalue()

def generate_docker_disc_brain_galaxy_icon(size=1024, bg_color=(24, 28, 31), emblem_scale=726.81):
    # 2x supersampling for razor-sharp antialiasing
    S = size * 2
    cx, cy = S / 2.0, S / 2.0

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Background circular disc matching Docker Desktop full-bleed geometry (100% canvas)
    # Background color strictly #181c1f (RGB: 24, 28, 31)
    draw.ellipse([0, 0, S - 1, S - 1], fill=(*bg_color, 255))

    # Hairline titanium perimeter rim highlight
    rim_w = int(round(S * 0.003))
    draw.ellipse([0, 0, S - 1, S - 1], outline=(255, 255, 255, 28), width=rim_w)

    # Measure background disc diameter
    bg_arr = np.array(img)[:, :, 3]
    bg_ys, bg_xs = np.where(bg_arr > 128)
    bg_width = bg_xs.max() - bg_xs.min() + 1

    # 2. Main Emblem: Kept exactly as-is (emblem_scale = 726.81, emblem width ~1505 px on 2048)
    scale = emblem_scale
    P = lambda x, y: (int(round(cx + x * scale)), int(round(cy + y * scale)))

    w_outer = int(round(S * 0.024))
    w_spiral = int(round(S * 0.019))
    c_white = (255, 255, 255, 255)

    emb_img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    emb_draw = ImageDraw.Draw(emb_img)

    # 3. Outer Cranial Perimeter: Symmetrical 4-lobed cranial boundary with cerebral folds
    cranial_pts = []
    for t in np.linspace(0, 2 * math.pi, 300):
        r = 0.88 * (1.0 + 0.13 * math.cos(4 * t) - 0.025 * math.cos(8 * t))
        cranial_pts.append(P(r * math.cos(t), r * math.sin(t)))
    cranial_pts.append(cranial_pts[0])
    emb_draw.line(cranial_pts, fill=c_white, width=w_outer, joint="curve")

    # 4. 4 Bold Galactic Spiral Arms (mixing cerebral sulcus & galactic pinwheel)
    for k in range(4):
        ang_k = k * (math.pi / 2.0)
        cos_k = math.cos(ang_k)
        sin_k = math.sin(ang_k)

        def rot(x, y):
            return x * cos_k - y * sin_k, x * sin_k + y * cos_k

        sp_pts = []
        for t in np.linspace(0.12, 1.25 * math.pi, 60):
            r_sp = 0.72 * math.exp(-0.40 * t)
            th = t + 0.20
            lx = r_sp * math.cos(th)
            ly = -r_sp * math.sin(th)
            rx, ry = rot(lx, ly)
            sp_pts.append(P(rx, ry))
        emb_draw.line(sp_pts, fill=c_white, width=w_spiral, joint="curve")

        tip_r = w_spiral // 2
        for pt in [sp_pts[0], sp_pts[-1]]:
            emb_draw.ellipse([pt[0] - tip_r, pt[1] - tip_r, pt[0] + tip_r, pt[1] + tip_r], fill=c_white)

    # 5. Constellation Star / Synapse Nodes (4 on Cardinal Lobes, 4 on Spiral Origins)
    for k in range(4):
        ang_k = k * (math.pi / 2.0)
        cos_k = math.cos(ang_k)
        sin_k = math.sin(ang_k)

        def rot(x, y):
            return x * cos_k - y * sin_k, x * sin_k + y * cos_k

        # Outer cardinal crest node (North, East, South, West)
        r_peak = 0.88 * (1.0 + 0.13 - 0.025)
        nx, ny = P(*rot(0, -r_peak))
        nr = int(round(S * 0.022))
        emb_draw.ellipse([nx - nr, ny - nr, nx + nr, ny + nr], fill=c_white)
        # Inner accent pupil matching #181c1f background
        nr_in = int(round(S * 0.010))
        emb_draw.ellipse([nx - nr_in, ny - nr_in, nx + nr_in, ny + nr_in], fill=(*bg_color, 255))

        # Spiral origin star node
        t_start = 0.12
        r_start = 0.72 * math.exp(-0.40 * t_start)
        th_start = t_start + 0.20
        sx, sy = P(*rot(r_start * math.cos(th_start), -r_start * math.sin(th_start)))
        sr = int(round(S * 0.015))
        emb_draw.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=c_white)

    # 6. Central Galactic Singularity (4-Point Brilliant Star Core)
    star_r = scale * 0.25
    star_pts = []
    for t in np.linspace(0, 2 * math.pi, 100):
        sx = star_r * (math.cos(t) ** 3)
        sy = star_r * (math.sin(t) ** 3)
        star_pts.append((int(round(cx + sx)), int(round(cy + sy))))
    emb_draw.polygon(star_pts, fill=c_white)

    # Center core spark
    cn_r = int(round(S * 0.015))
    emb_draw.ellipse([cx - cn_r, cy - cn_r, cx + cn_r, cy + cn_r], fill=(*bg_color, 255))
    cn_in = int(round(S * 0.007))
    emb_draw.ellipse([cx - cn_in, cy - cn_in, cx + cn_in, cy + cn_in], fill=c_white)

    # Measure exact emblem width
    emb_arr = np.array(emb_img)[:, :, 3]
    emb_ys, emb_xs = np.where(emb_arr > 128)
    emb_width = emb_xs.max() - emb_xs.min() + 1
    actual_ratio = emb_width / bg_width
    print(f"Background circle: {bg_width}px, Emblem: {emb_width}px, Ratio: {actual_ratio:.4f} ({actual_ratio*100:.2f}%)")

    # Composite emblem onto circular background
    img.paste(emb_img, (0, 0), emb_img)

    # Downscale from supersampled canvas
    res = img.resize((size, size), Image.Resampling.LANCZOS)
    return res, actual_ratio

def safe_write_bytes(raw_bytes, path):
    temp_path = path + ".tmp"
    with open(temp_path, "wb") as f:
        f.write(raw_bytes)
    if os.path.exists(path):
        old_path = path + ".old"
        try:
            if os.path.exists(old_path):
                os.remove(old_path)
            os.rename(path, old_path)
        except Exception:
            pass
    try:
        if os.path.exists(path):
            os.remove(path)
        os.rename(temp_path, path)
        if os.path.exists(path + ".old"):
            try:
                os.remove(path + ".old")
            except Exception:
                pass
        print(f"Saved: {path}")
    except Exception as e:
        print(f"Warning: Could not atomically replace {path}: {e}")

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    res_dir = os.path.join(base_dir, "resources")
    os.makedirs(res_dir, exist_ok=True)

    # Color #181c1f (RGB: 24, 28, 31)
    bg_color = (24, 28, 31)
    print("Generating circular icon matching Docker (background circular 10% bigger / full bleed, emblem kept as-is, #181c1f)...")
    icon_1024, ratio = generate_docker_disc_brain_galaxy_icon(1024, bg_color=bg_color, emblem_scale=726.81)

    # Build hybrid PNG+DIB ICO matching Docker Desktop exactly
    ico_bytes = build_perfect_windows_ico(icon_1024, sizes=[256, 128, 64, 48, 32, 24, 16])
    fav_128 = icon_1024.resize((128, 128), Image.Resampling.LANCZOS)

    # 1. Update resources directory
    for ico_name in ["icon.ico", "oro_app.ico", "favicon.ico"]:
        p = os.path.join(res_dir, ico_name)
        safe_write_bytes(ico_bytes, p)

    png_path = os.path.join(res_dir, "icon.png")
    icon_1024.save(png_path, format="PNG")
    fav_png_path = os.path.join(res_dir, "favicon.png")
    fav_128.save(fav_png_path, format="PNG")

    # 2. Update src/renderer
    renderer_dir = os.path.join(base_dir, "src", "renderer")
    if os.path.exists(renderer_dir):
        safe_write_bytes(ico_bytes, os.path.join(renderer_dir, "icon.ico"))
        safe_write_bytes(ico_bytes, os.path.join(renderer_dir, "favicon.ico"))
        icon_1024.save(os.path.join(renderer_dir, "icon.png"), format="PNG")
        fav_128.save(os.path.join(renderer_dir, "favicon.png"), format="PNG")

    # 3. Update public directory
    pub_dir = os.path.join(base_dir, "public")
    if os.path.exists(pub_dir):
        safe_write_bytes(ico_bytes, os.path.join(pub_dir, "icon.ico"))
        safe_write_bytes(ico_bytes, os.path.join(pub_dir, "favicon.ico"))
        icon_1024.save(os.path.join(pub_dir, "icon.png"), format="PNG")
        fav_128.save(os.path.join(pub_dir, "favicon.png"), format="PNG")

    # 4. Update dist/renderer
    dist_renderer = os.path.join(base_dir, "dist", "renderer")
    if os.path.exists(dist_renderer):
        safe_write_bytes(ico_bytes, os.path.join(dist_renderer, "favicon.ico"))
        fav_128.save(os.path.join(dist_renderer, "favicon.png"), format="PNG")
        icon_1024.save(os.path.join(dist_renderer, "icon.png"), format="PNG")

    # 5. Update Desktop icons
    desktop_dir = r"C:\Users\BACH\Desktop"
    if os.path.exists(desktop_dir):
        for name in ["Oro.ico", "Oro_App.ico", "Oro_Round.ico"]:
            dp = os.path.join(desktop_dir, name)
            safe_write_bytes(ico_bytes, dp)

    # 6. Artifact preview
    artifact_preview = r"C:\Users\BACH\.gemini\antigravity\brain\accffe1d-09e9-4f01-8d4d-e311253ccb34\oro_docker_style_181c1f.png"
    icon_1024.save(artifact_preview, format="PNG")
    print(f"Saved artifact preview: {artifact_preview}")

if __name__ == "__main__":
    main()
