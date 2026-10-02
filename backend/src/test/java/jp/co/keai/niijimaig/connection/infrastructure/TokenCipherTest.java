package jp.co.keai.niijimaig.connection.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Base64;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import jp.co.keai.niijimaig.connection.domain.AccessToken;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class TokenCipherTest {

	static final String TEST_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
	private final TokenCipher cipher = new TokenCipher(TEST_KEY, (short) 1);

	@Test
	@DisplayName("NFR-001-03 トークンは暗号化して保存され、平文は暗号文に現れず、同じ連携IDでだけ復号できる")
	void roundTrip() {
		UUID connection = UUID.randomUUID();
		AccessToken token = new AccessToken("IGAAtoken-value");

		TokenCipher.Sealed sealed = cipher.seal(token, connection);

		assertThat(new String(sealed.ciphertext(), StandardCharsets.ISO_8859_1)).doesNotContain("IGAAtoken");
		assertThat(sealed.iv()).hasSize(12);
		assertThat(cipher.open(sealed, connection)).isEqualTo(token);
		assertThatThrownBy(() -> cipher.open(sealed, UUID.randomUUID())).isInstanceOf(IllegalStateException.class);
	}

	@Test
	@DisplayName("NFR-001-03 API関数（TS の Web Crypto）が暗号化したトークンを復号できる（fixtures/token-cipher.json）")
	void opensVectorEncryptedByTypeScript() throws Exception {
		JsonNode vector = JsonMapper.builder().build().readTree(Path.of("../docs/model/fixtures/token-cipher.json").toFile());
		TokenCipher shared = new TokenCipher(vector.get("keyBase64").asString(), (short) vector.get("keyVersion").asInt());
		TokenCipher.Sealed sealed = new TokenCipher.Sealed(
				Base64.getDecoder().decode(vector.get("ciphertextBase64").asString()),
				Base64.getDecoder().decode(vector.get("ivBase64").asString()),
				(short) vector.get("keyVersion").asInt());

		AccessToken opened = shared.open(sealed, UUID.fromString(vector.get("connectionId").asString()));

		assertThat(opened).isEqualTo(new AccessToken(vector.get("plaintext").asString()));
	}

	@Test
	void 同じトークンでも毎回違う暗号文になる() {
		UUID connection = UUID.randomUUID();
		AccessToken token = new AccessToken("same");

		assertThat(cipher.seal(token, connection).ciphertext()).isNotEqualTo(cipher.seal(token, connection).ciphertext());
	}
}
