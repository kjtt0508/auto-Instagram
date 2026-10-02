package jp.co.keai.niijimaig.post.infrastructure;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;

import org.springframework.stereotype.Component;

import jp.co.keai.niijimaig.post.application.MediaStorage;
import jp.co.keai.niijimaig.shared.infrastructure.NiijimaigProperties;

/**
 * Supabase Storage。非公開バケット uploads-private から、公開バケット media-public の推測できないパスへ複製する
 * （01_DB設計 4章）。service role キーを使うため、定期処理の中だけで使う。
 */
@Component
public class SupabaseMediaStorage implements MediaStorage {

	static final String PRIVATE_BUCKET = "uploads-private";
	static final String PUBLIC_BUCKET = "media-public";

	private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();
	private final String baseUrl;
	private final String serviceRoleKey;

	public SupabaseMediaStorage(NiijimaigProperties properties) {
		this.baseUrl = properties.supabaseUrl();
		this.serviceRoleKey = properties.serviceRoleKey();
	}

	@Override
	public String copyToPublic(UUID tenantId, String privatePath) {
		String publicPath = tenantId + "/" + UUID.randomUUID() + ".jpg";
		String body = """
				{"bucketId":"%s","sourceKey":"%s","destinationBucket":"%s","destinationKey":"%s"}
				""".formatted(PRIVATE_BUCKET, privatePath, PUBLIC_BUCKET, publicPath);
		HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/storage/v1/object/copy"))
				.header("Authorization", "Bearer " + serviceRoleKey)
				.header("apikey", serviceRoleKey)
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body))
				.build();
		send(request);
		return publicPath;
	}

	@Override
	public String publicUrl(String publicPath) {
		return baseUrl + "/storage/v1/object/public/" + PUBLIC_BUCKET + "/" + publicPath;
	}

	private void send(HttpRequest request) {
		try {
			HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
			if (response.statusCode() >= 300) {
				throw new IllegalStateException("Storage への複製に失敗: HTTP " + response.statusCode());
			}
		} catch (IOException e) {
			throw new IllegalStateException("Storage に接続できない: " + e.getClass().getSimpleName(), e);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("中断された", e);
		}
	}
}
