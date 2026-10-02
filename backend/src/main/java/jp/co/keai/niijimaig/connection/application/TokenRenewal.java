package jp.co.keai.niijimaig.connection.application;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.connection.domain.InstagramConnection;
import jp.co.keai.niijimaig.connection.domain.InstagramConnectionRepository;
import jp.co.keai.niijimaig.post.application.InstagramApiException;
import jp.co.keai.niijimaig.tenant.domain.TenantRepository;

/**
 * ユースケース「トークンを更新する」（REQ-001.md 6.4）。期限が近い連携だけ更新し、失敗は記録する。
 * 期限が迫って更新に失敗したら、ワークフローを失敗させるよう呼び出し側に知らせる（京愛にメールが届く）。
 */
@Service
public class TokenRenewal {

	private final TenantRepository tenants;
	private final InstagramConnectionRepository connections;
	private final InstagramTokenRefresher refresher;
	private final Clock clock;

	public TokenRenewal(TenantRepository tenants, InstagramConnectionRepository connections,
			InstagramTokenRefresher refresher, Clock clock) {
		this.tenants = tenants;
		this.connections = connections;
		this.refresher = refresher;
		this.clock = clock;
	}

	/** @return ワークフローを失敗させるべきなら true */
	public boolean run() {
		Instant now = clock.instant();
		return tenants.allTenantIds().stream()
				.map(tenantId -> renew(tenantId, now))
				.reduce(false, Boolean::logicalOr);
	}

	private boolean renew(UUID tenantId, Instant now) {
		Optional<InstagramConnection> current = connections.current(tenantId);
		if (current.isEmpty() || !current.get().needsRefresh(now)) {
			return false;
		}
		InstagramConnection connection = current.get();
		try {
			connections.recordRefresh(refresher.refresh(connection));
			return false;
		} catch (InstagramApiException e) {
			connections.recordRefreshFailure(connection, e.kind(), e.reason().message());
			return connection.shouldFailWorkflow(true, now);
		}
	}
}
