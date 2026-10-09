package jp.co.keai.niijimaig.post.domain;

/**
 * スライド役割: カルーセル内でのスライドの役割（表紙 / 中のスライド / 最後のスライド）。役割ごとに使うテンプレートと中身の型が決まる。
 * 並びは 表紙 → 中のスライド → 最後のスライド。TS の SlideRole と揃える
 */
public enum SlideRole {
	COVER,
	BODY,
	CLOSING
}
