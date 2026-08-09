#!/usr/bin/env bash
# 改版用:一次把版本號更新到所有需要的地方。
#
#   ./bump.sh          → 自動加一
#   ./bump.sh 12       → 直接指定號碼
#
# 版本號要一起改的地方有五處(config.js、index.html 兩處、
# app.js 的 config 匯入、sw.js),漏掉任何一處老師的瀏覽器
# 就可能繼續用快取裡的舊程式。

set -euo pipefail
cd "$(dirname "$0")"

current=$(grep -oP 'APP_BUILD = \K[0-9]+' assets/config.js)
next=${1:-$((current + 1))}

if ! [[ "$next" =~ ^[0-9]+$ ]]; then
  echo "版本號要是數字,例如:./bump.sh 12" >&2
  exit 1
fi

sed -i "s/APP_BUILD = ${current}/APP_BUILD = ${next}/"                assets/config.js
sed -i "s/?v=${current}\"/?v=${next}\"/g"                             index.html
sed -i "s|\./config\.js?v=${current}\"|./config.js?v=${next}\"|"      assets/app.js
sed -i "s/const BUILD = \"${current}\"/const BUILD = \"${next}\"/"    sw.js

# 境界名稱直接讀改好的 config.js,和程式顯示的完全一致
realm=$(node -e "import('./assets/config.js').then(c => console.log(c.APP_VERSION));")

echo "版本號 ${current} → ${next}(${realm})"
echo
grep -n "APP_BUILD"      assets/config.js
grep -n "?v="            index.html
grep -n "config.js?v="   assets/app.js
grep -n "const BUILD"    sw.js
