package jp.co.keai.niijimaig.connection.application;

import jp.co.keai.niijimaig.connection.domain.InstagramConnection;

/** 長期アクセストークンの更新（Graph API の refresh_access_token。実装は infrastructure） */
public interface InstagramTokenRefresher {

	/** 更新したトークンと新しい有効期限を持つ連携を返す。失敗は InstagramApiException */
	InstagramConnection refresh(InstagramConnection connection);
}
