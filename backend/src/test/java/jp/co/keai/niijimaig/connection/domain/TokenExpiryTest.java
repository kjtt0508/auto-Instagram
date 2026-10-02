package jp.co.keai.niijimaig.connection.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class TokenExpiryTest {

	static final Instant NOW = Instant.parse("2026-11-01T19:00:00Z");

	@Test
	@DisplayName("AC-001-19 残り31日は更新しない、30日は更新する")
	void refreshBoundary() {
		assertThat(daysLeft(31).needsRefresh(NOW)).isFalse();
		assertThat(daysLeft(30).needsRefresh(NOW)).isTrue();
	}

	@Test
	@DisplayName("AC-001-20 残り7日で更新に失敗したらワークフローを失敗させる（8日なら失敗させない）")
	void failWorkflowBoundary() {
		assertThat(daysLeft(7).shouldFailWorkflow(true, NOW)).isTrue();
		assertThat(daysLeft(8).shouldFailWorkflow(true, NOW)).isFalse();
		assertThat(daysLeft(7).shouldFailWorkflow(false, NOW)).isFalse();
	}

	@Test
	void 残り14日以下で警告() {
		assertThat(daysLeft(15).needsWarning(NOW)).isFalse();
		assertThat(daysLeft(14).needsWarning(NOW)).isTrue();
	}

	@Test
	@DisplayName("NFR-001-03 アクセストークンは文字列表現で値を伏せる")
	void tokenIsMasked() {
		assertThat(new AccessToken("IGQVJ-secret").toString()).doesNotContain("secret");
	}

	@Test
	@DisplayName("AC-001-19 AC-001-20 画面（TS）と同じ共通テストケース（fixtures/token-expiry.json）で判断が一致する")
	void sharedFixtureCases() {
		JsonNode cases = JsonMapper.builder().build().readTree(Path.of("../docs/model/fixtures/token-expiry.json").toFile()).get("cases");
		cases.forEach(c -> {
			TokenExpiry expiry = new TokenExpiry(NOW.plus(Duration.ofHours(c.get("remainingHours").asLong())));
			assertThat(Math.max(0, expiry.remainingDays(NOW))).as("残り日数 %s", c).isEqualTo(c.get("remainingDays").asLong());
			assertThat(expiry.needsRefresh(NOW)).as("更新 %s", c).isEqualTo(c.get("needsRefresh").asBoolean());
			assertThat(expiry.needsWarning(NOW)).as("警告 %s", c).isEqualTo(c.get("needsWarning").asBoolean());
			assertThat(expiry.shouldFailWorkflow(true, NOW)).as("失敗 %s", c).isEqualTo(c.get("failWorkflowIfRefreshFailed").asBoolean());
		});
	}

	private TokenExpiry daysLeft(long days) {
		return new TokenExpiry(NOW.plus(Duration.ofDays(days)).plusSeconds(60));
	}
}
