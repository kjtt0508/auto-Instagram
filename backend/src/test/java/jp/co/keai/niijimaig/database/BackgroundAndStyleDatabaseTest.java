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

/** 背景写真・投稿の型の設定（管理者の RPC）と、Storage の書き込みの境界を DB で確かめる（REQ-002 設計 5章、V10） */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class BackgroundAndStyleDatabaseTest extends DraftDatabaseSupport {

	static final String INSERT_OBJECT = "insert into storage.objects (bucket_id, name) values ('uploads-private', ?)";

	@Test
	@DisplayName("AC-002-24 使う背景写真は30枚まで。31枚目は登録できず、使わない写真は数えない")
	void thirtyPhotosLimitCountsOnlyUsablePhotos() {
		List<UUID> photos = new java.util.ArrayList<>();
		for (int i = 1; i <= 30; i++) {
			photos.add(registerPhoto("写真" + i));
		}

		assertRejected(() -> registerPhoto("31枚目"), "22023", "30枚");

		db.as(admin, j -> j.queryForList("select public.retire_background_photo(?)", photos.get(0)));
		UUID thirtyFirst = registerPhoto("31枚目");
		assertThat(thirtyFirst).isNotNull();
		assertThat(jdbc.queryForObject("select count(*) from usable_background_photos where tenant_id = ?", Integer.class, tenant)).isEqualTo(30);
		assertThat(jdbc.queryForObject("select count(*) from background_photos where tenant_id = ?", Integer.class, tenant)).isEqualTo(31);
	}

	@Test
	@DisplayName("AC-002-24 背景写真は消えず「使わない」になる。候補から外れても、使っている版の参照は残る。もう一度使わないにしても何も起きない")
	void retiredPhotoIsKeptAndStillReferenced() {
		configureStyle();
		UUID photo = registerPhoto("正門");
		UUID post = save(editor, template("niijima@1", "", cover(",\"backgroundPhotoId\":\"" + photo + "\""), body("説明", "[]", null), closing()));

		db.as(admin, j -> j.queryForList("select public.retire_background_photo(?)", photo));
		db.as(admin, j -> j.queryForList("select public.retire_background_photo(?)", photo));

		assertThat(jdbc.queryForObject("select count(*) from background_photos where id = ?", Integer.class, photo)).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from background_photo_retirements where background_photo_id = ?", Integer.class, photo)).isEqualTo(1);
		assertThat(db.<List<UUID>>as(editor, j -> j.queryForList("select id from usable_background_photos where tenant_id = ?", UUID.class, tenant))).doesNotContain(photo);
		assertThat(jdbc.queryForObject("select count(*) from cover_backgrounds cb join post_slides s on s.id = cb.slide_id where s.revision_id = ? and cb.background_photo_id = ?",
				Integer.class, latestRevision(post), photo)).isEqualTo(1);
		assertRejected(() -> jdbc.update("delete from background_photos where id = ?", photo), "P0405", "append-only");
	}

	@Test
	@DisplayName("AC-002-24 背景写真を登録・「使わない」にできるのは管理者だけ。保存先は自団体の backgrounds/ の JPEG に限り、説明文は1〜100文字")
	void backgroundPhotoRpcsAreAdminOnlyAndValidated() {
		UUID photo = registerPhoto("正門");
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");

		for (LoggedIn user : List.of(editor, approver)) {
			assertRejected(() -> db.as(user, j -> j.queryForObject("select public.register_background_photo(?, 'x')", UUID.class,
					tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg")), "42501", "権限がありません");
			assertRejected(() -> db.as(user, j -> j.queryForList("select public.retire_background_photo(?)", photo)), "42501", "権限がありません");
		}
		for (String path : List.of(otherTenant + "/backgrounds/a.jpg", tenant + "/posts/a.jpg", tenant + "/backgrounds/../posts/a.jpg", tenant + "/backgrounds/a.png")) {
			assertRejected(() -> db.as(admin, j -> j.queryForObject("select public.register_background_photo(?, 'x')", UUID.class, path)), "42501", "保存先");
		}
		for (String description : List.of("", "あ".repeat(101))) {
			assertRejected(() -> db.as(admin, j -> j.queryForObject("select public.register_background_photo(?, ?)", UUID.class,
					tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg", description)), "22023", "説明文");
		}
		assertThat(db.<UUID>as(admin, j -> j.queryForObject("select public.register_background_photo(?, ?)", UUID.class,
				tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg", "あ".repeat(100)))).isNotNull();
		assertRejected(() -> db.as(outsider, j -> j.queryForList("select public.retire_background_photo(?)", photo)), "P0404", "見つかりません");
	}

	@Test
	@DisplayName("NFR-001-05 背景写真・投稿の型の設定は自団体のメンバーだけが読め、画面から直接は書けない")
	void backgroundAndStyleAreIsolatedByTenant() {
		configureStyle();
		UUID photo = registerPhoto("正門");
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");

		assertThat(db.<Integer>as(editor, j -> j.queryForObject("select count(*) from background_photos where id = ?", Integer.class, photo))).isEqualTo(1);
		assertThat(db.<Integer>as(outsider, j -> j.queryForObject("select count(*) from background_photos where id = ?", Integer.class, photo))).isZero();
		assertThat(db.<Integer>as(editor, j -> j.queryForObject("select count(*) from post_style_settings where tenant_id = ?", Integer.class, tenant))).isEqualTo(1);
		assertThat(db.<Integer>as(outsider, j -> j.queryForObject("select count(*) from post_style_settings where tenant_id = ?", Integer.class, tenant))).isZero();
		assertRejected(() -> db.as(admin, j -> j.update("insert into background_photos (tenant_id, storage_path, description, registered_by) values (?, 'x', 'y', ?)",
				tenant, admin.memberId())), "42501", "permission denied");
	}

	@Test
	@DisplayName("BR-002-17 投稿の型の設定の保存は管理者だけ。保存すると新しい版ができ、前の版は残る。ロゴの保存先は自団体の style/ の PNG に限る")
	void styleSettingsAreVersionedAndAdminOnly() {
		configureStyle();
		String save = "select public.save_post_style_settings('帯2', '{対象C,対象D}'::text[], 'x', 'y', 'z', '{#固定1,#固定2}'::text[], ?)";
		String logo = tenant + "/style/" + UUID.randomUUID() + ".png";

		int second = db.as(admin, j -> j.queryForObject(save, Integer.class, logo));

		assertThat(second).isEqualTo(2);
		assertThat(jdbc.queryForObject("select count(*) from post_style_settings where tenant_id = ?", Integer.class, tenant)).isEqualTo(2);
		assertThat(jdbc.queryForObject("select band_text from post_style_settings_current where tenant_id = ?", String.class, tenant)).isEqualTo("帯2");
		assertThat(jdbc.queryForObject("select l.storage_path from post_style_logos l join post_style_settings_current c on c.id = l.style_settings_id where c.tenant_id = ?",
				String.class, tenant)).isEqualTo(logo);
		assertThat(jdbc.queryForObject("select count(*) from post_style_logos l join post_style_settings s on s.id = l.style_settings_id where s.version = 1 and s.tenant_id = ?",
				Integer.class, tenant)).isZero();
		for (String badLogo : List.of(tenant + "/style/a.jpg", tenant + "/posts/a.png", UUID.randomUUID() + "/style/a.png")) {
			assertRejected(() -> db.as(admin, j -> j.queryForObject(save, Integer.class, badLogo)), "42501", "ロゴの保存先");
		}
		assertRejected(() -> db.as(editor, j -> j.queryForObject(save, Integer.class, (String) null)), "42501", "権限がありません");
		assertRejected(() -> db.as(approver, j -> j.queryForObject(save, Integer.class, (String) null)), "42501", "権限がありません");
		assertRejected(() -> db.as(admin, j -> j.queryForObject("select public.save_post_style_settings('帯', '{}'::text[], 'x', 'y', 'z', '{}'::text[], null)", Integer.class)),
				"22023", "足りない項目");
		assertRejected(() -> db.as(admin, j -> j.queryForObject("select public.save_post_style_settings('帯', '{A}'::text[], 'x', 'y', '', '{}'::text[], null)", Integer.class)),
				"22023", "足りない項目");
		assertRejected(() -> jdbc.update("update post_style_settings set band_text = 'z' where tenant_id = ?", tenant), "P0405", "append-only");
	}

	@Test
	@DisplayName("BR-002-21 Storage: 背景写真（backgrounds/）とロゴ（style/）を置けるのは自団体の管理者だけ。画像化（renders/）は service role だけ。素材画像（posts/）は従来どおりメンバーが置ける")
	void storageWritesAreRestrictedByFolder() {
		String background = tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg";
		String style = tenant + "/style/" + UUID.randomUUID() + ".png";
		String render = tenant + "/renders/1/1.jpg";
		String post = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		UUID other = db.tenant("他団体-" + UUID.randomUUID());

		db.as(admin, j -> j.update(INSERT_OBJECT, background));
		db.as(admin, j -> j.update(INSERT_OBJECT, style));
		db.as(editor, j -> j.update(INSERT_OBJECT, post));
		db.asServiceRole(j -> j.update(INSERT_OBJECT, render));

		for (LoggedIn user : List.of(editor, approver)) {
			assertRejected(() -> db.as(user, j -> j.update(INSERT_OBJECT, tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg")), "42501", "row-level security");
			assertRejected(() -> db.as(user, j -> j.update(INSERT_OBJECT, tenant + "/style/" + UUID.randomUUID() + ".png")), "42501", "row-level security");
		}
		for (String path : List.of(tenant + "/renders/1/2.jpg", tenant + "/candidates/x/1.jpg", other + "/backgrounds/a.jpg", other + "/style/a.png")) {
			assertRejected(() -> db.as(admin, j -> j.update(INSERT_OBJECT, path)), "42501", "row-level security");
		}
		assertThat(db.<List<String>>as(editor, j -> j.queryForList("select name from storage.objects", String.class))).contains(background, style, render);
	}
}
