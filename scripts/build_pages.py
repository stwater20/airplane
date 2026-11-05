#!/usr/bin/env python3
"""產生推廣頁（SEO 用）與 sitemap.xml。用法：python3 -I scripts/build_pages.py"""
import json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SITE = 'https://airplane.sectools.tw'
TODAY = '2026-11-04'

NAV = [('/', '開始飛行'), ('/guide/', '遊戲攻略'), ('/route/', '桃園飛成田航線'), ('/faq/', '常見問題'), ('/en/', 'English')]


def page(path, lang, title, desc, h1, eyebrow, lead, body, ld, cta='開始飛行 ✈️'):
    url = SITE + path
    cur = ' aria-current="page"'
    nav = ''.join(f'<a href="{h}"{cur if h == path else ""}>{t}</a>' for h, t in NAV)
    crumbs = {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': '飛向東京', 'item': SITE + '/'},
        {'@type': 'ListItem', 'position': 2, 'name': h1, 'item': url}]}
    lds = ''.join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>\n' for x in [crumbs] + ld)
    html = f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="author" content="sectools.tw">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="{url}">
<link rel="alternate" hreflang="zh-Hant" href="{SITE}/">
<link rel="alternate" hreflang="en" href="{SITE}/en/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="sectools.tw">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#000000">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✈️</text></svg>">
<link rel="stylesheet" href="/assets/site.css">
{lds}</head>
<body>
<nav class="nav"><div class="in"><a class="brand" href="/">✈️ 資安航空</a>{nav}</div></nav>
<header class="hero">
  <div class="eyebrow">{eyebrow}</div>
  <h1>{h1}</h1>
  <p>{lead}</p>
  <a class="cta" href="/">{cta}</a>
</header>
<main>
{body}
<section class="card" style="text-align:center">
  <h2>{'Ready for takeoff?' if lang == 'en' else '準備好起飛了嗎？'}</h2>
  <p class="muted">{'Free, no download, works on phones and computers.' if lang == 'en' else '免費、免下載，手機和電腦瀏覽器直接玩。'}</p>
  <a class="cta" href="/">{cta}</a>
</section>
</main>
<footer>
  <p>{'Made and maintained by' if lang == 'en' else '由'} <a href="https://sectools.tw/">sectools.tw</a>{'' if lang == 'en' else ' 製作與維護'}・<a href="https://gacha-sho.sectools.tw/">{'SecTools Airlines Gacha' if lang == 'en' else '資安航空扭蛋'}</a></p>
  <p>{'Terrain' if lang == 'en' else '地形'}：USGS SRTM / GMTED2010、NOAA ETOPO1（Mapzen / AWS Terrain Tiles）・{'Imagery' if lang == 'en' else '地表影像'}：NASA Blue Marble（NASA GIBS）。{'Not affiliated with or endorsed by NASA, USGS or NOAA.' if lang == 'en' else '本遊戲與 NASA、USGS、NOAA 無關，亦未獲其背書。'}</p>
  <p>{'A game for entertainment only — not for real-world navigation.' if lang == 'en' else '本遊戲僅供娛樂，不可用於真實飛航。'}</p>
</footer>
</body>
</html>
"""
    out = os.path.join(ROOT, path.strip('/'), 'index.html')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    return url


def faq_ld(qas):
    return {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [
        {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in qas]}


urls = [SITE + '/']

# ── 遊戲攻略 ──
guide_steps = [
    ('登機與安全示範', '第一次飛行會先看到乘客從接駁巴士走上登機梯，接著空服員進行安全示範。兩段都可以按「跳過」。'),
    ('自動起飛', '油門、抬頭、收起落架都會自動完成，離地後就可以開始操控。'),
    ('穿越金色圓環', '按住畫面任意處拖曳（或改用按鈕操控）：左右轉彎、上下爬升或下降。連續穿過圓環可以把倍率疊到 ×5，從正中心穿過算 PERFECT。'),
    ('巡航與亂流', '巡航會自動快轉，也能直接跳到降落。遇到亂流時穩住別亂動，乘客會更安心，還有額外加分。'),
    ('進場與自動降落', '跟著圓環下滑到成田 34L 跑道，最後 120 公尺會由自動駕駛負責對正與降落。'),
]
guide_body = '<section class="card"><h2>五個步驟完成一趟飛行</h2>' + ''.join(
    f'<h3>{i + 1}. {t}</h3><p>{d}</p>' for i, (t, d) in enumerate(guide_steps)) + '</section>'
guide_body += '''<section class="card"><h2>拿高分的訣竅</h2><div class="grid">
<div class="tile"><b>🔥 保持連擊</b>連續命中倍率最高 ×5，漏掉一個就歸零，寧可小幅修正也別錯過。</div>
<div class="tile"><b>🎯 瞄準中心</b>穿過圓環中心算 PERFECT，每次再加 100 分。</div>
<div class="tile"><b>⚡ 藍色加速環</b>每四個圓環有一個藍色加速環，5 秒內分數加倍。</div>
<div class="tile"><b>🪙 順著金幣飛</b>金幣排成一條線引導你進圓環，吃金幣也能存錢轉扭蛋。</div>
<div class="tile"><b>😊 照顧乘客</b>急轉、猛拉會降低乘客滿意度，結算時滿意度最多加 500 分。</div>
<div class="tile"><b>🧈 平穩落地</b>下降率越小加分越多，小於 150 fpm 還能解鎖「奶油落地」成就。</div>
</div></section>
<section class="card"><h2>操控方式</h2><table>
<tr><th>手機（拖曳）</th><td>按住畫面任意處拖曳：左右轉彎、上下爬升／下降。搖桿會跟著拇指移動。</td></tr>
<tr><th>手機（按鈕）</th><td>選單切換「按鈕操控」，用畫面下方的十字方向鍵，適合不習慣拖曳的人。</td></tr>
<tr><th>手機（傾斜）</th><td>按 📱 開啟，左右傾斜手機轉彎，上緣往自己傾爬升。</td></tr>
<tr><th>電腦</th><td><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 或 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>，<kbd>C</kbd> 切換視角，<kbd>P</kbd> 暫停。</td></tr>
</table></section>
<section class="card"><h2>機庫、扭蛋與成就</h2><p>每次飛行賺到的金幣可以在機庫轉「資安航空扭蛋」，收集經典藍、櫻花粉、抹茶綠、駭客綠、黃金傳說等 8 款塗裝。另有 13 個成就，例如首航成功、連擊大師、一環不漏、夜航員、五星服務。每天還有「今日挑戰」：所有人的圓環路線都一樣，可以跟朋友比分數。</p></section>'''
howto = {'@context': 'https://schema.org', '@type': 'HowTo', 'name': '如何玩「飛向東京」飛行小遊戲',
         'step': [{'@type': 'HowToStep', 'name': t, 'text': d} for t, d in guide_steps]}
urls.append(page('/guide/', 'zh-Hant', '飛向東京遊戲攻略：操控、連擊、PERFECT 與高分訣竅｜資安航空',
                 '「飛向東京」3D 飛行小遊戲完整攻略：手機拖曳與按鈕操控、圓環連擊倍率、PERFECT、加速環、乘客滿意度、亂流與平穩落地的高分訣竅。',
                 '遊戲攻略', '資安航空・飛行手冊', '從登機、起飛、穿越圓環到降落成田，一次看懂操控方式與拿高分的訣竅。', guide_body, [howto]))

# ── 航線介紹 ──
route_body = '''<section class="card"><h2>三條航線</h2><table>
<tr><th>🗼 桃園 → 東京成田</th><td>直線約 2,180 公里，實際航班約 3 小時。沿琉球群島與日本南岸飛行，經房總半島進場 34L 跑道。</td></tr>
<tr><th>🏯 桃園 → 大阪關西</th><td>直線約 1,700 公里，實際航班約 2.5 小時。經九州、四國南方外海，從大阪灣進場海上人工島的 06R 跑道。</td></tr>
<tr><th>🏝️ 桃園 → 沖繩那霸</th><td>直線約 650 公里，實際航班約 1 小時 15 分，最適合短時間輕鬆飛一趟。從北方進場 18 號跑道。</td></tr>
</table><p class="muted">實際航班時間會依風向、航路與航空公司不同而變動，以上為大約數字。</p></section>
<section class="card"><h2>東京成田航線概要</h2><table>
<tr><th>出發</th><td>臺灣桃園國際機場（TPE / RCTP），遊戲使用 05R 跑道起飛</td></tr>
<tr><th>抵達</th><td>東京成田國際機場（NRT / RJAA），遊戲使用 34L 跑道 ILS 進場</td></tr>
<tr><th>直線距離</th><td>約 2,180 公里（約 1,180 海里）</td></tr>
<tr><th>實際航班時間</th><td>一般約 3 小時左右（依風向與航路而定）</td></tr>
<tr><th>遊戲時間</th><td>一局約 4～5 分鐘（巡航自動快轉）</td></tr>
</table></section>
<section class="card"><h2>沿途會看到什麼</h2><div class="grid">
<div class="tile"><b>🇹🇼 桃園與北台灣</b>從桃園機場起飛，經過北部海岸，觀音一帶海岸有風力發電機。</div>
<div class="tile"><b>🏝️ 龜山島與東北角</b>爬升時往右可以看到宜蘭外海的龜山島。</div>
<div class="tile"><b>🌊 琉球群島</b>沿著沖繩、奄美群島北上，機長會廣播窗外的沖繩群島。</div>
<div class="tile"><b>⛰️ 屋久島與九州</b>經過九州南方外海，屋久島山勢高聳。</div>
<div class="tile"><b>🗾 紀伊半島與大阪</b>沿日本南岸往東，紀伊半島在左手邊。</div>
<div class="tile"><b>🗻 富士山與房總半島</b>天氣好時左側可以看到富士山，最後經過千葉房總半島進場成田。</div>
</div><p class="muted">遊戲中的地形來自真實的公開高程資料（SRTM、GMTED2010、ETOPO1），地表顏色來自 NASA Blue Marble 衛星合成影像，所以海岸線與山脈的位置都是真實的。</p></section>
<section class="card"><h2>兩座機場</h2>
<h3>臺灣桃園國際機場</h3><p>台灣最主要的國際機場，有兩條平行跑道（05L/23R、05R/23L）。遊戲裡會看到停機坪上的飛機、空橋、地勤車輛、消防車水門禮，以及在跑道旁揮手道別的地勤人員。</p>
<h3>東京成田國際機場</h3><p>位於千葉縣，是東京的主要國際門戶之一。遊戲中從南方經房總半島對準 34L 跑道，以 ILS 儀器進場降落。</p>
<h3>大阪關西國際機場</h3><p>建在大阪灣的海上人工島，跑道四面環海。遊戲中從西南方的海面進場 06R 跑道。</p>
<h3>沖繩那霸機場</h3><p>沖繩的主要機場，緊鄰海岸。遊戲中從北方沿海岸進場 18 號跑道。</p></section>'''
urls.append(page('/route/', 'zh-Hant', '桃園飛東京成田、大阪關西、沖繩那霸航線介紹：距離與飛行時間｜飛向日本',
                 '桃園（TPE）飛東京成田（NRT）、大阪關西（KIX）、沖繩那霸（OKA）航線介紹：距離、實際飛行時間與沿途景點（龜山島、沖繩、屋久島、紀伊半島、富士山）。在瀏覽器免費體驗。',
                 '桃園飛日本航線', 'TPE ✈ NRT・KIX・OKA', '從桃園出發，飛往東京成田、大阪關西或沖繩那霸。在遊戲裡幾分鐘就能飛完，沿途看真實的海岸與山脈。',
                 route_body, [{'@context': 'https://schema.org', '@type': 'Article', 'headline': '桃園飛東京成田航線介紹',
                               'author': {'@type': 'Organization', 'name': 'sectools.tw', 'url': 'https://sectools.tw/'},
                               'publisher': {'@type': 'Organization', 'name': 'sectools.tw'}, 'datePublished': TODAY, 'dateModified': TODAY,
                               'inLanguage': 'zh-Hant', 'mainEntityOfPage': SITE + '/route/'}]))

# ── 常見問題 ──
qas = [
    ('「飛向東京」要錢嗎？需要下載嗎？', '完全免費，不需要下載或註冊，用手機或電腦的瀏覽器打開 airplane.sectools.tw 就能玩。'),
    ('手機可以玩嗎？要直拿還是橫拿？', '可以，介面針對直拿手機設計，單手就能操作；橫拿也支援。可選拖曳、按鈕或傾斜三種操控方式。'),
    ('會不會很難？會墜機嗎？', '起飛、巡航、降落都有自動駕駛協助，你只需要控制方向穿過圓環。另有保護機制，避免把飛機壓到地面或偏離跑道。'),
    ('一局要玩多久？', '大約 4 到 6 分鐘。第二次飛行起會自動跳過登機，巡航也會自動快轉。'),
    ('可以飛哪些航線？', '目前從桃園出發，可以飛往東京成田、大阪關西與沖繩那霸三個目的地，在選單的「目的地」切換。'),
    ('遊戲裡的地形是真的嗎？', '是的。地形高度來自美國地質調查局（USGS）的 SRTM、GMTED2010 與美國國家海洋暨大氣總署（NOAA）的 ETOPO1 公開資料，地表顏色來自 NASA Blue Marble 衛星合成影像。'),
    ('資安航空是真的航空公司嗎？', '不是。「資安航空 SecTools Airlines」是 sectools.tw 為這款遊戲設計的虛構航空公司，與任何真實航空公司無關。'),
    ('進度會保存嗎？', '金幣、塗裝、成就與最佳分數會存在你這台裝置的瀏覽器中。換裝置或清除瀏覽器資料後會重新開始。'),
    ('沒有聲音或語音廣播怎麼辦？', '請確認手機沒有開靜音，並在遊戲內開啟語音與音樂按鈕。語音使用裝置內建的英文語音，聲音會因裝置而異。'),
    ('這是誰做的？', '由 sectools.tw 製作與維護，也歡迎試試同系列的「資安航空扭蛋」gacha-sho.sectools.tw。'),
]
faq_body = '<section class="card"><h2>常見問題</h2>' + ''.join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q, a in qas) + '</section>'
urls.append(page('/faq/', 'zh-Hant', '常見問題：免費嗎？手機能玩嗎？地形是真的嗎？｜飛向東京',
                 '「飛向東京」3D 飛行小遊戲常見問題：免費免下載、手機直拿單手操作、自動起降不易墜機、一局約 5 分鐘、真實地形資料來源與進度保存方式。',
                 '常見問題', '資安航空・服務台', '關於費用、手機操作、遊戲時間、真實地形與資料保存的常見問題。', faq_body, [faq_ld(qas)]))

# ── English ──
en_body = '''<section class="card"><h2>Fly from Taipei to Tokyo in five minutes</h2>
<p>“Fly to Tokyo” is a free 3D flight game that runs in your browser. Board your passengers at Taiwan Taoyuan International Airport, take off through a fire-truck water salute, steer through golden rings along the Ryukyu Islands and the southern coast of Japan, then follow the ILS down to runway 34L at Tokyo Narita.</p>
<div class="grid">
<div class="tile"><b>📱 One-thumb controls</b>Drag anywhere, use the on-screen D-pad, or tilt your phone. Takeoff and landing are automatic.</div>
<div class="tile"><b>🔥 Combos & PERFECTs</b>Chain rings for up to ×5, hit the center for PERFECT, grab blue boost rings.</div>
<div class="tile"><b>😊 Passenger comfort</b>Smooth flying keeps passengers happy. Ride out turbulence without overcorrecting.</div>
<div class="tile"><b>🗺️ Real terrain</b>Elevation from USGS SRTM/GMTED2010 and NOAA ETOPO1; ground colour from NASA Blue Marble.</div>
<div class="tile"><b>🎙️ Radio & cabin</b>Tower clearances with pilot readbacks, a flight-attendant safety briefing and captain announcements.</div>
<div class="tile"><b>🎰 Liveries & daily challenge</b>Collect liveries from the SecTools Airlines gacha and compare scores on the daily route.</div>
</div></section>
<section class="card"><h2>Three routes from Taipei</h2><p>Fly from Taipei Taoyuan (TPE) to Tokyo Narita (NRT, about 2,180 km), Osaka Kansai (KIX, about 1,700 km, landing on an island in Osaka Bay) or Okinawa Naha (OKA, about 650 km). Cruise is fast-forwarded, so a full flight takes about four to six minutes.</p></section>'''
urls.append(page('/en/', 'en', 'Fly to Tokyo – Free Browser Flight Game from Taipei to Narita | SecTools Airlines',
                 'Free 3D flight game in your browser: fly from Taiwan Taoyuan (TPE) to Tokyo Narita (NRT) over real terrain. One-thumb mobile controls, automatic takeoff and landing, combos, passenger comfort and daily challenges.',
                 'Fly to Tokyo', 'SecTools Airlines · Browser flight game', 'Taipei → Tokyo Narita in about five minutes. Free, no download, made for phones.',
                 en_body, [{'@context': 'https://schema.org', '@type': 'VideoGame', 'name': 'Fly to Tokyo', 'url': SITE + '/', 'inLanguage': 'en',
                            'genre': ['Simulation', 'Casual'], 'gamePlatform': ['Web browser', 'iOS', 'Android'],
                            'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
                            'author': {'@type': 'Organization', 'name': 'sectools.tw', 'url': 'https://sectools.tw/'}}],
                 cta='Play now ✈️'))

with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    for u in urls:
        pr = '1.0' if u == SITE + '/' else '0.8'
        f.write(f'  <url><loc>{u}</loc><lastmod>{TODAY}</lastmod><changefreq>weekly</changefreq><priority>{pr}</priority></url>\n')
    f.write('</urlset>\n')
print('\n'.join(urls))
