package jp.co.keai.niijimaig.image.infrastructure;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

import jp.co.keai.niijimaig.image.application.CandidateImages;
import jp.co.keai.niijimaig.image.domain.ImageCandidate;
import jp.co.keai.niijimaig.shared.infrastructure.NiijimaigProperties;

/**
 * 候補の画像は uploads-private/{団体}/candidates/{画像生成ID}/{位置}.jpg（REQ-005 設計 5章。API関数の candidatePath と同じ）。
 * Storage API でまとめて消す（無いパスは無視される）。service role キーを使うため、定期処理の中だけで使う
 */
@Component
public class SupabaseCandidateStorage implements CandidateImages.Storage {

	static final String PRIVATE_BUCKET = "uploads-private";
	static final int PATHS_PER_REQUEST = 100;

	private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();
	private final String baseUrl;
	private final String serviceRoleKey;

	public SupabaseCandidateStorage(NiijimaigProperties properties) {
		this.baseUrl = properties.supabaseUrl();
		this.serviceRoleKey = properties.serviceRoleKey();
	}

	static String pathOf(ImageCandidate candidate) {
		return candidate.tenantId() + "/candidates/" + candidate.generationId() + "/" + candidate.position() + ".jpg";
	}

	@Override
	public void delete(List<ImageCandidate> candidates) {
		List<String> paths = candidates.stream().map(SupabaseCandidateStorage::pathOf).toList();
		for (int from = 0; from < paths.size(); from += PATHS_PER_REQUEST) {
			deletePaths(paths.subList(from, Math.min(paths.size(), from + PATHS_PER_REQUEST)));
		}
	}

	private void deletePaths(List<String> paths) {
		String prefixes = paths.stream().map(p -> "\"" + p + "\"").collect(Collectors.joining(","));
		HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/storage/v1/object/" + PRIVATE_BUCKET))
				.header("Authorization", "Bearer " + serviceRoleKey)
				.header("apikey", serviceRoleKey)
				.header("Content-Type", "application/json")
				.method("DELETE", HttpRequest.BodyPublishers.ofString("{\"prefixes\":[" + prefixes + "]}"))
				.build();
		try {
			HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
			if (response.statusCode() >= 300) {
				throw new IllegalStateException("候補の画像を消せない: HTTP " + response.statusCode());
			}
		} catch (IOException e) {
			throw new IllegalStateException("Storage に接続できない: " + e.getClass().getSimpleName(), e);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("中断された", e);
		}
	}
}
