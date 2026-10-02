package jp.co.keai.niijimaig.connection.domain;

import java.time.Duration;
import java.time.Instant;

/** トークン有効期限。更新・警告・ワークフローを失敗させる日数（30/14/7日・仮置き）を判断する */
public final class TokenExpiry {

	static final long REFRESH_DAYS = 30;
	static final long WARNING_DAYS = 14;
	static final long FAIL_WORKFLOW_DAYS = 7;

	private final Instant expiresAt;

	public TokenExpiry(Instant expiresAt) {
		if (expiresAt == null) {
			throw new IllegalArgumentException("トークン有効期限は必須");
		}
		this.expiresAt = expiresAt;
	}

	/** 残り日数（切り捨て。期限切れなら負） */
	public long remainingDays(Instant now) {
		return Duration.between(now, expiresAt).toDays();
	}

	public boolean needsRefresh(Instant now) {
		return remainingDays(now) <= REFRESH_DAYS;
	}

	public boolean needsWarning(Instant now) {
		return remainingDays(now) <= WARNING_DAYS;
	}

	/** 更新に失敗し、期限が迫っているときは、ワークフローを失敗させて京愛にメールを届ける */
	public boolean shouldFailWorkflow(boolean refreshFailed, Instant now) {
		return refreshFailed && remainingDays(now) <= FAIL_WORKFLOW_DAYS;
	}

	public boolean isExpired(Instant now) {
		return !expiresAt.isAfter(now);
	}

	public Instant toInstant() {
		return expiresAt;
	}
}
