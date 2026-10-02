package jp.co.keai.niijimaig.connection.domain;

/** アクセストークン: Instagram API を呼ぶための長期トークン。文字列表現では値を伏せる */
public final class AccessToken {

	private final String value;

	public AccessToken(String value) {
		if (value == null || value.isBlank()) {
			throw new IllegalArgumentException("アクセストークンは空にできない");
		}
		this.value = value;
	}

	/** API クライアント（infrastructure）だけが使う。ログに出さないこと */
	public String reveal() {
		return value;
	}

	@Override
	public String toString() {
		return "AccessToken(****)";
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof AccessToken t && t.value.equals(value);
	}

	@Override
	public int hashCode() {
		return value.hashCode();
	}
}
