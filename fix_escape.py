content = open('public/bendahara-sekolah.html', 'r', encoding='utf-8').read()
content = content.replace("changePage(\\' + tab + \\'", "changePage(\\' + tab + \\'")
open('public/bendahara-sekolah.html', 'w', encoding='utf-8').write(content)
# Fix juga
content = open('public/bendahara-sekolah.html', 'r', encoding='utf-8').read()
content = content.replace("<button onclick=\"changePage(\\'", "<button onclick=\"changePage('\\' + tab + '\\''")
# Reset saja ke format sederhana
content = content.replace("<button onclick=\"changePage('\\'' + tab + '\\''", "<button onclick=\"changePage(\\'' + tab + '\\''")  
open('public/bendahara-sekolah.html', 'w', encoding='utf-8').write(content)
print('done')