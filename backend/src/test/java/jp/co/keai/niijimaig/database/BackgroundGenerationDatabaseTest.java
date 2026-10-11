package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import org.testcontainers.postgresql.PostgreSQLContainer;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 生成した背景を背景写真にする記録と、帯の色7色の保存を DB で確かめる（REQ-006 設計 4・5章、V11）。
 * record_generated_background は API関数と同じ service role で呼ぶ。色は docs/model/fixtures/accent-colors.json を TS・Java と共有する（ADR-0005）
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class BackgroundGenerationDatabaseTest extends DraftDatabaseSupport {

	static final String RECORD = "select public.record_generated_background(?, ?, ?, ?, ?, ?)";
	static final String ADOPT_MESSAGE = "候補の参照が正しくありません";
	/** 背景写真が30枚に達している（API関数は文言ではなくこの SQLSTATE で判別する。「競合」の意味） */
	static final String LIMIT_REACHED = "P0409";

	@Autowired PostgreSQLContainer postgres;

	// ───────── 下ごしらえ ─────────

	private String newPath() {
		return tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg";
	}

	/** 成功した背景・イラストの画像生成（候補4枚） */
	private UUID illustration() {
		return recordImageGeneration(tenant, editor.memberId(), "ILLUSTRATION", "SUCCEEDED", 4);
	}

	private UUID recordBackground(UUID generation, int position, String description) {
		return recordBackground(tenant, editor.memberId(), newPath(), generation, position, description);
	}

	private UUID recordBackground(UUID forTenant, UUID member, String path, UUID generation, Integer position, String description) {
		return db.asServiceRole(j -> j.queryForObject(RECORD, UUID.class, forTenant, member, path, generation, position, description));
	}

	private int photoCount() {
		return jdbc.queryForObject("select count(*) from background_photos where tenant_id = ?", Integer.class, tenant);
	}

	private int adoptionCount() {
		return jdbc.queryForObject("select count(*) from background_photo_adoptions a join background_photos b on b.id = a.background_photo_id where b.tenant_id = ?",
				Integer.class, tenant);
	}

	private int usableCount() {
		return jdbc.queryForObject("select count(*) from usable_background_photos where tenant_id = ?", Integer.class, tenant);
	}

	private LoggedIn outsider() {
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		return db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");
	}

	private void asAnon(Consumer<JdbcTemplate> work) {
		tx.execute(status -> {
			jdbc.execute("set local role anon");
			work.accept(jdbc);
			return null;
		});
	}

	private static JsonNode accentFixture() {
		return JsonMapper.builder().build().readTree(Path.of("../docs/model/fixtures/accent-colors.json").toFile());
	}

	private static List<String> codes(String field) {
		List<String> list = new ArrayList<>();
		accentFixture().get(field).forEach(c -> list.add(c.isString() ? c.asString() : c.get("code").asString()));
		return list;
	}

	// ───────── 帯の色7色 ─────────

	@Test
	@DisplayName("AC-006-01 NFR-006-02 7コードすべて（accent-colors.json）で save_post_revision が成功して保存した色のコードのまま読め、7色以外（黄 YELLOW など）は 22023")
	void allSevenAccentCodesAreSavedAndOthersRejected() {
		configureStyle();
		List<String> colors = codes("colors");
		assertThat(colors).hasSize(7);

		for (String code : colors) {
			String coverWithCode = cover("").replace("\"accent\":\"RED\"", "\"accent\":\"" + code + "\"");
			UUID post = save(editor, template("niijima@1", "", coverWithCode, body("説明", "[]", null), closing()));
			assertThat(jdbc.queryForObject("select c.accent from cover_slides c join post_slides s on s.id = c.slide_id where s.revision_id = ?",
					String.class, latestRevision(post))).as(code).isEqualTo(code);
		}
		for (String unknown : codes("unknownCodes")) {
			String bad = cover("").replace("\"accent\":\"RED\"", "\"accent\":\"" + unknown + "\"");
			assertRejected(() -> save(editor, template("niijima@1", "", bad, body("説明", "[]", null), closing())), "22023", "アクセント色");
		}
	}

	@Test
	@DisplayName("AC-006-01 app.is_accent_code は7コードだけ true（null は false）。cover_slides.accent の CHECK も同じ関数で守る")
	void accentCheckConstraintUsesTheSameFunction() {
		for (String code : codes("colors")) {
			assertThat(jdbc.queryForObject("select app.is_accent_code(?)", Boolean.class, code)).as(code).isTrue();
		}
		for (String unknown : codes("unknownCodes")) {
			assertThat(jdbc.queryForObject("select app.is_accent_code(?)", Boolean.class, unknown)).as(unknown).isFalse();
		}
		assertThat(jdbc.queryForObject("select app.is_accent_code(null)", Boolean.class)).isFalse();
		assertThat(jdbc.queryForObject("select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'cover_slides'::regclass and conname = 'cover_slides_accent_check'",
				String.class)).contains("is_accent_code");

		configureStyle();
		UUID revision = latestRevision(save(editor, simpleTemplate()));
		UUID extraSlide = jdbc.queryForObject("insert into post_slides (revision_id, position, role) values (?, 9, 'COVER') returning id", UUID.class, revision);
		String insert = "insert into cover_slides (slide_id, target, keyword, annotation, closing_words, accent) values (?, 'a', 'b', '', 'c', ?)";

		assertRejected(() -> jdbc.update(insert, extraSlide, "YELLOW"), "23514", "cover_slides_accent_check");
		assertThat(jdbc.update(insert, extraSlide, "PINK")).isEqualTo(1);
	}

	// ───────── 生成した背景を背景写真として記録する ─────────

	@Test
	@DisplayName("AC-006-04 AC-006-09 生成した背景を背景写真として記録でき（編集者のメンバーの操作）、出どころは採用の記録から導かれて一覧に出る。登録した写真は AI が作った背景ではない")
	void generatedBackgroundIsRecordedAsPhoto() {
		UUID registered = registerPhoto("正門");
		UUID generation = illustration();
		String path = newPath();

		UUID id = recordBackground(tenant, editor.memberId(), path, generation, 2, "夕暮れの京都御苑、やわらかい光");

		Map<String, Object> photo = jdbc.queryForMap("select * from background_photos where id = ?", id);
		assertThat(photo).containsEntry("tenant_id", tenant).containsEntry("storage_path", path)
				.containsEntry("description", "夕暮れの京都御苑、やわらかい光").containsEntry("registered_by", editor.memberId());
		Map<String, Object> adoption = jdbc.queryForMap("select * from background_photo_adoptions where background_photo_id = ?", id);
		assertThat(adoption).containsEntry("generation_id", generation).containsEntry("candidate_position", 2).containsEntry("adopted_by", editor.memberId());
		assertThat(adoption.get("adopted_at")).isNotNull();
		List<Map<String, Object>> usable = db.as(editor, j -> j.queryForList("select id, generated from usable_background_photos where tenant_id = ? order by registered_at", tenant));
		assertThat(usable).extracting(row -> row.get("id")).containsExactly(registered, id);
		assertThat(usable).extracting(row -> row.get("generated")).containsExactly(false, true);
	}

	@Test
	@DisplayName("AC-006-04 usable_background_photos は background_photos の列の並びを変えず、最後に generated（採用の記録があるか）を足す")
	void usableViewKeepsColumnOrderAndAddsGenerated() {
		String columns = "select column_name from information_schema.columns where table_schema = current_schema() and table_name = ? order by ordinal_position";

		List<String> base = jdbc.queryForList(columns, String.class, "background_photos");
		List<String> view = jdbc.queryForList(columns, String.class, "usable_background_photos");

		List<String> expected = new ArrayList<>(base);
		expected.add("generated");
		assertThat(view).isEqualTo(expected);
	}

	@Test
	@DisplayName("AC-006-10 他団体・存在しない画像生成、失敗した画像生成、位置が候補の数を超える（0・5・候補2枚の3）は採用できず、背景写真は増えない。他団体のメンバー・存在しない団体は見つからない")
	void unadoptableCandidatesAreRejected() {
		UUID twoCandidates = recordImageGeneration(tenant, editor.memberId(), "ILLUSTRATION", "SUCCEEDED", 2);
		UUID failed = recordImageGeneration(tenant, editor.memberId(), "ILLUSTRATION", "FAILED", 0);
		UUID fourCandidates = illustration();
		LoggedIn outsider = outsider();
		UUID otherTenant = jdbc.queryForObject("select tenant_id from members where id = ?", UUID.class, outsider.memberId());
		UUID foreign = recordImageGeneration(otherTenant, outsider.memberId(), "ILLUSTRATION", "SUCCEEDED", 4);

		assertRejected(() -> recordBackground(foreign, 1, "x"), "22023", ADOPT_MESSAGE);
		assertRejected(() -> recordBackground(UUID.randomUUID(), 1, "x"), "22023", ADOPT_MESSAGE);
		assertRejected(() -> recordBackground(failed, 1, "x"), "22023", ADOPT_MESSAGE);
		assertRejected(() -> recordBackground(twoCandidates, 3, "x"), "22023", ADOPT_MESSAGE);
		assertRejected(() -> recordBackground(fourCandidates, 0, "x"), "22023", ADOPT_MESSAGE);
		assertRejected(() -> recordBackground(fourCandidates, 5, "x"), "22023", ADOPT_MESSAGE);
		assertRejected(() -> recordBackground(tenant, editor.memberId(), newPath(), fourCandidates, null, "x"), "22023", ADOPT_MESSAGE);
		assertRejected(() -> recordBackground(tenant, outsider.memberId(), newPath(), fourCandidates, 1, "x"), "P0404", "メンバー");
		assertRejected(() -> recordBackground(UUID.randomUUID(), editor.memberId(), newPath(), fourCandidates, 1, "x"), "P0404", "団体");
		assertThat(photoCount()).isZero();
		assertThat(adoptionCount()).isZero();
		assertThat(jdbc.queryForObject("select count(*) from background_photo_adoptions a join image_generations g on g.id = a.generation_id where g.tenant_id in (?, ?)",
				Integer.class, tenant, otherTenant)).isZero();
	}

	@Test
	@DisplayName("AC-006-10 NFR-006-03 無効化されたメンバーは、背景を背景写真として記録できない（いないのと同じ P0404）。ほかのメンバーは記録できる")
	void deactivatedMemberCannotRecordBackground() {
		UUID generation = illustration();
		db.as(approver, j -> j.queryForList("select public.deactivate_member(?, '卒業')", editor.memberId()));

		assertRejected(() -> recordBackground(tenant, editor.memberId(), newPath(), generation, 1, "x"), "P0404", "メンバー");
		assertThat(photoCount()).isZero();
		assertThat(adoptionCount()).isZero();

		assertThat(recordBackground(tenant, approver.memberId(), newPath(), generation, 1, "x")).isNotNull();
	}

	@Test
	@DisplayName("AC-006-06 写真風の候補は背景写真にできない（背景・イラストだけ）。直接要求しても拒否され、背景写真は増えない")
	void photorealisticCandidateIsRejected() {
		UUID photoreal = recordImageGeneration(tenant, editor.memberId(), "PHOTOREALISTIC", "SUCCEEDED", 4);

		assertRejected(() -> recordBackground(photoreal, 1, "写真風の背景"), "22023", "写真風");
		assertThat(photoCount()).isZero();
		assertThat(adoptionCount()).isZero();
	}

	@Test
	@DisplayName("AC-006-10 同じ候補をもう一度採用しようとすると、新しく作らず既存の背景写真IDを返す（別の候補は別の背景写真）。他団体には返さない")
	void sameCandidateIsNotAdoptedTwiceAndTheExistingPhotoIsReturned() {
		UUID generation = illustration();
		LoggedIn outsider = outsider();
		UUID otherTenant = jdbc.queryForObject("select tenant_id from members where id = ?", UUID.class, outsider.memberId());
		String secondPath = newPath();

		UUID first = recordBackground(generation, 1, "最初");
		UUID again = recordBackground(tenant, approver.memberId(), secondPath, generation, 1, "二回目");
		UUID other = recordBackground(generation, 2, "別の候補");

		assertThat(again).isEqualTo(first);
		assertThat(other).isNotEqualTo(first);
		assertThat(photoCount()).isEqualTo(2);
		assertThat(adoptionCount()).isEqualTo(2);
		assertThat(jdbc.queryForObject("select description from background_photos where id = ?", String.class, first)).isEqualTo("最初");
		assertThat(jdbc.queryForObject("select count(*) from background_photos where storage_path = ?", Integer.class, secondPath)).isZero();
		assertRejected(() -> recordBackground(otherTenant, outsider.memberId(), otherTenant + "/backgrounds/x.jpg", generation, 1, "横取り"),
				"22023", ADOPT_MESSAGE);
	}

	@Test
	@DisplayName("AC-006-10 AC-006-12 すでに採用した背景写真が「使わない」になっているときは、既存のIDを返さず 22023 で拒否する（使わない写真を表紙にできない）。背景写真は増えない")
	void retiredGeneratedBackgroundIsNotReturnedAgain() {
		UUID generation = illustration();
		UUID photo = recordBackground(generation, 1, "夕暮れ");
		assertThat(recordBackground(generation, 1, "二重")).isEqualTo(photo);

		db.as(admin, j -> j.queryForList("select public.retire_background_photo(?)", photo));

		assertRejected(() -> recordBackground(generation, 1, "もう一度"), "22023", "使わない設定");
		assertThat(photoCount()).isEqualTo(1);
		assertThat(adoptionCount()).isEqualTo(1);
		assertThat(usableCount()).isZero();
		assertThat(recordBackground(generation, 2, "別の候補")).isNotEqualTo(photo);
	}

	@Test
	@DisplayName("AC-006-04 BR-006-04 説明文は前後の空白を取り除いてから1〜100文字を数え、取り除いた値を保存する（先頭に空白1つ＋100文字はよい。空白だけは拒否）")
	void descriptionIsTrimmedBeforeCountingAndStoredTrimmed() {
		String hundred = "あ".repeat(100);

		UUID leading = recordBackground(illustration(), 1, " " + hundred);
		UUID trailing = recordBackground(illustration(), 1, hundred + "　");
		UUID both = recordBackground(illustration(), 1, "   夕暮れ の京都　 ");

		assertThat(jdbc.queryForObject("select description from background_photos where id = ?", String.class, leading)).isEqualTo(hundred);
		assertThat(jdbc.queryForObject("select description from background_photos where id = ?", String.class, trailing)).isEqualTo(hundred);
		assertThat(jdbc.queryForObject("select description from background_photos where id = ?", String.class, both)).isEqualTo("夕暮れ の京都");
		UUID tooLong = illustration();
		assertRejected(() -> recordBackground(tooLong, 1, " " + "あ".repeat(101)), "22023", "説明文は1〜100文字");
		for (String blank : new String[] {" ", "   ", "　", "  　 "}) {
			assertRejected(() -> recordBackground(tooLong, 1, blank), "22023", "説明文は1〜100文字");
		}
		assertThat(photoCount()).isEqualTo(3);
	}

	@Test
	@DisplayName("AC-006-04 app.is_background_description は改行・制御文字・U+2028/2029 を含まない文字列だけ true。background_photos.description の CHECK は not valid（既存の行を検査せず、新しい行だけを検査する）")
	void descriptionRuleHasOneHomeAndTheCheckIsNotValid() {
		for (String good : new String[] {"夕暮れの京都", "a b　c", "😀"}) {
			assertThat(jdbc.queryForObject("select app.is_background_description(?)", Boolean.class, good)).as(good).isTrue();
		}
		for (String bad : new String[] {"a\nb", "a\tb", "a" + (char) 0x007f + "b", "a" + (char) 0x0085 + "b", "a" + (char) 0x2028 + "b", "a" + (char) 0x2029 + "b"}) {
			assertThat(jdbc.queryForObject("select app.is_background_description(?)", Boolean.class, bad)).as(bad).isFalse();
		}
		assertThat(jdbc.queryForObject("select app.is_background_description(null)", Boolean.class)).isFalse();
		Map<String, Object> constraint = jdbc.queryForMap("select convalidated, pg_get_constraintdef(oid) as definition from pg_constraint "
				+ "where conrelid = 'background_photos'::regclass and conname = 'background_photos_description_form'");
		assertThat(constraint.get("convalidated")).isEqualTo(false);
		assertThat((String) constraint.get("definition")).contains("is_background_description");

		String insert = "insert into background_photos (tenant_id, storage_path, description, registered_by) values (?, ?, ?, ?)";
		assertRejected(() -> jdbc.update(insert, tenant, newPath(), "a\nb", admin.memberId()), "23514", "background_photos_description_form");
		assertThat(jdbc.update(insert, tenant, newPath(), "夕暮れ", admin.memberId())).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-006-04 BR-006-04 説明文は1〜100文字（1文字・100文字・絵文字100個はよい。0・101文字・null・改行・タブ・制御文字・行区切りは拒否）")
	void descriptionShapeIsChecked() {
		String length = "説明文は1〜100文字";
		String control = "改行や制御文字";
		UUID rejectedHere = illustration();

		for (String bad : new String[] {"", "あ".repeat(101), "😀".repeat(101)}) {
			assertRejected(() -> recordBackground(rejectedHere, 1, bad), "22023", length);
		}
		assertRejected(() -> recordBackground(rejectedHere, 1, null), "22023", length);
		List<String> withControl = List.of("a\nb", "a\r\nb", "a\tb", "a" + (char) 0x0001 + "b", "a" + (char) 0x001f + "b", "a" + (char) 0x007f + "b",
				"a" + (char) 0x0085 + "b", "a" + (char) 0x2028 + "b", "a" + (char) 0x2029 + "b", "\n");
		for (String bad : withControl) {
			assertRejected(() -> recordBackground(rejectedHere, 1, bad), "22023", control);
		}
		assertThat(photoCount()).isZero();

		assertThat(recordBackground(illustration(), 1, "あ")).isNotNull();
		assertThat(recordBackground(illustration(), 1, "あ".repeat(100))).isNotNull();
		assertThat(recordBackground(illustration(), 1, "😀".repeat(100))).isNotNull();
		assertThat(recordBackground(illustration(), 1, "夕暮れの京都御苑 やわらかい光　全角空白")).isNotNull();
		assertThat(photoCount()).isEqualTo(4);
	}

	@Test
	@DisplayName("AC-006-10 保存先は {団体}/backgrounds/{英数字・_・-}.jpg の形だけ。すでにある保存先は 22023 で拒否され、採用の記録も残らない")
	void storagePathShapeIsChecked() {
		UUID generation = illustration();
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());

		for (String bad : new String[] {otherTenant + "/backgrounds/a.jpg", tenant + "/posts/a.jpg", tenant + "/candidates/x/1.jpg",
				tenant + "/backgrounds/../posts/a.jpg", tenant + "/backgrounds/a.png", tenant + "/backgrounds/a b.jpg", tenant + "/backgrounds/a/b.jpg",
				tenant + "/backgrounds/.jpg", "a.jpg", ""}) {
			assertRejected(() -> recordBackground(tenant, editor.memberId(), bad, generation, 1, "x"), "42501", "保存先");
		}
		assertRejected(() -> recordBackground(tenant, editor.memberId(), null, generation, 1, "x"), "42501", "保存先");
		assertThat(photoCount()).isZero();

		String path = tenant + "/backgrounds/abc_DEF-123.jpg";
		recordBackground(tenant, editor.memberId(), path, generation, 1, "最初");
		assertRejected(() -> recordBackground(tenant, editor.memberId(), path, generation, 2, "同じ保存先"), "22023", "保存先");
		assertThat(photoCount()).isEqualTo(1);
		assertThat(adoptionCount()).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-006-07 NFR-006-04 背景写真は30枚まで（AI が作った背景も数える）。29枚なら登録でき30枚になり、30枚なら拒否。「使わない」写真は数えず、すでに採用した候補は30枚でも既存の写真を返す")
	void thirtyPhotoLimitCountsGeneratedBackgroundsToo() {
		List<UUID> registered = new ArrayList<>();
		for (int i = 1; i <= 29; i++) {
			registered.add(registerPhoto("写真" + i));
		}
		UUID generation = illustration();

		UUID thirtieth = recordBackground(generation, 1, "30枚目");

		assertThat(usableCount()).isEqualTo(30);
		// 30枚は SQLSTATE（P0409）で判別できる。説明文・候補・写真風などの拒否（22023）とは別
		assertRejected(() -> recordBackground(generation, 2, "31枚目"), LIMIT_REACHED, "30枚");
		assertRejected(() -> registerPhoto("管理者の31枚目"), "22023", "30枚");
		assertThat(usableCount()).isEqualTo(30);
		assertThat(recordBackground(generation, 1, "二重")).isEqualTo(thirtieth);

		db.as(admin, j -> j.queryForList("select public.retire_background_photo(?)", registered.get(0)));
		assertThat(usableCount()).isEqualTo(29);
		assertThat(recordBackground(generation, 2, "31枚目だった写真")).isNotNull();
		assertThat(usableCount()).isEqualTo(30);
		assertThat(photoCount()).isEqualTo(31);
	}

	/** 同時に記録した1件の結果: 背景写真ID（成功）か SQLSTATE（拒否） */
	private record Outcome(UUID photo, String sqlState) {
	}

	/**
	 * 候補（画像生成と位置）ごとに別の接続を開き、CyclicBarrier で開始をそろえて同時に記録する。
	 * 接続プール（最大3）では同時に動かせないので、コンテナへ直接つなぐ。SQLSTATE を返す
	 */
	private List<Outcome> recordAtTheSameTime(List<UUID> generations, List<Integer> positions) throws Exception {
		int n = positions.size();
		CyclicBarrier start = new CyclicBarrier(n);
		ExecutorService pool = Executors.newFixedThreadPool(n);
		List<Connection> connections = new ArrayList<>();
		try {
			List<Future<Outcome>> futures = new ArrayList<>();
			for (int i = 0; i < n; i++) {
				Connection connection = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
				connections.add(connection);
				UUID generation = generations.get(i);
				int position = positions.get(i);
				String path = newPath();
				futures.add(pool.submit(() -> recordOn(connection, start, generation, position, path)));
			}
			List<Outcome> outcomes = new ArrayList<>();
			for (Future<Outcome> future : futures) {
				outcomes.add(future.get(60, TimeUnit.SECONDS));
			}
			return outcomes;
		} finally {
			pool.shutdownNow();
			for (Connection connection : connections) {
				connection.close();
			}
		}
	}

	private Outcome recordOn(Connection connection, CyclicBarrier start, UUID generation, int position, String path) throws Exception {
		connection.setAutoCommit(false);
		try (Statement role = connection.createStatement()) {
			role.execute("set local role service_role");
		}
		start.await(30, TimeUnit.SECONDS);
		try (PreparedStatement statement = connection.prepareStatement(RECORD)) {
			statement.setObject(1, tenant);
			statement.setObject(2, editor.memberId());
			statement.setString(3, path);
			statement.setObject(4, generation);
			statement.setInt(5, position);
			statement.setString(6, "同時" + position);
			try (ResultSet result = statement.executeQuery()) {
				result.next();
				UUID photo = result.getObject(1, UUID.class);
				connection.commit();
				return new Outcome(photo, null);
			}
		} catch (SQLException e) {
			connection.rollback();
			return new Outcome(null, e.getSQLState());
		}
	}

	@Test
	@DisplayName("NFR-006-04 同時に2人が29枚目から登録しても30枚を超えない（別の接続の8件を開始をそろえて記録しても、28枚から成功するのは2件だけで、残りは P0409）")
	void concurrentRecordingNeverExceedsThirtyPhotos() throws Exception {
		for (int i = 1; i <= 28; i++) {
			registerPhoto("写真" + i);
		}
		UUID first = illustration();
		UUID second = illustration();

		List<Outcome> outcomes = recordAtTheSameTime(
				List.of(first, first, first, first, second, second, second, second), List.of(1, 2, 3, 4, 1, 2, 3, 4));

		assertThat(outcomes.stream().filter(o -> o.photo() != null)).hasSize(2);
		assertThat(outcomes.stream().filter(o -> o.photo() == null)).hasSize(6).allSatisfy(o -> assertThat(o.sqlState()).isEqualTo(LIMIT_REACHED));
		assertThat(usableCount()).isEqualTo(30);
		assertThat(photoCount()).isEqualTo(30);
		assertThat(adoptionCount()).isEqualTo(2);
	}

	@Test
	@DisplayName("AC-006-10 NFR-006-04 同じ候補を同時に採用すると、全員が同じ背景写真IDを受け取り（23505 にならず）、背景写真は1枚だけ増える。29枚あって1枚の空きを取り合っても同じ")
	void sameCandidateAdoptedAtTheSameTimeGivesEveryoneTheSamePhoto() throws Exception {
		for (int i = 1; i <= 29; i++) {
			registerPhoto("写真" + i);
		}
		UUID generation = illustration();

		List<Outcome> outcomes = recordAtTheSameTime(Collections.nCopies(8, generation), Collections.nCopies(8, 1));

		assertThat(outcomes).extracting(Outcome::sqlState).containsOnlyNulls();
		assertThat(outcomes.stream().map(Outcome::photo).distinct()).hasSize(1);
		assertThat(usableCount()).isEqualTo(30);
		assertThat(photoCount()).isEqualTo(30);
		assertThat(adoptionCount()).isEqualTo(1);
	}

	// ───────── 権限・RLS・追記のみ ─────────

	@Test
	@DisplayName("NFR-006-03 record_generated_background を呼べるのは service role だけ。authenticated（管理者・承認者・編集者）と anon は呼べない。背景写真の登録は管理者だけのまま")
	void recordGeneratedBackgroundIsServiceRoleOnly() {
		UUID generation = illustration();

		for (LoggedIn user : List.of(admin, approver, editor)) {
			assertRejected(() -> db.as(user, j -> j.queryForObject(RECORD, UUID.class, tenant, user.memberId(), newPath(), generation, 1, "x")),
					"42501", "permission denied");
		}
		assertRejected(() -> asAnon(j -> j.queryForObject(RECORD, UUID.class, tenant, editor.memberId(), newPath(), generation, 1, "x")),
				"42501", "permission denied");
		for (LoggedIn user : List.of(editor, approver)) {
			assertRejected(() -> db.as(user, j -> j.queryForObject("select public.register_background_photo(?, 'x')", UUID.class, newPath())),
					"42501", "権限がありません");
		}
		assertThat(photoCount()).isZero();
	}

	@Test
	@DisplayName("NFR-006-03 AC-006-10 background_photo_adoptions は追記のみ（更新・削除は拒否）。画面のロールからは書けず、同じ候補・範囲外の位置は表の制約でも拒否")
	void adoptionsAreAppendOnlyAndNotWritableFromClients() {
		UUID generation = illustration();
		UUID id = recordBackground(generation, 1, "夕暮れ");
		UUID anotherPhoto = registerPhoto("別の写真");

		assertRejected(() -> jdbc.update("update background_photo_adoptions set candidate_position = 2 where background_photo_id = ?", id), "P0405", "append-only");
		assertRejected(() -> jdbc.update("delete from background_photo_adoptions where background_photo_id = ?", id), "P0405", "append-only");
		assertRejected(() -> jdbc.update("insert into background_photo_adoptions (background_photo_id, generation_id, candidate_position, adopted_by) values (?, ?, 1, ?)",
				anotherPhoto, generation, editor.memberId()), "23505", "duplicate key");
		assertRejected(() -> jdbc.update("insert into background_photo_adoptions (background_photo_id, generation_id, candidate_position, adopted_by) values (?, ?, 5, ?)",
				anotherPhoto, generation, editor.memberId()), "23514", "candidate_position");
		for (LoggedIn user : List.of(admin, editor)) {
			assertRejected(() -> db.as(user, j -> j.update("insert into background_photo_adoptions (background_photo_id, generation_id, candidate_position, adopted_by) values (?, ?, 3, ?)",
					anotherPhoto, generation, user.memberId())), "42501", "permission denied");
			assertRejected(() -> db.as(user, j -> j.update("update background_photo_adoptions set candidate_position = 2 where background_photo_id = ?", id)),
					"42501", "permission denied");
			assertRejected(() -> db.as(user, j -> j.update("delete from background_photo_adoptions where background_photo_id = ?", id)),
					"42501", "permission denied");
		}
		assertThat(adoptionCount()).isEqualTo(1);
	}

	@Test
	@DisplayName("NFR-006-03 AC-006-09 background_photo_adoptions は同団体のメンバーだけが読め、他団体のメンバーと anon は読めない。使っている背景写真のビューも他団体には見えない")
	void adoptionsAreReadableOnlyByTheSameTenant() {
		UUID id = recordBackground(illustration(), 1, "夕暮れ");
		LoggedIn outsider = outsider();

		for (LoggedIn user : List.of(admin, approver, editor)) {
			assertThat(db.<Integer>as(user, j -> j.queryForObject("select count(*) from background_photo_adoptions where background_photo_id = ?", Integer.class, id)))
					.as(user.email()).isEqualTo(1);
		}
		assertThat(db.<Integer>as(outsider, j -> j.queryForObject("select count(*) from background_photo_adoptions", Integer.class))).isZero();
		assertThat(db.<Integer>as(outsider, j -> j.queryForObject("select count(*) from usable_background_photos where id = ?", Integer.class, id))).isZero();
		assertRejected(() -> asAnon(j -> j.queryForObject("select count(*) from background_photo_adoptions", Integer.class)), "42501", "permission denied");
		assertRejected(() -> asAnon(j -> j.queryForObject("select count(*) from usable_background_photos", Integer.class)), "42501", "permission denied");
	}

	// ───────── 使う・使わない ─────────

	@Test
	@DisplayName("AC-006-11 AC-006-13 編集者が AI が作った背景を表紙の背景にして保存でき、AI生成の表示の元になる生成画像には数えられない（背景・イラスト）")
	void generatedBackgroundCanBeUsedOnTheCoverWithoutAiDisclosure() {
		configureStyle();
		UUID photo = recordBackground(illustration(), 1, "夕暮れの京都御苑");

		UUID post = save(editor, template("niijima@1", "", cover(",\"backgroundPhotoId\":\"" + photo + "\""), body("説明", "[]", null), closing()));

		assertThat(jdbc.queryForObject("select count(*) from cover_backgrounds cb join post_slides s on s.id = cb.slide_id where s.revision_id = ? and cb.background_photo_id = ?",
				Integer.class, latestRevision(post), photo)).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from revision_generated_styles where revision_id = ?", Integer.class, latestRevision(post))).isZero();
	}

	@Test
	@DisplayName("AC-006-12 AI が作った背景を管理者が「使わない」にしても、候補から外れるだけで、採用の記録と使っている投稿の cover_backgrounds は残り画像化に使える")
	void retiringGeneratedBackgroundKeepsItUsableForExistingPosts() {
		configureStyle();
		UUID generation = illustration();
		String path = newPath();
		UUID photo = recordBackground(tenant, editor.memberId(), path, generation, 3, "夕暮れの京都御苑");
		UUID post = save(editor, template("niijima@1", "", cover(",\"backgroundPhotoId\":\"" + photo + "\""), body("説明", "[]", null), closing()));

		db.as(admin, j -> j.queryForList("select public.retire_background_photo(?)", photo));

		assertThat(db.<List<UUID>>as(editor, j -> j.queryForList("select id from usable_background_photos where tenant_id = ?", UUID.class, tenant))).doesNotContain(photo);
		assertThat(jdbc.queryForObject("select count(*) from background_photos where id = ?", Integer.class, photo)).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from background_photo_adoptions where background_photo_id = ?", Integer.class, photo)).isEqualTo(1);
		assertThat(jdbc.queryForObject("select b.storage_path from cover_backgrounds cb join post_slides s on s.id = cb.slide_id "
				+ "join background_photos b on b.id = cb.background_photo_id where s.revision_id = ?", String.class, latestRevision(post))).isEqualTo(path);
		assertThat(usableCount()).isZero();
	}
}
