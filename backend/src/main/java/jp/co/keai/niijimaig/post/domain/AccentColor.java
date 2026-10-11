package jp.co.keai.niijimaig.post.domain;

import java.util.Arrays;
import java.util.Optional;

/**
 * アクセント色: 表紙の3段目の帯の色（7色。REQ-006）。紫・赤・青緑の値は新島info の公開中の投稿から読み取ったもの（REQ-002 設計 0章）で変えない。
 * 青・緑・オレンジ・ピンクは設計で決めた値（REQ-006 設計 2章。左端・右端とも白との明るさの比が 3:1 以上。テストで確かめる）。
 * 紫は単色、ほかは左→右のグラデーション。TS の AccentColor と揃える（docs/model/fixtures/accent-colors.json）
 */
public enum AccentColor {
	PURPLE("紫", "#8C52FE", "#8C52FE"),
	RED("赤", "#FD3432", "#FE914C"),
	TEAL("青緑", "#19BBAA", "#066A85"),
	BLUE("青", "#3B82F6", "#1D4ED8"),
	GREEN("緑", "#1FA35C", "#0E7C45"),
	ORANGE("オレンジ", "#E8590C", "#C2410C"),
	PINK("ピンク", "#E5528B", "#C2185B");

	private final String label;
	private final String startColor;
	private final String endColor;

	AccentColor(String label, String startColor, String endColor) {
		this.label = label;
		this.startColor = startColor;
		this.endColor = endColor;
	}

	/** 区分のコードから。AI の出力など文字列で受けたものを判断する（知らないコードは空） */
	public static Optional<AccentColor> find(String code) {
		return Arrays.stream(values()).filter(c -> c.name().equals(code)).findFirst();
	}

	/** 画面・違反の説明に出す名前（紫・赤・青緑・青・緑・オレンジ・ピンク） */
	public String label() {
		return label;
	}

	/** 帯の左端の色 */
	public String startColor() {
		return startColor;
	}

	/** 帯の右端の色（単色なら左端と同じ） */
	public String endColor() {
		return endColor;
	}
}
