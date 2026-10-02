package jp.co.keai.niijimaig.post.domain;

/** 投稿種別。枚数の範囲と、Instagram への公開手順が変わる */
public enum PostFormat {
	FEED_IMAGE(1, 1, false),
	CAROUSEL(2, 10, true);

	private final int minMedia;
	private final int maxMedia;
	private final boolean needsChildContainers;

	PostFormat(int minMedia, int maxMedia, boolean needsChildContainers) {
		this.minMedia = minMedia;
		this.maxMedia = maxMedia;
		this.needsChildContainers = needsChildContainers;
	}

	public boolean acceptsMediaCount(int count) {
		return count >= minMedia && count <= maxMedia;
	}

	public String mediaCountRule() {
		if (minMedia == maxMedia) {
			return "画像は" + minMedia + "枚です";
		}
		return "カルーセルは" + minMedia + "〜" + maxMedia + "枚です";
	}

	/** カルーセルは子コンテナを先に作ってから親コンテナを作る */
	public boolean needsChildContainers() {
		return needsChildContainers;
	}
}
