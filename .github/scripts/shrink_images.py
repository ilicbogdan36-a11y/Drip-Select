#!/usr/bin/env python3
"""Automatsko smanjivanje slika proizvoda.

Prolazi kroz content/proizvodi/*.md, nađe slike na koje proizvodi pokazuju
(image, image2, ... iz /images/products/) i svaku preveliku smanji:
  - najduža strana najviše 1600 px
  - format WebP, kvalitet se spušta dok slika ne stane ispod ~220 KB
  - rotacija sa telefona (EXIF) se primeni na sliku
  - PNG/JPG se zamenjuje .webp fajlom, a putanja u proizvodu se ispravi
Slike koje nijedan proizvod ne koristi (tek otpremljene, proizvod stiže u sledećem
commit-u) ostaju netaknute. Mala slika se ne dira. Pokretanje je bezbedno da se ponovi
(drugi put ne menja ništa).
"""
import io, os, re, sys, glob
from PIL import Image, ImageOps

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
CONTENT = os.path.join(ROOT, "content", "proizvodi")
PUBLIC = os.path.join(ROOT, "public")
PREFIX = "/images/products/"
MAX_SIDE = 1600
TARGET = 220 * 1024        # cilj za težinu fajla
LIMIT_WEBP = 260 * 1024    # webp do ove težine (i do 1600 px) se ne dira
LIMIT_OTHER = 150 * 1024   # png/jpg do ove težine (i do 1600 px) se ne dira
REF = re.compile(r'^(image\d*|cutout):[ \t]*["\']?(' + re.escape(PREFIX) + r'[^"\'\s]+)["\']?[ \t]*$', re.M)

def disk(url):
    return os.path.join(PUBLIC, url.lstrip("/"))

def encode(im):
    data = None
    for q in (88, 82, 76, 70, 64):
        buf = io.BytesIO(); im.save(buf, "WEBP", quality=q, method=6); data = buf.getvalue()
        if len(data) <= TARGET: break
    return data

def main():
    mds = sorted(glob.glob(os.path.join(CONTENT, "*.md")))
    refs = {}
    for md in mds:
        txt = open(md, encoding="utf-8").read()
        for m in REF.finditer(txt):
            refs.setdefault(m.group(2), []).append(md)
    changed = 0
    for url in sorted(refs):
        p = disk(url)
        if not os.path.isfile(p): continue
        size = os.path.getsize(p)
        ext = os.path.splitext(p)[1].lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp"): continue
        try:
            im = Image.open(p); im.load()
        except Exception as e:
            print("preskačem (ne mogu da otvorim):", url, e); continue
        w, h = im.size
        small = max(w, h) <= MAX_SIDE
        if small and size <= (LIMIT_WEBP if ext == ".webp" else LIMIT_OTHER):
            continue
        im = ImageOps.exif_transpose(im)
        keep_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        if keep_alpha:
            a = im.convert("RGBA").getchannel("A")
            if a.getextrema() == (255, 255): keep_alpha = False
        im = im.convert("RGBA" if keep_alpha else "RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        data = encode(im)
        if ext != ".webp" and small and len(data) > size * 0.85:
            continue  # nema prave koristi
        if ext == ".webp":
            open(p, "wb").write(data)
            print(f"smanjeno: {url} {size//1024} KB -> {len(data)//1024} KB")
            changed += 1; continue
        new_url = os.path.splitext(url)[0] + ".webp"
        n = 1
        while os.path.exists(disk(new_url)) and os.path.abspath(disk(new_url)) != os.path.abspath(p):
            new_url = os.path.splitext(url)[0] + f"-{n}.webp"; n += 1
        open(disk(new_url), "wb").write(data)
        for md in set(refs[url]):
            t = open(md, encoding="utf-8").read()
            t = re.sub(r'(?m)^((?:image\d*|cutout):[ \t]*["\']?)' + re.escape(url) + r'(["\']?[ \t]*)$', lambda m: m.group(1) + new_url + m.group(2), t)
            open(md, "w", encoding="utf-8", newline="").write(t)
        still = any(url in open(md, encoding="utf-8").read() for md in mds)
        if not still: os.remove(p)
        print(f"smanjeno: {url} {size//1024} KB -> {new_url} {len(data)//1024} KB")
        changed += 1
    print("gotovo:", changed, "izmena")

main()
