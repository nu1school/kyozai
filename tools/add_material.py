#!/usr/bin/env python3
"""教材を materials/ に追加し，一覧（manifest.json）へ登録する。

使い方:
  python3 tools/add_material.py 教材.html --title "No12 立体の体積" --folder "理系数学演習/積分"
"""
import argparse, datetime, json, re, secrets, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "materials" / "manifest.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html", type=Path)
    ap.add_argument("--title")
    ap.add_argument("--folder", default="", help="「/」区切りのフォルダ名")
    ap.add_argument("--id", help="省略時は日付と乱数で作る。英数字とハイフンのみ")
    a = ap.parse_args()

    text = a.html.read_text(encoding="utf-8")
    found = re.search(r"<title[^>]*>([^<]*)</title>", text, re.I)
    title = a.title or (found.group(1).strip() if found else a.html.stem)
    today = datetime.date.today()
    mid = a.id or f"m{today:%Y%m%d}-{secrets.token_hex(3)}"
    if not re.fullmatch(r"[A-Za-z0-9-]+", mid):
        raise SystemExit("id は英数字とハイフンのみ")

    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if any(i["id"] == mid for i in man["items"]):
        raise SystemExit(f"id が重複しています: {mid}")
    dest = f"materials/{mid}.html"
    shutil.copyfile(a.html, ROOT / dest)
    man["items"].append({"id": mid, "title": title, "folder": a.folder.strip("/"),
                         "file": dest, "added": today.isoformat()})
    MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"追加: {title} -> {dest}")


if __name__ == "__main__":
    main()
