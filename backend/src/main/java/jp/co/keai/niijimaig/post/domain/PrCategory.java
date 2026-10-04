package jp.co.keai.niijimaig.post.domain;

/** PR区分: 対価を受けた広告かどうか。ステマ規制への対応で、PR案件は公開時にPR表記を先頭に付ける */
public enum PrCategory {
	NONE,
	PR;

	/** 公開用キャプションの先頭に付ける文字列（PR案件ならPR表記、それ以外は空）。上限の検査は Post が付記全体で行う */
	public String labelPrefix(String label) {
		return requiresLabel() ? label : "";
	}

	public boolean requiresLabel() {
		return this == PR;
	}
}
