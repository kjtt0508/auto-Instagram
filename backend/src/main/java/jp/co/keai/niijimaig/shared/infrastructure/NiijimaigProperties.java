package jp.co.keai.niijimaig.shared.infrastructure;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 定期処理の設定。値は環境変数（GitHub Secrets）から渡す。秘密情報をファイルに書かない。
 *
 * @param supabaseUrl          Supabase の URL（SUPABASE_URL）
 * @param serviceRoleKey       Supabase の service role キー（SUPABASE_SERVICE_ROLE_KEY）
 * @param instagramGraphBase   Graph API のホスト（既定 https://graph.instagram.com）
 * @param igApiVersion         Graph API のバージョン（IG_API_VERSION）
 * @param tokenKeyV1           トークン暗号鍵 v1（TOKEN_ENC_KEY_V1, base64 32バイト）
 */
@ConfigurationProperties(prefix = "niijimaig")
public record NiijimaigProperties(String supabaseUrl, String serviceRoleKey, String instagramGraphBase,
		String igApiVersion, String tokenKeyV1) {
}
