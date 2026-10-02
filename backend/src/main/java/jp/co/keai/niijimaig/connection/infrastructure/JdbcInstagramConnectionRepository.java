package jp.co.keai.niijimaig.connection.infrastructure;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import jp.co.keai.niijimaig.connection.domain.InstagramConnection;
import jp.co.keai.niijimaig.connection.domain.InstagramConnectionRepository;
import jp.co.keai.niijimaig.connection.domain.TokenExpiry;
import jp.co.keai.niijimaig.post.domain.FailureKind;

/** Instagram連携。最新の未解除の連携と、その最新トークンを復号して返す。更新・失敗は追記する */
@Repository
public class JdbcInstagramConnectionRepository implements InstagramConnectionRepository {

	private static final String CURRENT = """
			select c.connection_id, c.ig_user_id, g.token_ciphertext, g.token_iv, g.key_version, g.expires_at
			  from instagram_connection_current c
			  join lateral (select * from instagram_token_grants
			                 where connection_id = c.connection_id order by id desc limit 1) g on true
			 where c.tenant_id = ?
			""";

	/** refresh_failures の CHECK で許される区分（それ以外は UNKNOWN として記録） */
	private static final Set<FailureKind> RECORDABLE = Set.of(FailureKind.TRANSIENT, FailureKind.RATE_LIMITED,
			FailureKind.TOKEN_INVALID, FailureKind.UNKNOWN);

	private final JdbcTemplate jdbc;
	private final TokenCipher cipher;

	public JdbcInstagramConnectionRepository(JdbcTemplate jdbc, TokenCipher cipher) {
		this.jdbc = jdbc;
		this.cipher = cipher;
	}

	@Override
	public Optional<InstagramConnection> current(UUID tenantId) {
		return jdbc.query(CURRENT, (rs, i) -> toConnection(rs), tenantId).stream().findFirst();
	}

	private InstagramConnection toConnection(ResultSet rs) throws SQLException {
		UUID connectionId = rs.getObject("connection_id", UUID.class);
		TokenCipher.Sealed sealed = new TokenCipher.Sealed(rs.getBytes("token_ciphertext"), rs.getBytes("token_iv"),
				rs.getShort("key_version"));
		return new InstagramConnection(connectionId, rs.getString("ig_user_id"), cipher.open(sealed, connectionId),
				new TokenExpiry(rs.getTimestamp("expires_at").toInstant()));
	}

	@Override
	public void recordRefresh(InstagramConnection refreshed) {
		TokenCipher.Sealed sealed = cipher.seal(refreshed.token(), refreshed.id());
		jdbc.update("""
				insert into instagram_token_grants (connection_id, grant_kind, token_ciphertext, token_iv, key_version, expires_at)
				values (?, 'REFRESH', ?, ?, ?, ?)
				""", refreshed.id(), sealed.ciphertext(), sealed.iv(), sealed.keyVersion(),
				Timestamp.from(refreshed.expiry().toInstant()));
	}

	@Override
	public void recordRefreshFailure(InstagramConnection connection, FailureKind kind, String message) {
		FailureKind recorded = RECORDABLE.contains(kind) ? kind : FailureKind.UNKNOWN;
		jdbc.update("insert into instagram_token_refresh_failures (connection_id, failure_kind, message) values (?, ?, ?)",
				connection.id(), recorded.name(), message);
	}
}
