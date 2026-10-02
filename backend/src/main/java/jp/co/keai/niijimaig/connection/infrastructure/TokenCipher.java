package jp.co.keai.niijimaig.connection.infrastructure;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import jp.co.keai.niijimaig.connection.domain.AccessToken;

/**
 * アクセストークンの暗号化（ADR-0007）: AES-256-GCM、12バイトの乱数IV、追加認証データに連携ID。
 * 画面側（API関数・Web Crypto）と同じ形式。鍵は環境変数（GitHub Secrets）から受け取り、ファイルに書かない。
 */
public final class TokenCipher {

	static final int IV_BYTES = 12;
	static final int TAG_BITS = 128;

	private final SecretKeySpec key;
	private final short keyVersion;
	private final SecureRandom random = new SecureRandom();

	public TokenCipher(String base64Key, short keyVersion) {
		byte[] raw = Base64.getDecoder().decode(base64Key);
		if (raw.length != 32) {
			throw new IllegalArgumentException("トークン暗号鍵は32バイト（base64）");
		}
		this.key = new SecretKeySpec(raw, "AES");
		this.keyVersion = keyVersion;
	}

	public Sealed seal(AccessToken token, UUID connectionId) {
		byte[] iv = new byte[IV_BYTES];
		random.nextBytes(iv);
		byte[] ciphertext = run(Cipher.ENCRYPT_MODE, iv, connectionId, token.reveal().getBytes(StandardCharsets.UTF_8));
		return new Sealed(ciphertext, iv, keyVersion);
	}

	public AccessToken open(Sealed sealed, UUID connectionId) {
		if (sealed.keyVersion() != keyVersion) {
			throw new IllegalStateException("鍵の版 " + sealed.keyVersion() + " の鍵が設定されていない");
		}
		return new AccessToken(new String(run(Cipher.DECRYPT_MODE, sealed.iv(), connectionId, sealed.ciphertext()),
				StandardCharsets.UTF_8));
	}

	private byte[] run(int mode, byte[] iv, UUID connectionId, byte[] input) {
		try {
			Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
			cipher.init(mode, key, new GCMParameterSpec(TAG_BITS, iv));
			cipher.updateAAD(connectionId.toString().getBytes(StandardCharsets.UTF_8));
			return cipher.doFinal(input);
		} catch (GeneralSecurityException e) {
			throw new IllegalStateException("トークンの暗号化・復号に失敗（鍵か連携IDが違う）", e);
		}
	}

	/** 暗号化したトークン（DB の token_ciphertext / token_iv / key_version） */
	public record Sealed(byte[] ciphertext, byte[] iv, short keyVersion) {
	}
}
