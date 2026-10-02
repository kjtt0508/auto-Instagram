package jp.co.keai.niijimaig.connection.domain;

import java.util.Optional;
import java.util.UUID;

import jp.co.keai.niijimaig.post.domain.FailureKind;

/** Instagram連携の記録。トークンは保存時に暗号化し、取り出し時に復号する（infrastructure） */
public interface InstagramConnectionRepository {

	Optional<InstagramConnection> current(UUID tenantId);

	void recordRefresh(InstagramConnection refreshed);

	void recordRefreshFailure(InstagramConnection connection, FailureKind kind, String message);
}
