package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/**
 * approve_post（REQ-007 から、承認で過去の投稿を選ばない）と、REQ-007 より前の承認の記録（approval_past_posts。読むだけ残す）、
 * 画像化・公開用画像の記録、画像化の失敗を DB で確かめる（REQ-002 設計 5・6章、REQ-007 設計 5章、V10・V12）
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class ApprovalPastPostsDatabaseTest extends DraftDatabaseSupport {

	static final Instant BASE = Instant.parse("2026-09-01T00:00:00Z");

	/** REQ-007 より前の承認が記録していた過去の投稿の表紙を再現する（新しい承認は記録しないので、テストが直接書く） */
	private void recordLegacyPastPost(long approvalEvent, int position, UUID pastPost, String coverPath) {
		jdbc.update("insert into approval_past_posts (approval_event_id, position, past_post_id, cover_storage_path) values (?, ?, ?, ?)",
				approvalEvent, position, pastPost, coverPath);
	}

	@Test
	@DisplayName("AC-007-08 公開済みの投稿が0件でも、承認の記録に過去の投稿は残らない")
	void noPastPostsWhenNothingPublished() {
		configureStyle();
		UUID post = save(editor, simpleTemplate());

		long event = approve(post);

		assertThat(pastPosts(event)).isEmpty();
	}

	@Test
	@DisplayName("AC-007-08 公開済みの投稿が5件（アップロードとテンプレートの両方）あっても、承認で過去の投稿を選ばない。承認の記録に過去の投稿は残らない")
	void approvalDoesNotPickPastPostsEvenWhenManyArePublished() {
		configureStyle();
		for (int day = 0; day < 5; day++) {
			if (day % 2 == 0) {
				publishedUploadPost(BASE.plus(day, ChronoUnit.DAYS));
			} else {
				publishedTemplatePost(BASE.plus(day, ChronoUnit.DAYS));
			}
		}
		UUID target = save(editor, simpleTemplate());

		long event = approve(target);

		assertThat(pastPosts(event)).isEmpty();
		assertThat(jdbc.queryForObject("select count(*) from approval_past_posts where approval_event_id = ?", Integer.class, event)).isZero();
	}

	@Test
	@DisplayName("AC-007-08 他の団体の公開済みの投稿があっても、承認の記録に過去の投稿は残らない")
	void otherTenantPublishedPostsAreNotRecorded() {
		configureStyle();
		publishedUploadPost(BASE);
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");
		String revision = "{\"format\":\"FEED_IMAGE\",\"mediaSource\":\"UPLOAD\",\"caption\":\"本文\",\"prCategory\":\"NONE\",\"media\":[{\"position\":1,"
				+ "\"storagePath\":\"" + otherTenant + "/posts/a.jpg\",\"width\":1080,\"height\":1350,\"byteSize\":1}]}";
		UUID foreign = save(outsider, revision);
		UUID foreignRevision = latestRevision(foreign);
		db.as(outsider, j -> j.queryForList("select public.request_approval(?, ?)", foreign, foreignRevision));
		db.as(outsider, j -> j.queryForList("select public.approve_post(?, ?, now() + interval '1 day')", foreign, foreignRevision));
		publish(foreign, BASE.plus(5, ChronoUnit.DAYS));
		UUID target = save(editor, simpleTemplate());

		long event = approve(target);

		assertThat(pastPosts(event)).isEmpty();
	}

	@Test
	@DisplayName("AC-007-08 アップロードの投稿の承認も、過去の投稿を記録しない（REQ-001 の動きのまま）")
	void uploadApprovalRecordsNoPastPosts() {
		publishedUploadPost(BASE);
		UUID upload = save(editor, uploadRevision());

		long event = approve(upload);

		assertThat(pastPosts(event)).isEmpty();
	}

	@Test
	@DisplayName("AC-007-08 過去の投稿の表紙を引く部品（app.past_post_cover）は V12 で無くなる。承認の RPC は引き続き 1 つだけ")
	void pastPostCoverFunctionIsDropped() {
		assertThat(jdbc.queryForObject("select to_regprocedure('app.past_post_cover(uuid)')::text", String.class)).isNull();
		assertThat(jdbc.queryForObject("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'approve_post'",
				Integer.class)).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-007-09 AC-002-15 REQ-007 より前の承認の記録は消えず読める。下書きに戻して再承認しても、古い承認の記録はそのままで、新しい承認には記録されない")
	void legacyRecordsStayAndReapprovalAddsNone() {
		configureStyle();
		UUID older = publishedUploadPost(BASE);
		UUID newer = publishedUploadPost(BASE.plus(1, ChronoUnit.DAYS));
		UUID target = save(editor, simpleTemplate());
		long firstApproval = approve(target);
		recordLegacyPastPost(firstApproval, 1, newer, tenant + "/posts/new.jpg");
		recordLegacyPastPost(firstApproval, 2, older, tenant + "/posts/old.jpg");

		db.as(approver, j -> j.queryForList("select public.cancel_schedule(?)", target));
		saveAgain(editor, target, simpleTemplate());
		long secondApproval = approve(target);

		assertThat(secondApproval).isGreaterThan(firstApproval);
		assertThat(pastPosts(firstApproval)).extracting(p -> p.get("past_post_id")).containsExactly(newer, older);
		assertThat(pastPosts(firstApproval)).extracting(p -> p.get("cover_storage_path")).containsExactly(tenant + "/posts/new.jpg", tenant + "/posts/old.jpg");
		assertThat(pastPosts(secondApproval)).isEmpty();
	}

	@Test
	@DisplayName("AC-007-09 記録は1つの承認に2件まで（上限は最後のスライドの中身の枚数）で、同じ投稿を重ねない")
	void legacyRecordsKeepTheirShape() {
		configureStyle();
		UUID a = publishedUploadPost(BASE);
		UUID b = publishedUploadPost(BASE.plus(1, ChronoUnit.DAYS));
		UUID c = publishedUploadPost(BASE.plus(2, ChronoUnit.DAYS));
		long event = approve(save(editor, simpleTemplate()));
		recordLegacyPastPost(event, 1, a, tenant + "/posts/a.jpg");

		assertRejected(() -> recordLegacyPastPost(event, 3, c, tenant + "/posts/c.jpg"), "23514", "approval_past_posts");
		assertRejected(() -> recordLegacyPastPost(event, 2, a, tenant + "/posts/a2.jpg"), "23505", "approval_past_posts");
		recordLegacyPastPost(event, 2, b, tenant + "/posts/b.jpg");
		assertThat(pastPosts(event)).hasSize(2);
	}

	@Test
	@DisplayName("AC-002-02 画像化した JPEG と公開用画像は、承認の出来事ごとに記録される。再承認では古い承認のものを残して作り直せる")
	void rendersAndPublishMediaAreRecordedPerApproval() {
		configureStyle();
		UUID post = save(editor, simpleTemplate());
		UUID revision = latestRevision(post);
		long first = approve(post);
		recordRender(first, 1);
		recordRender(first, 2);
		recordPublishMedia(revision, first, 1);

		db.as(approver, j -> j.queryForList("select public.cancel_schedule(?)", post));
		UUID second = saveAgain(editor, post, simpleTemplate());
		long next = approve(post);
		recordRender(next, 1);
		recordPublishMedia(second, next, 1);

		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, first)).isEqualTo(2);
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, next)).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from template_publish_media where revision_id = ?", Integer.class, revision)).isEqualTo(1);
		assertRejected(() -> recordRender(next, 1), "23505", "template_renders");
		assertRejected(() -> recordPublishMedia(second, next, 1), "23505", "template_publish_media");
		// 古い承認の出来事には、再承認のあとは記録できない（最新の承認の出来事だけ）
		assertRejected(() -> recordRender(first, 3), "P0404", "承認の出来事");
		assertRejected(() -> recordPublishMedia(revision, first, 2), "P0404", "承認の出来事");
	}

	@Test
	@DisplayName("AC-002-02 画像化・公開用画像の記録は、保存先の形・承認の出来事・版が合っていなければ拒否される。画面（編集者）からは記録できない")
	void renderRecordsAreValidatedAndServiceRoleOnly() {
		configureStyle();
		UUID post = save(editor, simpleTemplate());
		UUID revision = latestRevision(post);
		long event = approve(post);

		assertRejected(() -> db.asServiceRole(j -> j.queryForList("select public.record_template_render(?, ?, 1, ?, 1080, 1350, 1)", revision, event,
				tenant + "/renders/" + event + "/2.jpg")), "22023", "保存先が正しくありません");
		assertRejected(() -> db.asServiceRole(j -> j.queryForList("select public.record_template_render(?, ?, 1, ?, 1080, 1350, 1)", revision, event,
				tenant + "/posts/a.jpg")), "22023", "保存先が正しくありません");
		assertRejected(() -> db.asServiceRole(j -> j.queryForList("select public.record_template_render(?, ?, 1, ?, 1080, 1350, 1)", revision, -1L,
				renderPath(-1L, 1))), "P0404", "承認の出来事");
		// 承認の出来事が承認した版でない版には記録できない
		assertRejected(() -> db.asServiceRole(j -> j.queryForList("select public.record_template_render(?, ?, 1, ?, 1080, 1350, 1)", UUID.randomUUID(),
				event, renderPath(event, 1))), "P0404", "承認の出来事");
		assertRejected(() -> db.asServiceRole(j -> j.queryForList("select public.record_template_publish_media(?, ?, 1, ?, 1080, 1350, 1)",
				UUID.randomUUID(), event, tenant + "/" + UUID.randomUUID() + ".jpg")), "P0404", "承認の出来事");
		assertRejected(() -> db.asServiceRole(j -> j.queryForList("select public.record_template_publish_media(?, ?, 1, ?, 1080, 1350, 1)",
				revision, event, tenant + "/renders/x.jpg")), "22023", "保存先が正しくありません");
		assertRejected(() -> db.as(editor, j -> j.queryForList("select public.record_template_render(?, ?, 1, ?, 1080, 1350, 1)", revision, event, renderPath(event, 1))),
				"42501", "permission denied");
		assertRejected(() -> db.as(admin, j -> j.queryForList("select public.record_template_publish_media(?, ?, 1, ?, 1080, 1350, 1)",
				revision, event, tenant + "/" + UUID.randomUUID() + ".jpg")), "42501", "permission denied");
	}

	@Test
	@DisplayName("AC-002-23 画像化の失敗（RENDER_FAILED）を失敗の記録に残せる。知らない失敗区分は従来どおり記録できない")
	void renderFailedIsARecordableFailureKind() {
		configureStyle();
		UUID post = save(editor, simpleTemplate());
		approve(post);
		Long failed = jdbc.queryForObject(
				"insert into post_events (post_id, event_type, from_status, to_status, revision_id) values (?, 'FAILED', 'SCHEDULED', 'FAILED', ?) returning id",
				Long.class, post, latestRevision(post));

		jdbc.update("insert into post_failures (post_id, event_id, failure_kind, message) values (?, ?, 'RENDER_FAILED', '背景写真が見つかりません')", post, failed);

		assertThat(db.<String>as(editor, j -> j.queryForObject("select last_failure_kind from post_current where post_id = ?", String.class, post)))
				.isEqualTo("RENDER_FAILED");
		assertRejected(() -> jdbc.update("insert into post_failures (post_id, event_id, failure_kind, message) values (?, ?, 'NO_SUCH_KIND', 'x')", post, failed),
				"23514", "post_failures_failure_kind_check");
	}

	@Test
	@DisplayName("NFR-001-05 過去の投稿（REQ-007 より前の承認の記録）・画像化の記録は自団体のメンバーだけが読め、画面からは書き換えられない")
	void pastPostsAndRendersAreIsolatedByTenant() {
		configureStyle();
		UUID past = publishedUploadPost(BASE);
		UUID post = save(editor, simpleTemplate());
		long event = approve(post);
		recordLegacyPastPost(event, 1, past, tenant + "/posts/old.jpg");
		recordRender(event, 1);
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");

		for (String table : List.of("approval_past_posts", "template_renders")) {
			assertThat(db.<Integer>as(editor, j -> j.queryForObject("select count(*) from " + table + " where approval_event_id = ?", Integer.class, event))).as(table).isEqualTo(1);
			assertThat(db.<Integer>as(outsider, j -> j.queryForObject("select count(*) from " + table + " where approval_event_id = ?", Integer.class, event))).as(table).isZero();
		}
		assertRejected(() -> db.as(admin, j -> j.update("insert into approval_past_posts (approval_event_id, position, past_post_id, cover_storage_path) values (?, 2, ?, 'x')",
				event, post)), "42501", "permission denied");
		assertRejected(() -> jdbc.update("update approval_past_posts set cover_storage_path = 'y' where approval_event_id = ?", event), "P0405", "append-only");
	}

	private void recordPublishMedia(UUID revision, long event, int position) {
		db.asServiceRole(j -> j.queryForList("select public.record_template_publish_media(?, ?, ?, ?, 1080, 1350, 200000)",
				revision, event, position, tenant + "/" + UUID.randomUUID() + ".jpg"));
	}
}
