package jp.co.keai.niijimaig.post.infrastructure;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;

import jp.co.keai.niijimaig.post.application.MediaStorage;
import jp.co.keai.niijimaig.post.application.OwnedStoragePath;
import jp.co.keai.niijimaig.post.application.RenderStorage;
import jp.co.keai.niijimaig.shared.infrastructure.NiijimaigProperties;

/**
 * Supabase Storage。非公開バケット uploads-private から、公開バケット media-public の推測できないパスへ複製する
 * （01_DB設計 4章）。service role キーを使うため、定期処理の中だけで使う。
 */
@Component
public class SupabaseMediaStorage implements MediaStorage, RenderStorage {

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
		send(copyRequest(privatePath, publicPath), false);
		return publicPath;
	}

	/** 名前は HMAC(service role キー, 団体/鍵) の16進。キーを知らない人には推測できず、同じ鍵なら同じ名前になる */
	@Override
	public String copyToPublic(UUID tenantId, String privatePath, String idempotencyKey) {
		OwnedStoragePath.require(tenantId, privatePath);
		String publicPath = tenantId + "/" + hmacName(tenantId + "/" + idempotencyKey) + ".jpg";
		send(copyRequest(privatePath, publicPath), true);
		return publicPath;
	}

	private HttpRequest copyRequest(String privatePath, String publicPath) {
		String body = """
				{"bucketId":"%s","sourceKey":"%s","destinationBucket":"%s","destinationKey":"%s"}
				""".formatted(PRIVATE_BUCKET, privatePath, PUBLIC_BUCKET, publicPath);
		return HttpRequest.newBuilder(URI.create(baseUrl + "/storage/v1/object/copy"))
				.header("Authorization", "Bearer " + serviceRoleKey)
				.header("apikey", serviceRoleKey)
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body))
				.build();
	}

	private String hmacName(String message) {
		try {
			Mac mac = Mac.getInstance("HmacSHA256");
			mac.init(new SecretKeySpec(serviceRoleKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
			return HexFormat.of().formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
		} catch (GeneralSecurityException e) {
			throw new IllegalStateException("公開用の名前を作れません", e);
		}
	}

	@Override
	public String publicUrl(String publicPath) {
		return baseUrl + "/storage/v1/object/public/" + PUBLIC_BUCKET + "/" + publicPath;
	}

	@Override
	public Optional<byte[]> read(UUID tenantId, String privatePath) {
		OwnedStoragePath.require(tenantId, privatePath);
		HttpRequest request = authorized("/storage/v1/object/authenticated/" + PRIVATE_BUCKET + "/" + privatePath).GET().build();
		try {
			HttpResponse<byte[]> response = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
			if (response.statusCode() == 404 || response.statusCode() == 400) {
				return Optional.empty();
			}
			if (response.statusCode() >= 300) {
				throw new IllegalStateException("Storage からの読み込みに失敗: HTTP " + response.statusCode());
			}
			return Optional.of(response.body());
		} catch (IOException e) {
			throw new IllegalStateException("Storage に接続できない: " + e.getClass().getSimpleName(), e);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("中断された", e);
		}
	}

	@Override
	public void save(UUID tenantId, String privatePath, byte[] jpeg) {
		OwnedStoragePath.require(tenantId, privatePath);
		HttpRequest request = authorized("/storage/v1/object/" + PRIVATE_BUCKET + "/" + privatePath)
				.header("Content-Type", "image/jpeg").header("x-upsert", "true")
				.POST(HttpRequest.BodyPublishers.ofByteArray(jpeg)).build();
		send(request, false);
	}

	private static boolean isDuplicate(HttpResponse<String> response) {
		return response.statusCode() == 409 || (response.statusCode() == 400 && response.body() != null && response.body().contains("Duplicate"));
	}

	private HttpRequest.Builder authorized(String path) {
		return HttpRequest.newBuilder(URI.create(baseUrl + path))
				.header("Authorization", "Bearer " + serviceRoleKey).header("apikey", serviceRoleKey);
	}

	/** duplicateIsOk: 複製先が既にあること（HTTP 409。本文に Duplicate を含む 400 も）を成功として扱う */
	private void send(HttpRequest request, boolean duplicateIsOk) {
		try {
			HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
			if (response.statusCode() >= 300 && !(duplicateIsOk && isDuplicate(response))) {
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
