package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Instagram連携の記録（1団体に1つ）・Storage の団体境界・遷移表と共通テストケースの一致を、DB で確かめる */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class ConnectionAndStorageDatabaseTest {

	static final String RECORD = "select public.record_instagram_connection(?, ?, ?, ?, ?, 'BUSINESS', ?, ?, 1::smallint, now() + interval '60 days')";
	static final String IV_12_BYTES = "AAECAwQFBgcICQoL";

	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;

	SupabaseFixture db;
	UUID tenant;
	LoggedIn admin;
	LoggedIn approver;

	@BeforeEach
	void setUp() {
		db = new SupabaseFixture(jdbc, tx);
		String suffix = UUID.randomUUID().toString().substring(0, 8);
		tenant = db.tenant("新島info-" + suffix);
		admin = db.member(tenant, "admin-" + suffix + "@example.com", "ADMIN");
		approver = db.member(tenant, "approver-" + suffix + "@example.com", "APPROVER");
	}

	@Test
	@DisplayName("AC-001-03 API関数（service role）が連携と暗号化したトークンを記録し、画面には名前と期限だけが見える")
	void serviceRoleRecordsConnectionAndToken() {
		UUID connection = record("niijima_info");

		Map<String, Object> grant = jdbc.queryForMap(
				"select octet_length(token_iv) as iv, octet_length(token_ciphertext) as ct from instagram_token_grants where connection_id = ?", connection);
		List<Map<String, Object>> status = db.as(admin, j -> j.queryForList("select * from public.instagram_connection_status()"));

		assertThat(grant).containsEntry("iv", 12).containsEntry("ct", 3);
		assertThat(status).hasSize(1);
		assertThat(status.get(0)).containsEntry("ig_username", "niijima_info").containsKeys("token_expires_at")
				.doesNotContainKeys("token_ciphertext", "token_iv");
	}

	@Test
	@DisplayName("AC-001-03 連携の記録は画面（authenticated）からは権限で拒否される")
	void screenCannotRecordConnection() {
		assertThatThrownBy(() -> db.as(admin, j -> j.queryForList(RECORD,
				UUID.randomUUID(), tenant, admin.memberId(), "1", "x", "AAAA", IV_12_BYTES)))
				.rootCause().hasMessageContaining("permission denied");
	}

	@Test
	@DisplayName("BR-001-02 連携し直すと前の連携は解除され、その後の解除で連携は1つも残らない")
	void reconnectThenDisconnectLeavesNothing() {
		record("old_account");
		record("new_account");

		List<String> current = jdbc.queryForList("select ig_username from instagram_connection_current where tenant_id = ?", String.class, tenant);
		assertThat(current).containsExactly("new_account");

		db.as(admin, j -> j.queryForList("select public.disconnect_instagram()"));

		int remaining = jdbc.queryForObject("select count(*) from instagram_connection_current where tenant_id = ?", Integer.class, tenant);
		int active = jdbc.queryForObject("select count(*) from instagram_connections c where tenant_id = ? and not exists "
				+ "(select 1 from instagram_disconnections d where d.connection_id = c.id)", Integer.class, tenant);
		assertThat(remaining).isZero();
		assertThat(active).isZero();
	}

	@Test
	@DisplayName("BR-001-02 連携を解除できるのは管理者だけ。連携していなければ解除できない")
	void onlyAdminDisconnects() {
		assertThatThrownBy(() -> db.as(admin, j -> j.queryForList("select public.disconnect_instagram()")))
				.rootCause().hasMessageContaining("連携していません");
		record("niijima_info");
		assertThatThrownBy(() -> db.as(approver, j -> j.queryForList("select public.disconnect_instagram()")))
				.rootCause().hasMessageContaining("権限がありません");
	}

	@Test
	@DisplayName("NFR-001-05 下書きの画像は自団体のパスにだけ保存でき、他団体の画像は読めない")
	void storageIsSeparatedByTenant() {
		UUID other = db.tenant("他団体-" + UUID.randomUUID());
		String ownPath = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		String otherPath = other + "/posts/" + UUID.randomUUID() + ".jpg";
		db.asServiceRole(j -> j.update("insert into storage.objects (bucket_id, name) values ('uploads-private', ?)", otherPath));

		db.as(admin, j -> j.update("insert into storage.objects (bucket_id, name) values ('uploads-private', ?)", ownPath));
		assertThatThrownBy(() -> db.as(admin, j -> j.update(
				"insert into storage.objects (bucket_id, name) values ('uploads-private', ?)", other + "/posts/x.jpg")))
				.rootCause().hasMessageContaining("row-level security");
		List<String> visible = db.as(admin, j -> j.queryForList("select name from storage.objects", String.class));
		assertThat(visible).contains(ownPath).doesNotContain(otherPath);
	}

	@Test
	@DisplayName("BR-001-07 DB の遷移表は共通テストケース（fixtures/post-status.json）と一致する")
	void transitionTableMatchesFixture() {
		JsonNode fixture = JsonMapper.builder().build().readTree(Path.of("../docs/model/fixtures/post-status.json").toFile());
		Set<String> expected = new HashSet<>();
		fixture.get("transitions").properties().forEach(e -> e.getValue().forEach(to -> expected.add(e.getKey() + "->" + to.asString())));

		List<String> actual = jdbc.queryForList(
				"select distinct from_status || '->' || to_status from post_status_transitions where from_status <> 'NEW'", String.class);

		assertThat(new HashSet<>(actual)).isEqualTo(expected);
	}

	private UUID record(String username) {
		UUID connection = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList(RECORD, connection, tenant, admin.memberId(), "1784" + username, username, "AAAA", IV_12_BYTES));
		return connection;
	}
}
