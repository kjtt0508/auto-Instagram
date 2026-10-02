package jp.co.keai.niijimaig.post.domain;

/** PR区分: 対価を受けた広告かどうか。ステマ規制への対応で、PR案件は公開時にPR表記を先頭に付ける */
public enum PrCategory {
	NONE {
		@Override
		public Caption applyLabel(Caption caption, String label) {
			return caption;
		}
	},
	PR {
		@Override
		public Caption applyLabel(Caption caption, String label) {
			return caption.prefixed(label);
		}
	};

	/** 公開用キャプションを作る。PR表記を付けた結果が上限を超えるなら例外 */
	public abstract Caption applyLabel(Caption caption, String label);

	public boolean requiresLabel() {
		return this == PR;
	}
}
