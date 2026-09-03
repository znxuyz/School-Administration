#!/usr/bin/env python3
"""
從 assets/icons/source.png 產生全部尺寸的圖示。

想換圖示時,把新的正方形大圖(建議 1024px 以上)存成 assets/icons/source.png,
然後執行:

    pip install Pillow
    python3 make-icons.py

各尺寸為什麼要這樣做,程式裡都有註解 —— 重點是每個平台會用不同的形狀
把圖示裁一次,不能全部用同一張。
"""

import os
from PIL import Image

SRC = "assets/icons/source.png"
OUT = "assets/icons/"

# 補邊時用的底色。要跟原圖四角一樣,不然看得出接縫。
BG = (0, 3, 16)

# 分頁小圖示改用原圖的哪一塊(中心點與半徑,以原圖 1254px 為準)。
# 整張圖縮到 16px 會糊成一團藍,所以只取「圓餅+勾」那個最好認的元素。
FAVICON_CROP = (845, 840, 275)


def squeeze(im):
    """霓虹漸層存成 PNG 很肥。減到 256 色 + 誤差擴散,肉眼看不出差別,檔案小一半。"""
    return im.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)


def main():
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    if w != h:
        raise SystemExit(f"原圖必須是正方形,現在是 {w}x{h}")

    def resized(n):
        return src.resize((n, n), Image.LANCZOS)

    def padded(n, scale):
        c = Image.new("RGB", (n, n), BG)
        s = int(round(n * scale))
        c.paste(src.resize((s, s), Image.LANCZOS), ((n - s) // 2, (n - s) // 2))
        return c

    # 一般用途。iOS 會用自己的圓角遮罩再裁一次,但這張圖本身的圓角就夠大,
    # 實測只切到 0.02% 的亮部,所以直接滿版即可。
    squeeze(resized(512)).save(OUT + "icon-512.png", optimize=True)
    squeeze(resized(192)).save(OUT + "icon-192.png", optimize=True)
    squeeze(resized(180)).save(OUT + "apple-touch-icon.png", optimize=True)

    # Android 的 maskable:只保證「中央直徑 80% 的圓」不會被裁掉,
    # 各家桌面用的遮罩形狀還不一樣。所以整張縮到 80% 再補底色,
    # 這樣不管被裁成圓形還是圓角方形,主體都完整。
    squeeze(padded(512, 0.80)).save(OUT + "icon-maskable-512.png", optimize=True)

    cx, cy, hs = FAVICON_CROP
    k = w / 1254            # 換過原圖尺寸時,裁切位置要等比例換算
    box = (int((cx - hs) * k), int((cy - hs) * k), int((cx + hs) * k), int((cy + hs) * k))
    src.crop(box).resize((64, 64), Image.LANCZOS).save(OUT + "favicon.png", optimize=True)

    for f in ["icon-512.png", "icon-192.png", "apple-touch-icon.png",
              "icon-maskable-512.png", "favicon.png"]:
        im = Image.open(OUT + f)
        print(f"{f:24} {im.size[0]:>3}x{im.size[1]:<3} {os.path.getsize(OUT + f) / 1024:5.0f} KB")
    print("\n產生完畢。別忘了執行 ./bump.sh 換版本號,否則瀏覽器會用快取裡的舊圖示。")


if __name__ == "__main__":
    main()
