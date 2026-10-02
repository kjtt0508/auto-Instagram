package jp.co.keai.niijimaig.connection.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * Instagram連携: 新島infoのアカウントに、システムが代わりに投稿してよいという許可。
 * トークンは暗号化して保持し、画面・ログ・LLM に出さない。更新は記録を追記して表す。
 */
public final class InstagramConnection {

	private final UUID id;
	private final String igUserId;
	private final AccessToken token;
	private final TokenExpiry expiry;

	public InstagramConnection(UUID id, String igUserId, AccessToken token, TokenExpiry expiry) {
		if (id == null || igUserId == null || igUserId.isBlank() || token == null || expiry == null) {
			throw new IllegalArgumentException("連携中はIGユーザーID・アクセストークン・トークン有効期限がそろっている");
		}
		this.id = id;
		this.igUserId = igUserId;
		this.token = token;
		this.expiry = expiry;
	}

	public boolean needsRefresh(Instant now) {
		return expiry.needsRefresh(now);
	}

	public boolean shouldFailWorkflow(boolean refreshFailed, Instant now) {
		return expiry.shouldFailWorkflow(refreshFailed, now);
	}

	/** 新しいトークンで更新された連携 */
	public InstagramConnection refreshedWith(AccessToken newToken, TokenExpiry newExpiry) {
		return new InstagramConnection(id, igUserId, newToken, newExpiry);
	}

	public UUID id() {
		return id;
	}

	public String igUserId() {
		return igUserId;
	}

	public AccessToken token() {
		return token;
	}

	public TokenExpiry expiry() {
		return expiry;
	}
}
