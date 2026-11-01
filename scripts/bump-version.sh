#!/bin/sh
# 為所有模組 import 加上版本戳記，避免瀏覽器／GitHub Pages 快取到舊檔案
# 用法：sh scripts/bump-version.sh
cd "$(dirname "$0")/.." || exit 1
V=$(date +%Y%m%d%H%M%S)
for f in js/*.js; do
  sed -i '' -E "s#(from '\./[a-z]+\.js)(\?v=[0-9]+)?'#\1?v=$V'#g" "$f"
done
sed -i '' -E "s#src=\"js/main\.js(\?v=[0-9]+)?\"#src=\"js/main.js?v=$V\"#" index.html
echo "version $V"
