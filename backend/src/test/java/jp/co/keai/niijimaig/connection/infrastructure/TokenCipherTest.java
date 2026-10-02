package jp.co.keai.niijimaig.connection.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import jp.co.keai.niijimaig.connection.domain.AccessToken;

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
	void 同じトークンでも毎回違う暗号文になる() {
		UUID connection = UUID.randomUUID();
		AccessToken token = new AccessToken("same");

		assertThat(cipher.seal(token, connection).ciphertext()).isNotEqualTo(cipher.seal(token, connection).ciphertext());
	}
}
