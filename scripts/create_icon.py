import os
import math
from PIL import Image, ImageDraw, ImageFilter

def make_fallback_icon(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Background rounded squircle
    pad = int(size * 0.06)
    radius = int(size * 0.22)
    bg_box = [pad, pad, size - pad, size - pad]

    # Draw soft shadow
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow)
    s_pad = int(size * 0.08)
    s_draw.rounded_rectangle([s_pad, s_pad + 16, size - s_pad, size - s_pad + 16], radius=radius, fill=(0, 0, 0, 160))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=24))
    img.paste(shadow, (0, 0), shadow)

    # Draw dark metallic base
    draw.rounded_rectangle(bg_box, radius=radius, fill=(12, 12, 14, 255), outline=(255, 255, 255, 36), width=int(size * 0.008))

    # Inner subtle glow gradient
    cx, cy = size // 2, size // 2
    r_max = int(size * 0.4)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    g_draw.ellipse([cx - r_max, cy - r_max, cx + r_max, cy + r_max], fill=(255, 255, 255, 12))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=40))
    img.paste(glow, (0, 0), glow)

    # 2. Central Oro Symbol: Elegant interlocking geometric Ring / Ouroboros arcs
    stroke = int(size * 0.055)
    r_outer = int(size * 0.26)

    # Outer ring
    draw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], outline=(255, 255, 255, 230), width=stroke)

    # Inner neural spark / diamond node
    spark_r = int(size * 0.07)
    spark_box = [cx - spark_r, cy - spark_r, cx + spark_r, cy + spark_r]
    
    # 4-point golden spark
    points = [
        (cx, cy - spark_r),
        (cx + int(spark_r * 0.32), cy - int(spark_r * 0.32)),
        (cx + spark_r, cy),
        (cx + int(spark_r * 0.32), cy + int(spark_r * 0.32)),
        (cx, cy + spark_r),
        (cx - int(spark_r * 0.32), cy + int(spark_r * 0.32)),
        (cx - spark_r, cy),
        (cx - int(spark_r * 0.32), cy - int(spark_r * 0.32)),
    ]
    draw.polygon(points, fill=(255, 255, 255, 255))

    # Two subtle orbiting orbital satellites
    sat_r = int(stroke * 0.6)
    ang1 = math.radians(-35)
    sat1_x = int(cx + r_outer * math.cos(ang1))
    sat1_y = int(cy + r_outer * math.sin(ang1))
    draw.ellipse([sat1_x - sat_r, sat1_y - sat_r, sat1_x + sat_r, sat1_y + sat_r], fill=(255, 255, 255, 255))

    ang2 = math.radians(145)
    sat2_x = int(cx + r_outer * math.cos(ang2))
    sat2_y = int(cy + r_outer * math.sin(ang2))
    draw.ellipse([sat2_x - sat_r, sat2_y - sat_r, sat2_x + sat_r, sat2_y + sat_r], fill=(255, 255, 255, 255))

    return img

def process_and_save(base_img, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    
    # 512x512 PNG
    png512 = base_img.resize((512, 512), Image.Resampling.LANCZOS)
    png_path = os.path.join(out_dir, "icon.png")
    png512.save(png_path, format="PNG")
    print(f"Saved PNG to {png_path}")

    # 256x256 PNG for favicon
    png256 = base_img.resize((256, 256), Image.Resampling.LANCZOS)
    fav_path = os.path.join(out_dir, "favicon.png")
    png256.save(fav_path, format="PNG")

    # Multi-resolution ICO
    ico_path = os.path.join(out_dir, "icon.ico")
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base_img.save(ico_path, format="ICO", sizes=sizes)
    print(f"Saved ICO to {ico_path}")

if __name__ == "__main__":
    out_dir = r"C:\Users\BACH\.gemini\antigravity\scratch\oro\resources"
    raw_path = os.path.join(out_dir, "icon_raw.png")
    
    if os.path.exists(raw_path):
        print(f"Loading raw icon from {raw_path}...")
        img = Image.open(raw_path).convert("RGBA")
        # Apply rounded corner mask to make it a clean desktop icon
        w, h = img.size
        mask = Image.new("L", (w, h), 0)
        m_draw = ImageDraw.Draw(mask)
        m_draw.rounded_rectangle([0, 0, w, h], radius=int(w * 0.22), fill=255)
        rounded = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        rounded.paste(img, (0, 0), mask)
        process_and_save(rounded, out_dir)
    else:
        print("Generating geometric vector icon...")
        img = make_fallback_icon()
        process_and_save(img, out_dir)
