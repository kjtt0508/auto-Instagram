package jp.co.keai.niijimaig.post.infrastructure;

import java.util.Set;

import tools.jackson.databind.JsonNode;

import jp.co.keai.niijimaig.post.domain.FailureKind;

/**
 * Instagram の応答を失敗区分に分類する（02_外部連携設計 1.4 の表）。
 * コード番号は本書作成時点の知識に基づく（フェーズ0の確認手順 A9 で確かめる）。
 */
final class InstagramErrorClassifier {

	static final Set<Integer> RATE_LIMIT_CODES = Set.of(4, 17, 32, 613);
	static final Set<Integer> TOKEN_CODES = Set.of(190, 10, 102);
	static final int MEDIA_DOWNLOAD_FAILED = 9004;

	FailureKind classify(int httpStatus, JsonNode body) {
		JsonNode error = body.path("error");
		int code = error.path("code").asInt(-1);
		if (error.path("is_transient").asBoolean(false) || httpStatus >= 500) {
			return FailureKind.TRANSIENT;
		}
		if (RATE_LIMIT_CODES.contains(code)) {
			return FailureKind.RATE_LIMITED;
		}
		if (TOKEN_CODES.contains(code) || isPermissionCode(code)) {
			return FailureKind.TOKEN_INVALID;
		}
		if (code == MEDIA_DOWNLOAD_FAILED || isMediaSubcode(error.path("error_subcode").asInt(-1))) {
			return FailureKind.MEDIA_REJECTED;
		}
		return FailureKind.UNKNOWN;
	}

	/** 200番台（200〜299）は権限エラー */
	private boolean isPermissionCode(int code) {
		return code >= 200 && code < 300;
	}

	/** 2207xxx は公開時の画像・内容のエラー */
	private boolean isMediaSubcode(int subcode) {
		return subcode >= 2207000 && subcode < 2208000;
	}
}
