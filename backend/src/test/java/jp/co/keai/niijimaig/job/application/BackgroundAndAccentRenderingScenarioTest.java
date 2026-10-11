package jp.co.keai.niijimaig.job.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.BeforeAll;
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
import jp.co.keai.niijimaig.connection.domain.AccessToken;
import jp.co.keai.niijimaig.connection.infrastructure.TokenCipher;
import jp.co.keai.niijimaig.support.ChromiumInstaller;
import jp.co.keai.niijimaig.support.FakeExternalsConfiguration;
import jp.co.keai.niijimaig.support.FakeExternalsConfiguration.FakeRenderStorage;
import jp.co.keai.niijimaig.support.FakeInstagram;
import jp.co.keai.niijimaig.support.SupabaseFixture;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * REQ-006 の画像化と公開を、実際の DB と実物の Playwright（chromium）で通す結合テスト。Instagram と Storage は偽物。
 * AI が作った背景（背景写真としての採用の記録がある背景写真）の画像化・欠けたときの失敗、帯の色7色の描画（帯の画素の色）、
 * AI が作った背景だけの投稿の公開用キャプション（REQ-006 設計 7章「Java 結合」）
 */
@Import({ TestcontainersConfiguration.class, FakeExternalsConfiguration.class })
@SpringBootTest
@ActiveProfiles("test")
class BackgroundAndAccentRenderingScenarioTest {

	/** 画像化のコードはブラウザを自動ダウンロードしないので、使う chromium だけを入れておく */
	@BeforeAll
	static void installChromium() {
		ChromiumInstaller.ensureInstalled();
	}

	/** 画像化した表紙の「3段目の帯」を探す範囲（テンプレート niijima@1 の closing-row の縦の範囲） */
	static final int BAND_TOP = 725;
	static final int BAND_BOTTOM = 915;
	/** 帯の端を探すときの色の近さ（各チャンネルの差）。端から内側に入った点の色を比べるときの許容差は COLOR_TOLERANCE */
	static final int EDGE_TOLERANCE = 40;
	static final int COLOR_TOLERANCE = 12;
	/** 帯の端から内側へ入る距離。帯の左右の余白（文字の大きさの0.12倍）に収まり、白抜きの文字とJPEGの端のにじみを避ける */
	static final int INSIDE_EDGE = 8;

	/** 旧3色の値（REQ-002 設計 0章で公開中の投稿から読み取ったもの。fixtures とは別に、元の値をここに固定して回帰を見る） */
	static final String[][] LEGACY = { { "PURPLE", "#8C52FE", "#8C52FE" }, { "RED", "#FD3432", "#FE914C" }, { "TEAL", "#19BBAA", "#066A85" } };

	@Autowired TickScenario tick;
	@Autowired FakeInstagram instagram;
	@Autowired FakeRenderStorage storage;
	@Autowired TokenCipher cipher;
	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;

	SupabaseFixture db;
	UUID tenant;
	LoggedIn admin;
	LoggedIn editor;
	LoggedIn approver;

	@BeforeEach
	void setUp() {
		instagram.reset();
		db = new SupabaseFixture(jdbc, tx);
		jdbc.update("update jobs set status = 'SUCCEEDED', locked_until = null where status in ('PENDING','RUNNING')");
		String suffix = UUID.randomUUID().toString().substring(0, 8);
		tenant = db.tenant("新島info-" + suffix);
		admin = db.member(tenant, "ad-" + suffix + "@example.com", "ADMIN");
		editor = db.member(tenant, "e-" + suffix + "@example.com", "EDITOR");
		approver = db.member(tenant, "a-" + suffix + "@example.com", "APPROVER");
		jdbc.update("""
				insert into tenant_settings (tenant_id, version, llm_provider, llm_model, llm_daily_limit, llm_warn_ratio,
				  publish_grace_minutes, pr_label, auto_draft_enabled) values (?, 1, 'GEMINI', 'gemini-flash', 100, 0.8, 360, '【PR】', false)
				""", tenant);
		connectInstagram();
		db.as(admin, j -> j.queryForObject("select public.save_post_style_settings('同志社生向けSNSメディア', '{同志社大学}'::text[], "
				+ "'ご覧いただきありがとうございます', '@niijima_info', '---\nフッター', '{#固定}'::text[], null)", Integer.class));
	}

	// ───────── AC-006-14 作った背景の画像が見つからない ─────────

	@Test
	@DisplayName("AC-006-14 AI が作った背景の画像が Storage に無いと、投稿は失敗（画像化の失敗）になり理由が記録される。今すぐ再実行で予約中に戻り、画像が戻れば公開される")
	void missingGeneratedBackgroundFailsRenderingAndCanBeRetried() {
		AiBackground background = aiBackground("夕暮れの京都御苑、やわらかい光");
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(cover("RED", background.photo()), body("学割が使える", material(null))));
		assertThat(jdbc.queryForObject("select count(*) from background_photo_adoptions where background_photo_id = ?", Integer.class, background.photo()))
				.as("AI が作った背景（採用の記録がある背景写真）").isEqualTo(1);

		tick.run("ai-missing-1");

		assertThat(status(post)).isEqualTo("FAILED");
		assertThat(jdbc.queryForObject("select last_failure_kind from post_current where post_id = ?", String.class, post)).isEqualTo("RENDER_FAILED");
		assertThat(jdbc.queryForObject("select f.message from post_failures f join post_events e on e.id = f.event_id where e.post_id = ?", String.class, post))
				.contains("画像化に失敗しました。今すぐ再実行でやり直せます").contains("画像化に必要な画像が見つかりません");
		assertThat(jdbc.queryForObject("select status from jobs where post_id = ? and job_type = 'PREPARE_MEDIA'", String.class, post)).isEqualTo("FAILED");
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, latestApproval(post))).isZero();
		assertThat(instagram.publishCalls.get()).isZero();

		// 今すぐ再実行（承認者）で予約中に戻る。画像が見つかるようになれば、次の定期処理で公開される
		db.as(approver, j -> j.queryForList("select public.retry_post(?, ?)", post, Timestamp.from(Instant.now())));
		assertThat(status(post)).isEqualTo("SCHEDULED");
		storage.objects.put(background.path(), jpeg(1024, 1024, Color.BLUE));
		tick.run("ai-missing-2");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(instagram.publishCalls.get()).isEqualTo(1);
	}

	// ───────── AC-006-12 使わないにしても画像化できる ─────────

	@Test
	@DisplayName("AC-006-12 AI が作った背景を管理者が「使わない」にしても、その背景を使っている承認済みの投稿は画像化でき、表紙に背景が出る")
	void retiredGeneratedBackgroundStillRendersForApprovedPost() {
		Color photoColor = new Color(200, 60, 60);
		AiBackground background = aiBackground("夕暮れの京都御苑");
		storage.objects.put(background.path(), jpeg(1024, 1024, photoColor));
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(cover("BLUE", background.photo()), body("学割が使える", material(null))));

		db.as(admin, j -> j.queryForList("select public.retire_background_photo(?)", background.photo()));
		assertThat(jdbc.queryForObject("select count(*) from usable_background_photos where id = ?", Integer.class, background.photo()))
				.as("使わない背景は候補から外れる").isZero();
		tick.run("ai-retired");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		BufferedImage cover = decode(storage.objects.get(tenant + "/renders/" + latestApproval(post) + "/1.jpg"));
		assertThat(cover.getWidth()).isEqualTo(1080);
		assertThat(cover.getHeight()).isEqualTo(1350);
		// 白い枠の外の写真の部分（黒35%で暗くなった背景）が、使わないにした背景の色になっている（無ければ紺の単色）
		assertNear(new Color(cover.getRGB(12, 400)), new Color(130, 39, 39), 30);
	}

	// ───────── AC-006-03 / NFR-006-02 帯の色 ─────────

	@Test
	@DisplayName("AC-006-03 旧3色（紫・赤・青緑）の帯で承認済みの投稿は、7色化の後も同じ値（公開中の投稿から読み取った元の値）の帯で画像化される")
	void legacyAccentColorsRenderWithTheOriginalValues() {
		for (String[] legacy : LEGACY) {
			String code = legacy[0];
			UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(cover(code, registeredPhoto()), body("学割が使える", material(null))));

			tick.run("legacy-" + code);

			assertThat(status(post)).as(code).isEqualTo("PUBLISHED");
			assertBandColors(code, coverOf(post), Color.decode(legacy[1]), Color.decode(legacy[2]));
		}
	}

	@Test
	@DisplayName("NFR-006-02 AC-006-03 7色すべて（accent-colors.json）で、画像化した表紙の帯の左端・右端の画素の色が fixtures の値になる。値は画面のプレビューと同じ render-values.json の accentStart/accentEnd")
	void everyAccentColorRendersTheFixtureValues() {
		List<AccentFixture> colors = accentFixtures();
		assertThat(colors).hasSize(7);
		assertThat(colors).filteredOn(c -> c.isNew()).extracting(AccentFixture::code).containsExactly("BLUE", "GREEN", "ORANGE", "PINK");

		// 画面のプレビューと画像化が同じ値を使う（render-values.json の描画値が accent-colors.json と同じ）
		List<String> checkedByRenderValues = new ArrayList<>();
		for (JsonNode c : renderValueCases()) {
			JsonNode slide = c.get("slides").get(0);
			if (!"COVER".equals(slide.get("role").asString())) {
				continue;
			}
			AccentFixture color = colors.stream().filter(f -> f.code().equals(slide.get("accent").asString())).findFirst().orElseThrow();
			JsonNode expected = c.get("expected").get("slides").get(0);
			assertThat(expected.get("accentStart").asString()).as(color.code()).isEqualToIgnoringCase(color.startHex());
			assertThat(expected.get("accentEnd").asString()).as(color.code()).isEqualToIgnoringCase(color.endHex());
			checkedByRenderValues.add(color.code());
		}
		assertThat(checkedByRenderValues).contains("RED", "TEAL", "PURPLE", "BLUE", "GREEN", "ORANGE", "PINK");

		for (AccentFixture color : colors) {
			UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(cover(color.code(), registeredPhoto()), body("学割が使える", material(null))));

			tick.run("accent-" + color.code());

			assertThat(status(post)).as(color.code()).isEqualTo("PUBLISHED");
			assertBandColors(color.code(), coverOf(post), color.start(), color.end());
		}
	}

	// ───────── AC-006-13 AI生成の表示 ─────────

	@Test
	@DisplayName("AC-006-13 AI が作った背景だけを使った投稿（素材画像は背景・イラストまたは無い）を公開しても、公開用キャプションに AI生成の表示が付かず、AI info（is_ai_generated）も付かない")
	void postWithOnlyGeneratedBackgroundHasNoAiDisclosure() {
		AiBackground background = aiBackground("夕暮れの京都御苑");
		storage.objects.put(background.path(), jpeg(1024, 1024, new Color(200, 120, 60)));
		UUID illustration = imageGeneration("ILLUSTRATION");
		String illustrationMaterial = material("{\"generationId\":\"" + illustration + "\",\"candidatePosition\":1}");
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)),
				template(cover("GREEN", background.photo()), body("学割が使える", illustrationMaterial), body("文字だけ", null)));

		tick.run("ai-no-disclosure");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(jdbc.queryForObject("select count(*) from background_photo_adoptions where background_photo_id = ?", Integer.class, background.photo())).isEqualTo(1);
		assertThat(instagram.aiGeneratedContainers).isEmpty();
		assertThat(instagram.publishedCaptions).containsExactly("本文\n\n---\nフッター\n\n#固定\n#学割");
	}

	@Test
	@DisplayName("AC-006-13 AC-002-19 AI が作った背景があっても、写真風の生成画像を素材画像に使った投稿には AI生成の表示と AI info が付く（回帰）")
	void photorealisticMaterialStillGetsAiDisclosureWithGeneratedBackground() {
		AiBackground background = aiBackground("夕暮れの京都御苑");
		storage.objects.put(background.path(), jpeg(1024, 1024, new Color(200, 120, 60)));
		UUID photoreal = imageGeneration("PHOTOREALISTIC");
		String generated = material("{\"generationId\":\"" + photoreal + "\",\"candidatePosition\":1}");
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(cover("PINK", background.photo()), body("学割が使える", generated)));

		tick.run("ai-photoreal");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(instagram.aiGeneratedContainers).hasSize(1);
		assertThat(instagram.publishedCaptions).containsExactly("本文\n※画像はAIで生成したイメージです\n\n---\nフッター\n\n#固定\n#学割");
	}

	// ───────── 下ごしらえ ─────────

	/** AI が作った背景: 保存先と、背景写真の ID（採用の記録つき）。画像は Storage に置かない（置くかどうかはテストが決める） */
	private record AiBackground(UUID photo, String path) {
	}

	private UUID imageGeneration(String style) {
		UUID generation = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList("select public.record_image_generation(?, ?, ?, ?, '夕暮れの京都御苑、やわらかい光', "
				+ "'Kyoto Imperial Garden at dusk', 'CLOUDFLARE_WORKERS_AI', 'flux', 'SUCCEEDED', 4)", generation, tenant, editor.memberId(), style));
		return generation;
	}

	/** 背景・イラストの候補を背景写真にした（API関数と同じ service role の record_generated_background。編集者のメンバーの操作） */
	private AiBackground aiBackground(String description) {
		UUID generation = imageGeneration("ILLUSTRATION");
		String path = tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg";
		UUID photo = db.asServiceRole(j -> j.queryForObject("select public.record_generated_background(?, ?, ?, ?, 2, ?)", UUID.class,
				tenant, editor.memberId(), path, generation, description));
		return new AiBackground(photo, path);
	}

	/** 管理者が登録した背景写真（画像は Storage に置く）。背景写真の ID を返す */
	private UUID registeredPhoto() {
		UUID photo = db.as(admin, j -> j.queryForObject("select public.register_background_photo(?, ?)", UUID.class,
				tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg", "校舎"));
		String path = jdbc.queryForObject("select storage_path from background_photos where id = ?", String.class, photo);
		storage.objects.put(path, jpeg(1080, 1350, new Color(40, 80, 140)));
		return photo;
	}

	private String cover(String accent, UUID backgroundPhoto) {
		return "{\"role\":\"COVER\",\"target\":\"同志社大学\",\"keyword\":\"オトクな割引\",\"annotation\":\"＼ 学生のうちに ／\","
				+ "\"closingWords\":\"まとめたよ\",\"accent\":\"" + accent + "\",\"backgroundPhotoId\":\"" + backgroundPhoto + "\"}";
	}

	/** 素材画像（Storage に置く）。generation は採用する生成画像の参照の JSON か null */
	private String material(String generation) {
		String path = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		storage.objects.put(path, jpeg(800, 600, new Color(60, 160, 90)));
		return "{\"storagePath\":\"" + path + "\",\"width\":800,\"height\":600,\"byteSize\":1000"
				+ (generation == null ? "" : ",\"generation\":" + generation) + "}";
	}

	private String body(String heading, String material) {
		return "{\"role\":\"BODY\",\"heading\":\"" + heading + "\",\"description\":\"学生証を見せるだけで割引になります\","
				+ "\"emphases\":[{\"start\":0,\"length\":3}],\"picturePrompt\":\"桜並木\",\"needsReplacement\":false"
				+ (material == null ? "" : ",\"material\":" + material) + "}";
	}

	private String template(String cover, String... bodies) {
		String slides = cover + "," + String.join(",", bodies) + ",{\"role\":\"CLOSING\"}";
		return "{\"format\":\"CAROUSEL\",\"mediaSource\":\"TEMPLATE\",\"caption\":\"本文\",\"prCategory\":\"NONE\","
				+ "\"templateVersion\":\"niijima@1\",\"hashtags\":[\"#学割\"],\"slides\":[" + slides + "]}";
	}

	private UUID approvedPost(Instant scheduledAt, String revisionJson) {
		UUID post = db.as(editor, j -> j.queryForObject("select post_id from public.save_post_revision(null, ?::jsonb)", UUID.class, revisionJson));
		UUID revision = jdbc.queryForObject("select id from post_revisions where post_id = ? order by revision_no desc limit 1", UUID.class, post);
		db.as(editor, j -> j.queryForList("select public.request_approval(?, ?)", post, revision));
		db.as(approver, j -> j.queryForList("select public.approve_post(?, ?, ?)", post, revision, Timestamp.from(scheduledAt)));
		return post;
	}

	private void connectInstagram() {
		UUID connection = jdbc.queryForObject("""
				insert into instagram_connections (tenant_id, ig_user_id, ig_username, account_type, connected_by)
				values (?, '1784', 'niijima_info', 'BUSINESS', ?) returning id""", UUID.class, tenant, approver.memberId());
		TokenCipher.Sealed sealed = cipher.seal(new AccessToken("test-token"), connection);
		jdbc.update("""
				insert into instagram_token_grants (connection_id, grant_kind, token_ciphertext, token_iv, key_version, expires_at)
				values (?, 'INITIAL', ?, ?, ?, ?)""", connection, sealed.ciphertext(), sealed.iv(), sealed.keyVersion(),
				Timestamp.from(Instant.now().plus(Duration.ofDays(50))));
	}

	private long latestApproval(UUID post) {
		return jdbc.queryForObject("select max(id) from post_events where post_id = ? and event_type = 'APPROVED'", Long.class, post);
	}

	private String status(UUID post) {
		return jdbc.queryForObject("select status from post_current where post_id = ?", String.class, post);
	}

	/** 画像化した表紙（1枚目） */
	private BufferedImage coverOf(UUID post) {
		BufferedImage image = decode(storage.objects.get(tenant + "/renders/" + latestApproval(post) + "/1.jpg"));
		assertThat(image.getWidth()).isEqualTo(1080);
		assertThat(image.getHeight()).isEqualTo(1350);
		return image;
	}

	// ───────── 帯の画素 ─────────

	/** 帯の左端・右端の少し内側の色を、期待する左端・右端の色と許容差つきで比べる */
	private static void assertBandColors(String code, BufferedImage cover, Color start, Color end) {
		Color left = sampleInsideEdge(cover, start, true);
		Color right = sampleInsideEdge(cover, end, false);
		assertNear(left, start, COLOR_TOLERANCE, code + " 帯の左端");
		assertNear(right, end, COLOR_TOLERANCE, code + " 帯の右端");
	}

	/**
	 * 3段目の帯の端を探して、その少し内側の色（3×3画素の平均）を返す。端は、範囲内の各行で左（右）から見て最初に expected に近い色になる画素。
	 * 見つからなければ、その色の帯が描かれていないので失敗にする
	 */
	private static Color sampleInsideEdge(BufferedImage image, Color expected, boolean fromLeft) {
		List<int[]> edges = new ArrayList<>();
		for (int y = BAND_TOP; y <= BAND_BOTTOM; y++) {
			for (int step = 0; step < 1000; step++) {
				int x = fromLeft ? 40 + step : 1039 - step;
				if (isNear(new Color(image.getRGB(x, y)), expected, EDGE_TOLERANCE)) {
					edges.add(new int[] { x, y });
					break;
				}
			}
		}
		assertThat(edges).as("帯の色 " + toHex(expected) + " が表紙の " + (fromLeft ? "左" : "右") + "端に見つかりません").isNotEmpty();
		int edge = fromLeft ? edges.stream().mapToInt(e -> e[0]).min().getAsInt() : edges.stream().mapToInt(e -> e[0]).max().getAsInt();
		List<Integer> rows = edges.stream().filter(e -> Math.abs(e[0] - edge) <= 1).map(e -> e[1]).sorted().toList();
		int row = rows.get(rows.size() / 2);
		int column = fromLeft ? edge + INSIDE_EDGE : edge - INSIDE_EDGE;
		long red = 0;
		long green = 0;
		long blue = 0;
		for (int dy = -1; dy <= 1; dy++) {
			for (int dx = -1; dx <= 1; dx++) {
				Color c = new Color(image.getRGB(column + dx, row + dy));
				red += c.getRed();
				green += c.getGreen();
				blue += c.getBlue();
			}
		}
		return new Color((int) (red / 9), (int) (green / 9), (int) (blue / 9));
	}

	private static boolean isNear(Color actual, Color expected, int tolerance) {
		return Math.abs(actual.getRed() - expected.getRed()) <= tolerance && Math.abs(actual.getGreen() - expected.getGreen()) <= tolerance
				&& Math.abs(actual.getBlue() - expected.getBlue()) <= tolerance;
	}

	private static void assertNear(Color actual, Color expected, int tolerance) {
		assertNear(actual, expected, tolerance, "色");
	}

	private static void assertNear(Color actual, Color expected, int tolerance, String what) {
		assertThat(isNear(actual, expected, tolerance)).as("%s: 実際 %s、期待 %s（許容差 %d）", what, toHex(actual), toHex(expected), tolerance).isTrue();
	}

	private static String toHex(Color c) {
		return String.format("#%02X%02X%02X", c.getRed(), c.getGreen(), c.getBlue());
	}

	// ───────── 共通テストケース ─────────

	/** accent-colors.json の1色（ADR-0005。TS・Java・DB と同じファイル） */
	private record AccentFixture(String code, String startHex, String endHex, boolean isNew) {
		Color start() {
			return Color.decode(startHex);
		}

		Color end() {
			return Color.decode(endHex);
		}
	}

	private static List<AccentFixture> accentFixtures() {
		JsonNode root = JsonMapper.builder().build().readTree(Path.of("../docs/model/fixtures/accent-colors.json").toFile());
		List<AccentFixture> colors = new ArrayList<>();
		root.get("colors").forEach(c -> colors.add(new AccentFixture(c.get("code").asString(), c.get("start").asString(), c.get("end").asString(),
				c.get("new").asBoolean())));
		return colors;
	}

	private static List<JsonNode> renderValueCases() {
		JsonNode root = JsonMapper.builder().build().readTree(Path.of("../docs/model/fixtures/render-values.json").toFile());
		List<JsonNode> cases = new ArrayList<>();
		root.get("cases").forEach(cases::add);
		return cases;
	}

	// ───────── 画像 ─────────

	private static byte[] jpeg(int width, int height, Color color) {
		BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
		Graphics2D g = image.createGraphics();
		g.setColor(color);
		g.fillRect(0, 0, width, height);
		g.dispose();
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try {
			ImageIO.write(image, "jpg", out);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
		return out.toByteArray();
	}

	private static BufferedImage decode(byte[] jpeg) {
		try {
			return ImageIO.read(new ByteArrayInputStream(jpeg));
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}
}
