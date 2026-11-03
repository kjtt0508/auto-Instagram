package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/** 最後のスライドの画像（投稿の型の設定の版が持つ post_style_closing_images と、save_post_style_settings の検査）を DB で確かめる（REQ-007 設計 4・5章、V12） */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class ClosingImagesDatabaseTest extends DraftDatabaseSupport {

	private static final String SAVE_WITH_IMAGES =
			"select public.save_post_style_settings('帯', '{対象A,対象B}'::text[], '最後まで', '紹介', '---\nフッター', '{#固定}'::text[], null, ?::text[])";

	private int styleVersionCount() {
		return jdbc.queryForObject("select count(*) from post_style_settings where tenant_id = ?", Integer.class, tenant);
	}

	/** 画面を通さず直接要求したとき、拒否されて新しい版ができないことを確かめる */
	private void assertRefused(LoggedIn user, String arrayLiteral, String sqlState, String message) {
		int before = styleVersionCount();
		assertRejected(() -> db.as(user, j -> j.queryForObject(SAVE_WITH_IMAGES, Integer.class, arrayLiteral)), sqlState, message);
		assertThat(styleVersionCount()).as("新しい版はできない").isEqualTo(before);
	}

	@Test
	@DisplayName("AC-007-04 保存すると新しい版に画像が並べる順（1, 2）で入る。1枚目を外す・選び直す・2枚とも外すと、それぞれ新しい版の画像が変わり、前の版は変わらない")
	void eachSaveIsANewVersionAndPreviousVersionsStay() {
		String a = closingPath("a");
		String b = closingPath("b");
		String c = closingPath("c");

		int v1 = saveStyleWithClosingImages(admin, a, b);
		int v2 = saveStyleWithClosingImages(admin, b);
		int v3 = saveStyleWithClosingImages(admin, c, b);
		int v4 = saveStyleWithClosingImages(admin);

		assertThat(List.of(v1, v2, v3, v4)).containsExactly(1, 2, 3, 4);
		assertThat(closingImagesOfVersion(v1)).containsExactly(a, b);
		assertThat(closingImagesOfVersion(v2)).containsExactly(b);
		assertThat(closingImagesOfVersion(v3)).containsExactly(c, b);
		assertThat(closingImagesOfVersion(v4)).isEmpty();
		assertThat(jdbc.queryForList("""
				select c.position from post_style_closing_images c join post_style_settings s on s.id = c.style_settings_id
				 where s.tenant_id = ? and s.version = 1 order by c.position
				""", Integer.class, tenant)).containsExactly(1, 2);
	}

	@Test
	@DisplayName("AC-007-04 画像を設定していない版（古い画面の呼び方・default の引数）は画像0枚。保存の関数は署名が1つだけ")
	void savingWithoutImagesMakesAVersionWithoutImages() {
		configureStyle();

		assertThat(styleVersionCount()).isEqualTo(1);
		assertThat(closingImagesOfVersion(1)).isEmpty();
		assertThat(jdbc.queryForObject("""
				select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				 where n.nspname = 'public' and p.proname = 'save_post_style_settings'
				""", Integer.class)).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-007-06 AC-007-07 投稿の版は、下書きを保存した時点の最新の設定の版を使う。あとで設定の画像を変えても、保存し直すまでその版は元の画像のまま")
	void aRevisionKeepsTheClosingImagesOfTheVersionItWasSavedWith() {
		String imageA = closingPath("a");
		String imageB = closingPath("b");
		saveStyleWithClosingImages(admin, imageA);
		UUID post = save(editor, simpleTemplate());
		UUID first = latestRevision(post);
		saveStyleWithClosingImages(admin, imageB);

		UUID second = saveAgain(editor, post, simpleTemplate());

		assertThat(revisionClosingImages(first)).containsExactly(imageA);
		assertThat(revisionClosingImages(second)).containsExactly(imageB);
	}

	private List<String> revisionClosingImages(UUID revision) {
		return jdbc.queryForList("""
				select c.storage_path from revision_templates t join post_style_closing_images c on c.style_settings_id = t.style_settings_id
				 where t.revision_id = ? order by c.position
				""", String.class, revision);
	}

	@Test
	@DisplayName("AC-007-11 編集者・承認者は最後のスライドの画像を保存できない。他団体の管理者は、自団体の設定にしか保存できず、この団体の保存先は指せない")
	void onlyAnAdminOfTheOwnTenantCanSave() {
		configureStyle();
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");
		String own = arrayLiteral(closingPath("a"));

		assertRefused(editor, own, "42501", "権限がありません");
		assertRefused(approver, own, "42501", "権限がありません");
		assertRefused(outsider, own, "42501", "最後のスライドの画像の保存先が正しくありません");
		assertThat(jdbc.queryForObject("select count(*) from post_style_settings where tenant_id = ?", Integer.class, otherTenant)).isZero();
		assertThat(jdbc.queryForObject("select count(*) from post_style_closing_images c join post_style_settings s on s.id = c.style_settings_id where s.tenant_id in (?, ?)",
				Integer.class, tenant, otherTenant)).isZero();
	}

	@Test
	@DisplayName("AC-007-12 画面を通さない要求は、3枚・null・null の要素・重複・次元違いを 22023 で、他団体の保存先・.png や .gif・style/ 以外・../ を 42501 で拒否し、新しい版を作らない")
	void invalidRequestsAreRefused() {
		configureStyle();
		String a = closingPath("a");
		String b = closingPath("b");

		assertRefused(admin, arrayLiteral(a, b, closingPath("c")), "22023", "2枚まで");
		assertRefused(admin, arrayLiteral(a, a), "22023", "重ねられません");
		assertRefused(admin, arrayLiteral(a, null), "22023", "指定が正しくありません");
		assertRefused(admin, "{{\"" + a + "\"},{\"" + b + "\"}}", "22023", "指定が正しくありません");
		assertRefused(admin, null, "22023", "指定が正しくありません");

		String foreign = UUID.randomUUID() + "/style/x.jpg";
		for (String bad : List.of(foreign, tenant + "/style/x.png", tenant + "/style/x.gif", tenant + "/posts/x.jpg", tenant + "/backgrounds/x.jpg",
				tenant + "/style/../posts/x.jpg", tenant + "/style/", tenant + "/style/.jpg", tenant + "/style/a b.jpg", tenant + "/style/x.jpg/y", "x.jpg")) {
			assertRefused(admin, arrayLiteral(bad), "42501", "保存先が正しくありません");
			assertRefused(admin, arrayLiteral(a, bad), "42501", "保存先が正しくありません");
		}
		assertThat(styleVersionCount()).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-007-12 重複は insert の前に検査して 22023 にする（23505 にしない）。直接書いても、同じ順・同じ保存先・3枚目は表の制約で拒否される")
	void tableConstraintsBackTheRpcChecks() {
		saveStyleWithClosingImages(admin, closingPath("a"), closingPath("b"));
		long settings = jdbc.queryForObject("select id from post_style_settings where tenant_id = ? and version = 1", Long.class, tenant);

		assertRejected(() -> jdbc.update("insert into post_style_closing_images (style_settings_id, position, storage_path) values (?, 1, ?)", settings, closingPath("c")),
				"23505", "post_style_closing_images");
		assertRejected(() -> jdbc.update("insert into post_style_closing_images (style_settings_id, position, storage_path) values (?, 3, ?)", settings, closingPath("c")),
				"23514", "post_style_closing_images");
		assertRejected(() -> jdbc.update("insert into post_style_closing_images (style_settings_id, position, storage_path) values (?, 0, ?)", settings, closingPath("c")),
				"23514", "post_style_closing_images");
		assertRejected(() -> jdbc.update("insert into post_style_closing_images (style_settings_id, position, storage_path) values (?, 2, '')", settings),
				"23514", "post_style_closing_images");
		assertThat(closingImagesOfVersion(1)).containsExactly(closingPath("a"), closingPath("b"));
	}

	@Test
	@DisplayName("NFR-007-02 最後のスライドの画像の行は自団体のメンバーだけが読め、画面（管理者を含む）からは書き換えられない。追記のみ")
	void closingImagesAreIsolatedByTenantAndAppendOnly() {
		saveStyleWithClosingImages(admin, closingPath("a"), closingPath("b"));
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");
		long settings = jdbc.queryForObject("select id from post_style_settings where tenant_id = ? and version = 1", Long.class, tenant);
		String count = "select count(*) from post_style_closing_images where style_settings_id = ?";

		for (LoggedIn member : List.of(admin, approver, editor)) {
			assertThat(db.<Integer>as(member, j -> j.queryForObject(count, Integer.class, settings))).isEqualTo(2);
		}
		assertThat(db.<Integer>as(outsider, j -> j.queryForObject(count, Integer.class, settings))).isZero();
		assertRejected(() -> db.as(admin, j -> j.update("insert into post_style_closing_images (style_settings_id, position, storage_path) values (?, 1, ?)",
				settings, closingPath("z"))), "42501", "permission denied");
		assertRejected(() -> db.as(admin, j -> j.update("update post_style_closing_images set storage_path = 'x' where style_settings_id = ?", settings)),
				"42501", "permission denied");
		assertRejected(() -> db.as(admin, j -> j.update("delete from post_style_closing_images where style_settings_id = ?", settings)),
				"42501", "permission denied");
		assertRejected(() -> jdbc.update("update post_style_closing_images set storage_path = 'x' where style_settings_id = ?", settings), "P0405", "append-only");
		assertRejected(() -> jdbc.update("delete from post_style_closing_images where style_settings_id = ?", settings), "P0405", "append-only");
		assertThat(closingImagesOfVersion(1)).containsExactly(closingPath("a"), closingPath("b"));
	}

	@Test
	@DisplayName("NFR-007-02 最後のスライドの画像は Storage の style/ の JPEG に置く。置けるのは自団体の管理者だけ、読めるのは自団体のメンバーだけ（ロゴと同じポリシー）")
	void storageStyleFolderAcceptsOnlyTheOwnAdminsJpeg() {
		String own = closingPath(UUID.randomUUID().toString());
		UUID other = db.tenant("他団体-" + UUID.randomUUID());

		db.as(admin, j -> j.update("insert into storage.objects (bucket_id, name) values ('uploads-private', ?)", own));

		assertThat(jdbc.queryForObject("select count(*) from storage.objects where bucket_id = 'uploads-private' and name = ?", Integer.class, own)).isEqualTo(1);
		// 読めるのは自団体のメンバーだけ。他団体のメンバーには見えない
		LoggedIn outsider = db.member(other, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");
		String read = "select count(*) from storage.objects where bucket_id = 'uploads-private' and name = ?";
		assertThat(db.<Integer>as(editor, j -> j.queryForObject(read, Integer.class, own))).isEqualTo(1);
		assertThat(db.<Integer>as(outsider, j -> j.queryForObject(read, Integer.class, own))).isZero();
		for (LoggedIn user : List.of(editor, approver)) {
			assertRejected(() -> db.as(user, j -> j.update("insert into storage.objects (bucket_id, name) values ('uploads-private', ?)",
					closingPath(UUID.randomUUID().toString()))), "42501", "row-level security");
		}
		assertRejected(() -> db.as(admin, j -> j.update("insert into storage.objects (bucket_id, name) values ('uploads-private', ?)",
				other + "/style/" + UUID.randomUUID() + ".jpg")), "42501", "row-level security");
	}
}
