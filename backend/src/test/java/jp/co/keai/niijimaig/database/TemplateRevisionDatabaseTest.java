package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/** save_post_revision の TEMPLATE（スライド構成・素材画像の採用・テンプレートの版の照合）を DB で確かめる（REQ-002 設計 4・5章、V10） */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class TemplateRevisionDatabaseTest extends DraftDatabaseSupport {

	@Test
	@DisplayName("AC-002-19 BR-002-11 テンプレートの版を保存すると、スライド・表紙の背景・強調・素材画像の採用・追加のハッシュタグ・版の元の生成・使った設定の版が記録される")
	void templateRevisionIsRecordedWithAdoption() {
		configureStyle();
		UUID photo = registerPhoto("正門の写真");
		UUID adopted = recordImageGeneration(tenant, editor.memberId(), "PHOTOREALISTIC", "SUCCEEDED", 4);
		UUID generation = recordGeneration("SUCCEEDED");
		String json = template("niijima@1", ",\"generationId\":\"" + generation + "\"",
				cover(",\"backgroundPhotoId\":\"" + photo + "\""),
				body("これは説明です", "[{\"start\":0,\"length\":2}]", material(generationRef(adopted, 3))),
				body("二枚目", "[]", null),
				closing());

		UUID post = save(editor, json);

		UUID revision = latestRevision(post);
		List<Map<String, Object>> slides = jdbc.queryForList("select position, role from post_slides where revision_id = ? order by position", revision);
		assertThat(slides).extracting(s -> s.get("role")).containsExactly("COVER", "BODY", "BODY", "CLOSING");
		Map<String, Object> cover = jdbc.queryForMap(
				"select c.target, c.annotation, c.closing_words, c.accent, b.background_photo_id from cover_slides c "
						+ "join post_slides s on s.id = c.slide_id left join cover_backgrounds b on b.slide_id = c.slide_id where s.revision_id = ?", revision);
		assertThat(cover).containsEntry("target", "対象A").containsEntry("accent", "RED").containsEntry("background_photo_id", photo);
		Map<String, Object> emphasis = jdbc.queryForMap(
				"select e.start_cp, e.length_cp from body_emphases e join post_slides s on s.id = e.slide_id where s.revision_id = ?", revision);
		assertThat(emphasis).containsEntry("start_cp", 0).containsEntry("length_cp", 2);
		Map<String, Object> adoption = jdbc.queryForMap(
				"select ma.generation_id, ma.candidate_position from material_adoptions ma join post_slides s on s.id = ma.slide_id where s.revision_id = ?", revision);
		assertThat(adoption).containsEntry("generation_id", adopted).containsEntry("candidate_position", 3);
		Map<String, Object> template = jdbc.queryForMap("select template_version, style_settings_id from revision_templates where revision_id = ?", revision);
		Long currentStyle = jdbc.queryForObject("select id from post_style_settings_current where tenant_id = ?", Long.class, tenant);
		assertThat(template).containsEntry("template_version", "niijima@1").containsEntry("style_settings_id", currentStyle);
		assertThat(jdbc.queryForObject("select generation_id from revision_generations where revision_id = ?", UUID.class, revision)).isEqualTo(generation);
		assertThat(jdbc.queryForList("select hashtag from revision_hashtags where revision_id = ? order by position", String.class, revision))
				.containsExactly("#学割", "#京都");
		assertThat(jdbc.queryForObject("select generation_id from post_revisions where id = ?", UUID.class, revision)).isNull();
		Map<String, Object> styles = db.as(editor, j -> j.queryForMap(
				"select style, origin, candidate_position from revision_generated_styles where revision_id = ?", revision));
		assertThat(styles).containsEntry("style", "PHOTOREALISTIC").containsEntry("origin", "MATERIAL").containsEntry("candidate_position", 3);
	}

	@Test
	@DisplayName("AC-002-19 投稿画像（アップロードの版）の候補の採用も、素材画像の採用と同じビュー revision_generated_styles に出る")
	void uploadAdoptionAppearsInSameView() {
		UUID generation = recordImageGeneration(tenant, editor.memberId(), "ILLUSTRATION", "SUCCEEDED", 2);
		String revision = "{\"format\":\"FEED_IMAGE\",\"mediaSource\":\"UPLOAD\",\"caption\":\"本文\",\"prCategory\":\"NONE\",\"media\":[{\"position\":1,"
				+ "\"storagePath\":\"" + tenant + "/posts/" + UUID.randomUUID() + ".jpg\",\"width\":819,\"height\":1024,\"byteSize\":1,"
				+ "\"generation\":" + generationRef(generation, 2) + "}]}";

		UUID post = save(editor, revision);

		Map<String, Object> styles = db.as(editor, j -> j.queryForMap(
				"select style, origin from revision_generated_styles where revision_id = ?", latestRevision(post)));
		assertThat(styles).containsEntry("style", "ILLUSTRATION").containsEntry("origin", "POST_MEDIA");
		assertThat(jdbc.queryForObject("select count(*) from post_slides where revision_id = ?", Integer.class, latestRevision(post))).isZero();
	}

	@Test
	@DisplayName("BR-002-11 役割の並びと件数が正しくないスライド構成は保存できない（表紙1 → 中1〜8 → 最後1、計3〜10枚）")
	void invalidSlideArrangementIsRejected() {
		configureStyle();
		String cover = cover("");
		String body = body("説明", "[]", null);
		String closing = closing();
		String nineBodies = String.join(",", java.util.Collections.nCopies(9, body));
		List<String> invalid = List.of(
				template("niijima@1", "", cover, closing),                                      // 中のスライドが無い（2枚）
				template("niijima@1", "", body, body, closing),                                 // 表紙が無い
				template("niijima@1", "", cover, body, body),                                   // 最後のスライドが無い
				template("niijima@1", "", cover, closing, body),                                // 並びが逆
				template("niijima@1", "", cover, cover, closing),                               // 表紙が2枚
				template("niijima@1", "", cover, body, closing, closing),                       // 最後のスライドが2枚
				template("niijima@1", "", cover, nineBodies, closing),                          // 中のスライドが9枚（11枚）
				template("niijima@1", "", cover, "{\"role\":\"FOOTER\"}", closing));            // 知らない役割
		for (String json : invalid) {
			assertRejected(() -> save(editor, json), "22023", "スライド");
		}
		assertThat(save(editor, template("niijima@1", "", cover, String.join(",", java.util.Collections.nCopies(8, body)), closing))).isNotNull();
	}

	@Test
	@DisplayName("BR-002-02 登録されていないテンプレートの版は保存できず、保存の途中の記録も残らない")
	void unknownTemplateVersionIsRejected() {
		configureStyle();
		String json = template("niijima@999", "", cover(""), body("説明", "[]", null), closing());

		assertRejected(() -> save(editor, json), "22023", "テンプレートの版");
		assertThat(jdbc.queryForObject("select count(*) from posts where tenant_id = ?", Integer.class, tenant)).isZero();
	}

	@Test
	@DisplayName("BR-002-17 投稿の型の設定が無い団体は、テンプレートの版を保存できない")
	void styleSettingsAreRequired() {
		assertRejected(() -> save(editor, simpleTemplate()), "22023", "投稿の型の設定がありません");
	}

	@Test
	@DisplayName("BR-002-17 保存した版は、保存時点の現在の設定の版を記録し、後から設定を変えても変わらない")
	void revisionKeepsStyleVersionUsedAtSave() {
		configureStyle();
		UUID post = save(editor, simpleTemplate());
		Long used = jdbc.queryForObject("select style_settings_id from revision_templates where revision_id = ?", Long.class, latestRevision(post));

		db.as(admin, j -> j.queryForObject("select public.save_post_style_settings('帯2', '{対象C}'::text[], 'x', 'y', 'z', '{}'::text[], null)", Integer.class));

		assertThat(jdbc.queryForObject("select style_settings_id from revision_templates where revision_id = ?", Long.class, latestRevision(post))).isEqualTo(used);
		Long next = jdbc.queryForObject("select id from post_style_settings_current where tenant_id = ?", Long.class, tenant);
		assertThat(next).isGreaterThan(used);
		UUID second = saveAgain(editor, post, simpleTemplate());
		assertThat(jdbc.queryForObject("select style_settings_id from revision_templates where revision_id = ?", Long.class, second)).isEqualTo(next);
	}

	@Test
	@DisplayName("ADR-0005 強調する語の範囲が説明文（コードポイント）に収まらなければ保存できない。収まる範囲は絵文字を1文字と数える")
	void emphasisMustFitInDescription() {
		configureStyle();
		String emoji = "😀😀abc";          // 絵文字2つ＋abc = 5コードポイント（UTF-16 では7）
		assertThat(save(editor, template("niijima@1", "", cover(""), body(emoji, "[{\"start\":2,\"length\":3}]", null), closing()))).isNotNull();

		for (String emphasis : List.of("[{\"start\":3,\"length\":3}]", "[{\"start\":-1,\"length\":2}]", "[{\"start\":0,\"length\":0}]",
				"[{\"start\":0,\"length\":6}]", "[{\"start\":\"0\",\"length\":2}]", "{\"start\":0,\"length\":2}")) {
			assertRejected(() -> save(editor, template("niijima@1", "", cover(""), body(emoji, emphasis, null), closing())), "22023", "");
		}
	}

	@Test
	@DisplayName("ADR-0005 文字数・表紙の対象の候補・強調の重なり・ハッシュタグの個数は DB では検査しない（ドメインが検査する）")
	void domainRulesAreNotCheckedInDatabase() {
		configureStyle();
		String longCover = "{\"role\":\"COVER\",\"target\":\"候補に無い対象\",\"keyword\":\"あいうえおかきくけこさ\",\"annotation\":\"\",\"closingWords\":\"あいうえおかきくけこ\",\"accent\":\"TEAL\"}";
		String longBody = body("あ".repeat(130), "[{\"start\":0,\"length\":3},{\"start\":1,\"length\":3},{\"start\":4,\"length\":1},{\"start\":6,\"length\":1}]", null);
		String json = template("niijima@1", "", longCover, longBody, closing()).replace("[\"#学割\",\"#京都\"]",
				"[\"#1\",\"#2\",\"#3\",\"#4\",\"#5\",\"#6\",\"#7\"]");

		UUID post = save(editor, json);

		assertThat(jdbc.queryForObject("select count(*) from body_emphases e join post_slides s on s.id = e.slide_id where s.revision_id = ?",
				Integer.class, latestRevision(post))).isEqualTo(4);
		assertThat(jdbc.queryForObject("select count(*) from revision_hashtags where revision_id = ?", Integer.class, latestRevision(post))).isEqualTo(7);
	}

	@Test
	@DisplayName("AC-002-19 素材画像の保存先は自団体の posts/ の JPEG に限る（候補の保存先・../・他団体は使えない）")
	void materialPathIsRestricted() {
		configureStyle();
		UUID other = db.tenant("他団体-" + UUID.randomUUID());
		for (String path : List.of(tenant + "/candidates/x/1.jpg", tenant + "/posts/../candidates/x/1.jpg", other + "/posts/a.jpg",
				tenant + "/backgrounds/a.jpg", tenant + "/posts/a.png")) {
			String material = "{\"storagePath\":\"" + path + "\",\"width\":1080,\"height\":810,\"byteSize\":1}";
			assertRejected(() -> save(editor, template("niijima@1", "", cover(""), body("説明", "[]", material), closing())),
					"42501", "保存先が正しくありません");
		}
	}

	@Test
	@DisplayName("AC-002-19 素材画像としての採用は、採用できる候補（自団体・成功した画像生成・候補の範囲内）だけ受け付ける")
	void materialAdoptionRequiresAdoptableCandidate() {
		configureStyle();
		UUID twoCandidates = recordImageGeneration(tenant, editor.memberId(), "ILLUSTRATION", "SUCCEEDED", 2);
		UUID failed = recordImageGeneration(tenant, editor.memberId(), "ILLUSTRATION", "FAILED", 0);
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");
		UUID foreign = recordImageGeneration(otherTenant, outsider.memberId(), "ILLUSTRATION", "SUCCEEDED", 4);

		for (String ref : List.of(generationRef(twoCandidates, 3), generationRef(twoCandidates, 0), generationRef(failed, 1),
				generationRef(foreign, 1), generationRef(UUID.randomUUID(), 1))) {
			assertRejected(() -> save(editor, template("niijima@1", "", cover(""), body("説明", "[]", material(ref)), closing())),
					"22023", "候補の参照が正しくありません");
		}
		assertThat(jdbc.queryForObject("select count(*) from material_adoptions where adopted_by = ?", Integer.class, editor.memberId())).isZero();
	}

	@Test
	@DisplayName("AC-002-19 背景写真は自団体のものだけ指定できる。使わないにした写真も、すでに選んだ下書きの保存では指定できる")
	void backgroundPhotoMustBelongToTenant() {
		configureStyle();
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");
		UUID foreign = db.as(outsider, j -> j.queryForObject("select public.register_background_photo(?, '他団体の写真')", UUID.class,
				otherTenant + "/backgrounds/" + UUID.randomUUID() + ".jpg"));

		for (String bg : List.of(foreign.toString(), UUID.randomUUID().toString())) {
			assertRejected(() -> save(editor, template("niijima@1", "", cover(",\"backgroundPhotoId\":\"" + bg + "\""), body("説明", "[]", null), closing())),
					"22023", "背景写真の参照が正しくありません");
		}
		UUID retired = registerPhoto("使わない写真");
		db.as(admin, j -> j.queryForList("select public.retire_background_photo(?)", retired));
		UUID post = save(editor, template("niijima@1", "", cover(",\"backgroundPhotoId\":\"" + retired + "\""), body("説明", "[]", null), closing()));
		assertThat(jdbc.queryForObject("select background_photo_id from cover_backgrounds cb join post_slides s on s.id = cb.slide_id where s.revision_id = ?",
				UUID.class, latestRevision(post))).isEqualTo(retired);
	}

	@Test
	@DisplayName("BR-002-08 版の元の生成は自団体の成功した生成だけ指定できる")
	void revisionGenerationMustBeOwnAndSucceeded() {
		configureStyle();
		UUID failed = recordGeneration("INVALID_OUTPUT");

		for (String extra : List.of(",\"generationId\":\"" + failed + "\"", ",\"generationId\":\"" + UUID.randomUUID() + "\"")) {
			assertRejected(() -> save(editor, template("niijima@1", extra, cover(""), body("説明", "[]", null), closing())), "22023", "生成の参照が正しくありません");
		}
	}

	@Test
	@DisplayName("BR-002-11 テンプレートの投稿はカルーセルで、投稿画像（media）は付けられない")
	void templateRevisionMustBeCarouselWithoutMedia() {
		configureStyle();
		String feed = simpleTemplate().replace("\"format\":\"CAROUSEL\"", "\"format\":\"FEED_IMAGE\"");
		String withMedia = simpleTemplate().replace("\"slides\":", "\"media\":[{\"position\":1,\"storagePath\":\"" + tenant
				+ "/posts/a.jpg\",\"width\":1,\"height\":1,\"byteSize\":1}],\"slides\":");

		assertRejected(() -> save(editor, feed), "22023", "カルーセル");
		assertRejected(() -> save(editor, withMedia), "22023", "投稿画像");
	}

	@Test
	@DisplayName("BR-002-11 スライドの文言の形（文字列でない・必須の項目が無い）が違えば保存できない")
	void malformedSlideFieldsAreRejected() {
		configureStyle();
		List<String> invalid = List.of(
				cover("").replace("\"keyword\":\"オトクな割引\",", ""),
				cover("").replace("\"accent\":\"RED\"", "\"accent\":\"GREEN\""),
				cover("").replace("\"target\":\"対象A\"", "\"target\":1"));
		for (String badCover : invalid) {
			assertRejected(() -> save(editor, template("niijima@1", "", badCover, body("説明", "[]", null), closing())), "22023", "");
		}
	}

	@Test
	@DisplayName("BR-002-01 承認依頼後は、テンプレートの版も版が固定される（UPLOAD と同じ）")
	void templateRevisionIsFrozenAfterApprovalRequest() {
		configureStyle();
		UUID post = save(editor, simpleTemplate());
		db.as(editor, j -> j.queryForList("select public.request_approval(?, ?)", post, latestRevision(post)));

		assertRejected(() -> saveAgain(editor, post, simpleTemplate()), "P0409", "frozen");
	}
}
