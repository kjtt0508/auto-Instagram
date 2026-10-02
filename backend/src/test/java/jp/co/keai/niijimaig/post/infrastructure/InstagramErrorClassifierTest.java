package jp.co.keai.niijimaig.post.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import tools.jackson.databind.json.JsonMapper;

import jp.co.keai.niijimaig.post.domain.FailureKind;

@DisplayName("Instagram の応答の分類（02_外部連携設計 1.4。AC-001-16 AC-001-17）")
class InstagramErrorClassifierTest {

	private final InstagramErrorClassifier classifier = new InstagramErrorClassifier();
	private final JsonMapper json = JsonMapper.builder().build();

	@ParameterizedTest(name = "HTTP {0} / {1} → {2}")
	@CsvSource(delimiter = '|', value = {
			"500 | {}                                                        | TRANSIENT",
			"400 | {\"error\":{\"code\":2,\"is_transient\":true}}             | TRANSIENT",
			"400 | {\"error\":{\"code\":4}}                                   | RATE_LIMITED",
			"400 | {\"error\":{\"code\":613}}                                 | RATE_LIMITED",
			"400 | {\"error\":{\"code\":190}}                                 | TOKEN_INVALID",
			"403 | {\"error\":{\"code\":200}}                                 | TOKEN_INVALID",
			"400 | {\"error\":{\"code\":9004}}                                | MEDIA_REJECTED",
			"400 | {\"error\":{\"code\":100,\"error_subcode\":2207026}}       | MEDIA_REJECTED",
			"400 | {\"error\":{\"code\":100}}                                 | UNKNOWN" })
	void classify(int status, String body, FailureKind expected) {
		assertThat(classifier.classify(status, json.readTree(body))).isEqualTo(expected);
	}
}
