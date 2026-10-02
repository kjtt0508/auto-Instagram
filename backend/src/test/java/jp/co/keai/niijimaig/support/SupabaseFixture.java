package jp.co.keai.niijimaig.support;

import java.util.UUID;
import java.util.function.Function;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * テスト用: 団体・メンバーを登録し、Supabase と同じ「authenticated ロール＋JWT クレーム」で SQL を実行する。
 */
public final class SupabaseFixture {

	private final JdbcTemplate jdbc;
	private final TransactionTemplate tx;

	public SupabaseFixture(JdbcTemplate jdbc, TransactionTemplate tx) {
		this.jdbc = jdbc;
		this.tx = tx;
	}

	public UUID tenant(String name) {
		return jdbc.queryForObject("insert into tenants (name) values (?) returning id", UUID.class, name);
	}

	/** メンバーを登録し、ログイン済み（auth.users と結びつけ済み）にする。戻り値は auth のユーザーID */
	public LoggedIn member(UUID tenant, String email, String role) {
		UUID member = jdbc.queryForObject(
				"insert into members (tenant_id, email, display_name) values (?, ?, ?) returning id",
				UUID.class, tenant, email, displayNameOf(email));
		jdbc.update("insert into member_role_changes (member_id, role) values (?, ?)", member, role);
		UUID authUser = UUID.randomUUID();
		jdbc.update("insert into auth.users (id, email) values (?, ?)", authUser, email);
		jdbc.update("insert into member_auth_links (member_id, auth_user_id) values (?, ?)", member, authUser);
		return new LoggedIn(member, authUser, email);
	}

	private String displayNameOf(String email) {
		String local = email.substring(0, email.indexOf('@'));
		return local.length() > 50 ? local.substring(0, 50) : local;
	}

	/** 許可リストに無い Google アカウントでログインした人 */
	public LoggedIn stranger(String email) {
		UUID authUser = UUID.randomUUID();
		jdbc.update("insert into auth.users (id, email) values (?, ?)", authUser, email);
		return new LoggedIn(null, authUser, email);
	}

	public <T> T as(LoggedIn user, Function<JdbcTemplate, T> work) {
		return tx.execute(status -> {
			jdbc.execute("set local role authenticated");
			jdbc.queryForObject("select set_config('request.jwt.claims', ?, true)", String.class, user.claims());
			return work.apply(jdbc);
		});
	}

	/** API関数・定期処理と同じ service role で実行する（RLS を通らない） */
	public <T> T asServiceRole(Function<JdbcTemplate, T> work) {
		return tx.execute(status -> {
			jdbc.execute("set local role service_role");
			return work.apply(jdbc);
		});
	}

	public record LoggedIn(UUID memberId, UUID authUserId, String email) {
		String claims() {
			return "{\"sub\":\"" + authUserId + "\",\"email\":\"" + email
					+ "\",\"user_metadata\":{\"email_verified\":true}}";
		}
	}
}
