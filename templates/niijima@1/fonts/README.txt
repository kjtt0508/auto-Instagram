niijima@1 のフォント（どちらも SIL Open Font License 1.1。ライセンス文は OFL-*.txt）

NotoSansJP-Bold.woff2 / NotoSansJP-Black.woff2
  元: https://github.com/notofonts/noto-cjk （Sans/SubsetOTF/JP/NotoSansJP-Bold.otf, NotoSansJP-Black.otf）
  加工: fontTools の pyftsubset 相当（fontTools.subset）で woff2 に変換し、次の文字だけに絞った。
    ASCII・Latin-1・一般句読点・矢印・数学記号・罫線・図形・CJK の記号・かな・全角形、JIS X 0213 の全文字（約9,900字）
  ライセンス: OFL-NotoSansJP.txt

NotoColorEmoji.woff2
  元: https://github.com/google/fonts （ofl/notocoloremoji/NotoColorEmoji-Regular.ttf。COLRv1）
  加工: fontTools.subset で woff2 に変換し、絵文字の範囲（U+1F000-1FAFF・記号・タグ・ZWJ・異体字選択子 など）に絞った。
  ライセンス: OFL-NotoColorEmoji.txt

版は変更しない。フォントを替えるときは新しい版のフォルダを作る。
