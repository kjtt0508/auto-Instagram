package jp.co.keai.niijimaig.post.domain;

import java.util.Arrays;
import java.util.Optional;

/**
 * アクセント色: 表紙の3段目の帯の色（紫・赤・青緑の3つだけ）。色の値は新島info の公開中の投稿から読み取ったもの（REQ-002 設計 0章）。
 * 赤と青緑は左→右のグラデーション、紫は単色。TS の AccentColor と揃える
 */
public enum AccentColor {
	PURPLE("紫", "#8C52FE", "#8C52FE"),
	RED("赤", "#FD3432", "#FE914C"),
	TEAL("青緑", "#19BBAA", "#066A85");

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

	/** 画面・違反の説明に出す名前（紫・赤・青緑） */
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
