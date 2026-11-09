# 教材棚

授業で投影するHTML教材の置き場です。公開ページ: https://nu1school.github.io/kyozai/

- アプリは `index.html` / `app.js` / `style.css` / `sw.js`。ビルドは不要です。
- 教材の本体は `materials/<id>.html`、題名とフォルダは `materials/manifest.json` で管理します。
- 通常の追加・移動・削除は、アプリの「管理」から行います。
- リポジトリ側から追加するときは `python3 tools/add_material.py 教材.html --title "題名" --folder "フォルダ/サブフォルダ"` を使います。
- 公開リポジトリです。教科書の問題文や生徒の情報は入れないでください。削除しても変更履歴には残ります。
